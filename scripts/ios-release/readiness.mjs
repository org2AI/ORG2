import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";

export const bundleId = "org2ai.org2.remote";

export function releaseConfig(version, build, team) {
  assert.match(
    version ?? "",
    /^\d{1,4}\.\d{1,2}\.\d{1,2}$/,
    "Expected a numeric release version",
  );
  assert.match(
    build ?? "",
    /^[1-9]\d{0,8}$/,
    "Expected a positive build number (at most 9 digits)",
  );
  assert.match(
    team ?? "",
    /^[A-Z0-9]{10}$/,
    "Expected a 10-character Apple Team ID",
  );
  return {
    version,
    bundle: { iOS: { bundleVersion: build, developmentTeam: team } },
  };
}

export function validateDistribution(
  info,
  profile,
  entitlements,
  expected,
  now = Date.now(),
) {
  const { version, build, team } = expected;
  releaseConfig(version, build, team);
  assert.equal(info.CFBundleIdentifier, bundleId, "Wrong application bundle");
  assert.equal(
    info.CFBundleShortVersionString,
    version,
    "Wrong release version",
  );
  assert.equal(info.CFBundleVersion, build, "Wrong build number");
  assert.ok(
    info.NSCameraUsageDescription?.trim(),
    "Camera purpose string missing",
  );
  assert.ok(
    info.CFBundleURLTypes?.some((t) =>
      t.CFBundleURLSchemes?.includes("org2remote"),
    ),
    "Auth callback URL scheme missing",
  );
  assert.equal(
    typeof info.ITSAppUsesNonExemptEncryption,
    "boolean",
    "Export-compliance declaration must be reviewed and configured",
  );
  assert.ok(
    profile.TeamIdentifier?.includes(team),
    "Provisioning team mismatch",
  );
  assert.ok(
    Number.isFinite(Date.parse(profile.ExpirationDate)) &&
      Date.parse(profile.ExpirationDate) > now,
    "Provisioning profile expired or invalid",
  );
  assert.equal(
    profile.ProvisionedDevices,
    undefined,
    "Ad hoc/development profiles cannot be used for App Store upload",
  );
  assert.notEqual(
    profile.ProvisionsAllDevices,
    true,
    "Enterprise profiles cannot be used for App Store upload",
  );
  assert.equal(
    profile.Entitlements?.["get-task-allow"],
    false,
    "Profile must disable debugging",
  );
  assert.equal(
    profile.Entitlements?.["beta-reports-active"],
    true,
    "Expected App Store distribution profile",
  );
  assert.equal(
    entitlements["get-task-allow"],
    false,
    "App must disable debugging",
  );
  assert.equal(
    entitlements["com.apple.developer.team-identifier"],
    team,
    "Signed team mismatch",
  );
  const applicationId = profile.Entitlements?.["application-identifier"];
  assert.ok(
    profile.ApplicationIdentifierPrefix?.some(
      (prefix) => applicationId === `${prefix}.${bundleId}`,
    ),
    "Profile must match the explicit bundle ID",
  );
  assert.equal(
    entitlements["application-identifier"],
    applicationId,
    "Signed application does not match profile",
  );
}

function command(file, args, input) {
  const result = spawnSync(file, args, { input, maxBuffer: 8 * 1024 * 1024 });
  // Never echo certificate/profile/tool output: it can contain private metadata.
  assert.equal(
    result.status,
    0,
    `${file} validation failed (details suppressed)`,
  );
  return result.stdout;
}

export function parsePlist(bytes) {
  // Profiles contain plist dates and certificate NSData values that plutil cannot
  // convert to JSON. Preserve dates, discard certificate bytes not used by checks.
  return JSON.parse(
    command(
      "python3",
      [
        "-c",
        "import sys, json, plistlib, datetime; print(json.dumps(plistlib.loads(sys.stdin.buffer.read()), default=lambda v: v.replace(tzinfo=datetime.timezone.utc).isoformat() if isinstance(v, datetime.datetime) else None))",
      ],
      bytes,
    ),
  );
}

export function validateApp(app, expected) {
  const info = parsePlist(readFileSync(join(app, "Info.plist")));
  const profile = parsePlist(
    command("security", [
      "cms",
      "-D",
      "-i",
      join(app, "embedded.mobileprovision"),
    ]),
  );
  const entitlements = parsePlist(
    command("codesign", ["-d", "--entitlements", ":-", app]),
  );
  command("codesign", ["--verify", "--deep", "--strict", app]);
  validateDistribution(info, profile, entitlements, expected);
  assert.ok(
    existsSync(join(app, "Assets.car")),
    "Compiled app icon/assets are missing",
  );
  const privacy = parsePlist(readFileSync(join(app, "PrivacyInfo.xcprivacy")));
  for (const key of [
    "NSPrivacyCollectedDataTypes",
    "NSPrivacyAccessedAPITypes",
    "NSPrivacyTrackingDomains",
  ]) {
    assert.ok(Array.isArray(privacy[key]), `Privacy manifest missing ${key}`);
  }
  assert.equal(
    typeof privacy.NSPrivacyTracking,
    "boolean",
    "Privacy tracking declaration missing",
  );
  // This structural check is not an audit of the accuracy of privacy declarations.
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const expected = {
      version: process.env.IOS_VERSION,
      build: process.env.IOS_BUILD_NUMBER,
      team: process.env.APPLE_TEAM_ID,
    };
    if (process.argv[2] === "config") {
      console.log(
        JSON.stringify(
          releaseConfig(expected.version, expected.build, expected.team),
        ),
      );
    } else if (process.argv[2] === "app" && process.argv[3]) {
      validateApp(resolve(process.argv[3]), expected);
      console.log(
        "Signed iOS bundle structural checks passed; manual release checklist still required.",
      );
    } else {
      throw new Error("Usage: readiness.mjs config | app <app-path>");
    }
  } catch {
    console.error(
      "iOS release validation failed. Check version/team, distribution profile, entitlements, privacy manifest and export declaration. No sensitive values were printed.",
    );
    process.exitCode = 1;
  }
}

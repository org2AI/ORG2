import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";

export const bundleId = "org2ai.org2.remote";
export const minimumIosSdkMajor = 26;
export const appStoreExportMethod = "app-store-connect";
export const adHocExportMethod = "ad-hoc";

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
  const exportMethod = expected.exportMethod ?? appStoreExportMethod;
  assert.ok(
    [appStoreExportMethod, adHocExportMethod].includes(exportMethod),
    "Unsupported iOS export method",
  );
  releaseConfig(version, build, team);
  assert.equal(info.CFBundleIdentifier, bundleId, "Wrong application bundle");
  assert.equal(
    info.CFBundleShortVersionString,
    version,
    "Wrong release version",
  );
  assert.equal(info.CFBundleVersion, build, "Wrong build number");
  const sdkMatch = /^iphoneos(\d+)(?:\.\d+)*$/.exec(info.DTSDKName ?? "");
  assert.ok(sdkMatch, "Built iPhoneOS SDK metadata missing or invalid");
  assert.ok(
    Number(sdkMatch[1]) >= minimumIosSdkMajor,
    `App must be built with iOS ${minimumIosSdkMajor} SDK or newer`,
  );
  assert.ok(
    info.NSCameraUsageDescription?.trim(),
    "Camera purpose string missing",
  );
  assert.ok(
    info.NSMicrophoneUsageDescription?.trim(),
    "Microphone purpose string missing",
  );
  assert.ok(
    info.NSSpeechRecognitionUsageDescription?.trim(),
    "Speech recognition purpose string missing",
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
  if (exportMethod === appStoreExportMethod) {
    assert.equal(
      profile.ProvisionedDevices,
      undefined,
      "Ad hoc/development profiles cannot be used for App Store upload",
    );
    assert.equal(
      profile.Entitlements?.["beta-reports-active"],
      true,
      "Expected App Store distribution profile",
    );
  } else {
    assert.ok(
      Array.isArray(profile.ProvisionedDevices) &&
        profile.ProvisionedDevices.length > 0,
      "Ad Hoc profile must include registered devices",
    );
    assert.notEqual(
      profile.Entitlements?.["beta-reports-active"],
      true,
      "Expected Ad Hoc distribution profile",
    );
  }
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
  validatePrivacyManifest(privacy);
  // Structural validation cannot prove that the declarations match the app's
  // actual data retention, third-party SDKs, or required-reason API usage.
}

export function validatePrivacyManifest(privacy) {
  assert.equal(
    typeof privacy.NSPrivacyTracking,
    "boolean",
    "Privacy tracking declaration missing",
  );
  const optionalArrays = [
    "NSPrivacyCollectedDataTypes",
    "NSPrivacyAccessedAPITypes",
    "NSPrivacyTrackingDomains",
  ];
  for (const key of optionalArrays) {
    if (privacy[key] === undefined) continue;
    assert.ok(Array.isArray(privacy[key]), `Privacy manifest ${key} must be an array`);
    assert.ok(privacy[key].length > 0, `Privacy manifest must omit empty ${key}`);
  }
  for (const entry of privacy.NSPrivacyCollectedDataTypes ?? []) {
    assert.equal(typeof entry.NSPrivacyCollectedDataType, "string");
    assert.equal(typeof entry.NSPrivacyCollectedDataTypeLinked, "boolean");
    assert.equal(typeof entry.NSPrivacyCollectedDataTypeTracking, "boolean");
    assert.ok(Array.isArray(entry.NSPrivacyCollectedDataTypePurposes));
    assert.ok(entry.NSPrivacyCollectedDataTypePurposes.length > 0);
    assert.ok(
      entry.NSPrivacyCollectedDataTypePurposes.every(
        (purpose) => typeof purpose === "string" && purpose.length > 0,
      ),
    );
  }
  for (const entry of privacy.NSPrivacyAccessedAPITypes ?? []) {
    assert.equal(typeof entry.NSPrivacyAccessedAPIType, "string");
    assert.ok(Array.isArray(entry.NSPrivacyAccessedAPITypeReasons));
    assert.ok(entry.NSPrivacyAccessedAPITypeReasons.length > 0);
    assert.ok(
      entry.NSPrivacyAccessedAPITypeReasons.every(
        (reason) => typeof reason === "string" && reason.length > 0,
      ),
    );
  }
  assert.ok(
    (privacy.NSPrivacyTrackingDomains ?? []).every(
      (domain) => typeof domain === "string" && domain.length > 0,
    ),
  );
}

export function validateAltoolResult(output, phase, status) {
  const successPattern = {
    validation: /No errors validating archive|VALIDATION SUCCEEDED/i,
    upload: /UPLOAD SUCCEEDED|No errors uploading/i,
  }[phase];
  assert.ok(successPattern, "Unknown App Store Connect phase");
  assert.equal(status, 0, `App Store Connect ${phase} command failed`);
  assert.doesNotMatch(
    output,
    /(^|\s)ERROR:|VERIFY FAILED|UPLOAD FAILED|Failed to validate package|Failed to upload package/i,
    `App Store Connect ${phase} reported a failure`,
  );
  assert.match(
    output,
    successPattern,
    `App Store Connect ${phase} did not return a recognized success response`,
  );
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
      exportMethod: process.env.IOS_EXPORT_METHOD ?? appStoreExportMethod,
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
    } else if (
      process.argv[2] === "altool" &&
      process.argv[3] &&
      process.argv[4] &&
      process.argv[5]
    ) {
      validateAltoolResult(
        readFileSync(resolve(process.argv[5]), "utf8"),
        process.argv[3],
        Number(process.argv[4]),
      );
    } else {
      throw new Error(
        "Usage: readiness.mjs config | app <app-path> | altool <phase> <status> <log-path>",
      );
    }
  } catch {
    console.error(
      "iOS release validation failed. Check version/team, distribution profile, entitlements, privacy manifest and export declaration. No sensitive values were printed.",
    );
    process.exitCode = 1;
  }
}

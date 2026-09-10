import assert from "node:assert/strict";
import test from "node:test";
import {
  releaseConfig,
  validateDistribution,
  bundleId,
  parsePlist,
} from "./readiness.mjs";

test("parses real plist date/data types without exposing certificate bytes", () => {
  const value = parsePlist(
    Buffer.from(
      '<plist version="1.0"><dict><key>ExpirationDate</key><date>2099-01-01T00:00:00Z</date><key>DeveloperCertificates</key><array><data>dGVzdA==</data></array></dict></plist>',
    ),
  );
  assert.equal(
    Date.parse(value.ExpirationDate),
    Date.parse("2099-01-01T00:00:00Z"),
  );
  assert.deepEqual(value.DeveloperCertificates, [null]);
});

function fixture() {
  const expected = { version: "0.1.0", build: "10", team: "ABCDEFGHIJ" };
  const entitlements = {
    "get-task-allow": false,
    "com.apple.developer.team-identifier": expected.team,
    "application-identifier": `OLDPREFIX1.${bundleId}`,
  };
  const info = {
    CFBundleIdentifier: bundleId,
    CFBundleShortVersionString: expected.version,
    CFBundleVersion: expected.build,
    NSCameraUsageDescription: "Scan pairing codes",
    CFBundleURLTypes: [{ CFBundleURLSchemes: ["org2remote"] }],
    ITSAppUsesNonExemptEncryption: false,
  };
  const profile = {
    TeamIdentifier: [expected.team],
    ApplicationIdentifierPrefix: ["OLDPREFIX1"],
    ExpirationDate: "2099-01-01T00:00:00Z",
    Entitlements: { ...entitlements, "beta-reports-active": true },
  };
  return { info, profile, entitlements, expected };
}

test("release config rejects shell-like and invalid version/build/team inputs", () => {
  assert.equal(
    releaseConfig("0.1.0", "2", "ABCDEFGHIJ").bundle.iOS.bundleVersion,
    "2",
  );
  for (const args of [
    ["0.1.0;echo x", "2", "ABCDEFGHIJ"],
    ["0.1.0", "0", "ABCDEFGHIJ"],
    ["0.1.0", "2", "personal"],
  ]) {
    assert.throws(() => releaseConfig(...args));
  }
});
test("accepts matching distribution metadata, including legacy App ID prefixes", () => {
  const f = fixture();
  validateDistribution(f.info, f.profile, f.entitlements, f.expected);
});
for (const [name, mutate] of [
  [
    "debug app",
    (f) => {
      f.entitlements["get-task-allow"] = true;
    },
  ],
  [
    "debug profile",
    (f) => {
      f.profile.Entitlements["get-task-allow"] = true;
    },
  ],
  [
    "ad hoc profile",
    (f) => {
      f.profile.ProvisionedDevices = ["test-device"];
    },
  ],
  [
    "enterprise profile",
    (f) => {
      f.profile.ProvisionsAllDevices = true;
    },
  ],
  [
    "expired profile",
    (f) => {
      f.profile.ExpirationDate = "2000-01-01";
    },
  ],
  [
    "wrong team",
    (f) => {
      f.profile.TeamIdentifier = ["OTHERTEAM1"];
    },
  ],
  [
    "wrong app",
    (f) => {
      f.info.CFBundleIdentifier = "other.app";
    },
  ],
  [
    "wrong build",
    (f) => {
      f.info.CFBundleVersion = "9";
    },
  ],
  [
    "missing camera permission",
    (f) => {
      delete f.info.NSCameraUsageDescription;
    },
  ],
  [
    "missing callback",
    (f) => {
      f.info.CFBundleURLTypes = [];
    },
  ],
  [
    "unreviewed encryption",
    (f) => {
      delete f.info.ITSAppUsesNonExemptEncryption;
    },
  ],
  [
    "wildcard profile",
    (f) => {
      f.profile.Entitlements["application-identifier"] = "OLDPREFIX1.*";
    },
  ],
]) {
  test(`rejects ${name}`, () => {
    const f = fixture();
    mutate(f);
    assert.throws(() =>
      validateDistribution(f.info, f.profile, f.entitlements, f.expected),
    );
  });
}

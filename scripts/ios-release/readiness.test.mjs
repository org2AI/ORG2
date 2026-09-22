import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  releaseConfig,
  validateAltoolResult,
  validateDistribution,
  validatePrivacyManifest,
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
    DTSDKName: "iphoneos26.0",
    NSCameraUsageDescription: "Scan pairing codes",
    NSMicrophoneUsageDescription: "Record dictation",
    NSSpeechRecognitionUsageDescription: "Transcribe dictation",
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

test("rejects an altool API failure even when altool exits successfully", () => {
  assert.throws(() =>
    validateAltoolResult(
      "ERROR: Failed to validate package. UPLOAD FAILED (409)",
      "upload",
      0,
    ),
  );
});

test("requires an explicit altool success marker", () => {
  assert.throws(() =>
    validateAltoolResult(
      "Transfer completed without a final response",
      "upload",
      0,
    ),
  );
  assert.doesNotThrow(() =>
    validateAltoolResult(
      "UPLOAD SUCCEEDED",
      "upload",
      0,
    ),
  );
});
test("accepts matching distribution metadata, including legacy App ID prefixes", () => {
  const f = fixture();
  validateDistribution(f.info, f.profile, f.entitlements, f.expected);
});

test("accepts an Ad Hoc distribution profile with registered devices", () => {
  const f = fixture();
  f.expected.exportMethod = "ad-hoc";
  f.profile.ProvisionedDevices = ["registered-device"];
  delete f.profile.Entitlements["beta-reports-active"];
  validateDistribution(f.info, f.profile, f.entitlements, f.expected);
});

test("rejects an Ad Hoc profile without registered devices", () => {
  const f = fixture();
  f.expected.exportMethod = "ad-hoc";
  delete f.profile.Entitlements["beta-reports-active"];
  assert.throws(() =>
    validateDistribution(f.info, f.profile, f.entitlements, f.expected),
  );
});

test("accepts a minimal privacy manifest without invalid empty declarations", () => {
  validatePrivacyManifest({ NSPrivacyTracking: false });
});

test("rejects empty optional privacy declarations", () => {
  for (const key of [
    "NSPrivacyCollectedDataTypes",
    "NSPrivacyAccessedAPITypes",
    "NSPrivacyTrackingDomains",
  ]) {
    assert.throws(() =>
      validatePrivacyManifest({ NSPrivacyTracking: false, [key]: [] }),
    );
  }
});

test("requires reasons for declared required-reason APIs", () => {
  assert.throws(() =>
    validatePrivacyManifest({
      NSPrivacyTracking: false,
      NSPrivacyAccessedAPITypes: [
        {
          NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryFileTimestamp",
          NSPrivacyAccessedAPITypeReasons: [],
        },
      ],
    }),
  );
});

test("ships the reviewed iOS privacy declarations", () => {
  const privacy = parsePlist(
    readFileSync(
      new URL(
        "../../apps/remote-ios/src-tauri/gen/apple/org2-remote_iOS/PrivacyInfo.xcprivacy",
        import.meta.url,
      ),
    ),
  );
  validatePrivacyManifest(privacy);
  assert.equal(privacy.NSPrivacyTracking, false);
  assert.deepEqual(
    privacy.NSPrivacyCollectedDataTypes.map(
      (entry) => entry.NSPrivacyCollectedDataType,
    ),
    [
      "NSPrivacyCollectedDataTypeName",
      "NSPrivacyCollectedDataTypeEmailAddress",
      "NSPrivacyCollectedDataTypeUserID",
      "NSPrivacyCollectedDataTypeDeviceID",
      "NSPrivacyCollectedDataTypeProductInteraction",
      "NSPrivacyCollectedDataTypeOtherUserContent",
      "NSPrivacyCollectedDataTypePhotosorVideos",
    ],
  );
  assert.deepEqual(privacy.NSPrivacyAccessedAPITypes, [
    {
      NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryFileTimestamp",
      NSPrivacyAccessedAPITypeReasons: ["C617.1"],
    },
  ]);
  assert.equal(privacy.NSPrivacyTrackingDomains, undefined);
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
    "outdated iOS SDK",
    (f) => {
      f.info.DTSDKName = "iphoneos18.5";
    },
  ],
  [
    "missing iOS SDK metadata",
    (f) => {
      delete f.info.DTSDKName;
    },
  ],
  [
    "missing camera permission",
    (f) => {
      delete f.info.NSCameraUsageDescription;
    },
  ],
  [
    "missing microphone permission",
    (f) => {
      delete f.info.NSMicrophoneUsageDescription;
    },
  ],
  [
    "missing speech recognition permission",
    (f) => {
      delete f.info.NSSpeechRecognitionUsageDescription;
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

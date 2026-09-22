import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  exportOptionsPlist,
  patchProjectForManualSigning,
  signingXcconfig,
} from "./manual-signing.mjs";

const inputs = {
  team: "ABCDEFGHIJ",
  identity: "Apple Distribution: Example, Inc. (ABCDEFGHIJ)",
  profileUuid: "12345678-1234-1234-1234-1234567890ab",
};

const project = `
1 /* debug */ = {
  isa = XCBuildConfiguration;
  buildSettings = {
    CODE_SIGN_ENTITLEMENTS = app.entitlements;
    CODE_SIGN_IDENTITY = "iPhone Developer";
  };
  name = debug;
};
2 /* release */ = {
  isa = XCBuildConfiguration;
  buildSettings = {
    CODE_SIGN_ENTITLEMENTS = app.entitlements;
    CODE_SIGN_IDENTITY = "iPhone Developer";
  };
  name = release;
};
`;

test("patches both target configurations without emitting detached settings", () => {
  const result = patchProjectForManualSigning(project, inputs);
  assert.equal(result.match(/CODE_SIGN_STYLE = Manual;/g)?.length, 2);
  assert.equal(result.match(/PROVISIONING_PROFILE_SPECIFIER =/g)?.length, 2);
  assert.equal(result.match(/iPhone Developer/g), null);
  for (const block of result.matchAll(/buildSettings = \{([\s\S]*?)\n\s*\};/g)) {
    assert.match(block[1], /CODE_SIGN_STYLE = Manual;/);
    assert.match(block[1], /PROVISIONING_PROFILE_SPECIFIER =/);
  }
});

test("patches the checked-in generated Xcode project", () => {
  const source = readFileSync(
    new URL(
      "../../apps/remote-ios/src-tauri/gen/apple/org2-remote.xcodeproj/project.pbxproj",
      import.meta.url,
    ),
    "utf8",
  );
  const result = patchProjectForManualSigning(source, inputs);
  assert.equal(result.match(/CODE_SIGN_STYLE = Manual;/g)?.length, 2);
  assert.equal(result.match(/PROVISIONING_PROFILE_SPECIFIER =/g)?.length, 2);
});

test("writes matching manual archive and export settings", () => {
  const xcconfig = signingXcconfig(inputs);
  const exportOptions = exportOptionsPlist(inputs);
  assert.match(xcconfig, /CODE_SIGN_STYLE = Manual/);
  assert.match(xcconfig, /Apple Distribution: Example, Inc\./);
  assert.match(exportOptions, /<key>signingStyle<\/key><string>manual<\/string>/);
  assert.match(exportOptions, /<key>org2ai\.org2\.remote<\/key>/);
  assert.match(exportOptions, /12345678-1234-1234-1234-1234567890ab/);
});

test("writes Ad Hoc export options for registered-device distribution", () => {
  const exportOptions = exportOptionsPlist({
    ...inputs,
    exportMethod: "ad-hoc",
  });
  assert.match(
    exportOptions,
    /<key>method<\/key><string>release-testing<\/string>/,
  );
});

test("rejects unsupported export methods", () => {
  assert.throws(() =>
    exportOptionsPlist({ ...inputs, exportMethod: "enterprise" }),
  );
});

test("rejects identities from another team", () => {
  assert.throws(() =>
    signingXcconfig({
      ...inputs,
      identity: "Apple Distribution: Example, Inc. (OTHERTEAM1)",
    }),
  );
});

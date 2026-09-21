import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

export const iosBundleId = "org2ai.org2.remote";
export const defaultExportMethod = "app-store-connect";
const supportedExportMethods = new Set([defaultExportMethod, "ad-hoc"]);

export function xcodeExportMethod(exportMethod = defaultExportMethod) {
  assert.ok(
    supportedExportMethods.has(exportMethod),
    "Unsupported iOS export method",
  );
  return exportMethod === "ad-hoc" ? "release-testing" : exportMethod;
}

function xmlEscape(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function validateInputs({ team, identity, profileUuid }) {
  assert.match(team, /^[A-Z0-9]{10}$/, "Invalid Apple Team ID");
  assert.match(
    profileUuid,
    /^[A-Fa-f0-9]{8}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{12}$/,
    "Invalid provisioning profile UUID",
  );
  assert.ok(
    /^(Apple Distribution|iPhone Distribution): /.test(identity),
    "Expected an Apple Distribution identity",
  );
  assert.ok(!/[\r\n\0]/.test(identity), "Invalid signing identity");
  assert.ok(
    identity.endsWith(`(${team})`),
    "Signing identity Team ID mismatch",
  );
}

function setBuildSetting(block, key, value) {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const setting = new RegExp(`^(\\s*)${escapedKey} = .*;$`, "m");
  if (setting.test(block)) {
    return block.replace(setting, `$1${key} = ${value};`);
  }
  return block.replace(
    /^(\s*)CODE_SIGN_ENTITLEMENTS = .*;$/m,
    `$&\n$1${key} = ${value};`,
  );
}

export function patchProjectForManualSigning(source, inputs) {
  validateInputs(inputs);
  const { team, identity, profileUuid } = inputs;
  const marker = /^\s*CODE_SIGN_ENTITLEMENTS = .*;$/gm;
  const positions = [...source.matchAll(marker)].map((match) => match.index);
  assert.equal(
    positions.length,
    2,
    "Expected exactly two iOS target build configurations",
  );

  let result = source;
  for (const position of positions.reverse()) {
    const start = result.lastIndexOf("buildSettings = {", position);
    const blockEnd = result.slice(position).match(/\n\s*};/);
    const end = blockEnd ? position + blockEnd.index : -1;
    assert.ok(start >= 0 && end > position, "Invalid Xcode project structure");
    let block = result.slice(start, end);
    block = setBuildSetting(block, "CODE_SIGN_STYLE", "Manual");
    block = setBuildSetting(block, "CODE_SIGN_IDENTITY", `\"${identity}\"`);
    block = setBuildSetting(block, "DEVELOPMENT_TEAM", `\"${team}\"`);
    block = setBuildSetting(
      block,
      "PROVISIONING_PROFILE_SPECIFIER",
      `\"${profileUuid}\"`,
    );
    result = result.slice(0, start) + block + result.slice(end);
  }
  return result;
}

export function signingXcconfig(inputs) {
  validateInputs(inputs);
  return [
    "CODE_SIGN_STYLE = Manual",
    `CODE_SIGN_IDENTITY = ${inputs.identity}`,
    `CODE_SIGN_IDENTITY[sdk=iphoneos*] = ${inputs.identity}`,
    `DEVELOPMENT_TEAM = ${inputs.team}`,
    `PROVISIONING_PROFILE_SPECIFIER = ${inputs.profileUuid}`,
    `PROVISIONING_PROFILE_SPECIFIER[sdk=iphoneos*] = ${inputs.profileUuid}`,
    "",
  ].join("\n");
}

export function exportOptionsPlist(inputs) {
  validateInputs(inputs);
  const identity = xmlEscape(inputs.identity);
  const exportMethod = xcodeExportMethod(inputs.exportMethod);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>${exportMethod}</string>
  <key>signingStyle</key><string>manual</string>
  <key>signingCertificate</key><string>${identity}</string>
  <key>teamID</key><string>${inputs.team}</string>
  <key>manageAppVersionAndBuildNumber</key><false/>
  <key>provisioningProfiles</key>
  <dict><key>${iosBundleId}</key><string>${inputs.profileUuid}</string></dict>
</dict>
</plist>
`;
}

export function prepareManualSigning({
  projectPath,
  exportOptionsPath,
  xcconfigPath,
  ...inputs
}) {
  const project = readFileSync(projectPath, "utf8");
  writeFileSync(
    projectPath,
    patchProjectForManualSigning(project, inputs),
    "utf8",
  );
  writeFileSync(exportOptionsPath, exportOptionsPlist(inputs), "utf8");
  writeFileSync(xcconfigPath, signingXcconfig(inputs), { mode: 0o600 });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    prepareManualSigning({
      projectPath: process.env.IOS_XCODE_PROJECT_FILE,
      exportOptionsPath: process.env.IOS_EXPORT_OPTIONS_FILE,
      xcconfigPath: process.env.IOS_SIGNING_XCCONFIG,
      team: process.env.APPLE_TEAM_ID,
      identity: readFileSync(process.env.IOS_SIGNING_IDENTITY_FILE, "utf8").trim(),
      profileUuid: readFileSync(process.env.IOS_PROFILE_UUID_FILE, "utf8").trim(),
      exportMethod: process.env.IOS_EXPORT_METHOD ?? defaultExportMethod,
    });
  } catch (error) {
    console.error(`Failed to prepare explicit iOS signing: ${error.message}`);
    process.exitCode = 1;
  }
}

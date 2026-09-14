#!/usr/bin/env node

/**
 * Builds the `org2-pm` and `org2-ui` CLIs and stages them where tauri's
 * `externalBin` expects: `src-tauri/binaries/<name>-<target-triple>[.exe]`.
 *
 * Unlike the downloaded sidecars (peekaboo, agent-browser, git — fetched
 * into ~/.orgii/bin at first launch), these CLIs are built from this repo and
 * version-locked to the app: agents resolve it via the PATH prepend that
 * points at the app binary's own directory, so the bundle must carry the
 * exact matching build.
 *
 * Usage:
 *   node scripts/tauri/prepare-sidecars.cjs [--profile <debug|release|dev-build>] [--target <triple>]
 */

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const rootDir = path.join(__dirname, "..", "..");
const srcTauriDir = path.join(rootDir, "src-tauri");
const rawArgs = process.argv.slice(2);

function argValue(flag) {
  const index = rawArgs.indexOf(flag);
  return index >= 0 ? (rawArgs[index + 1] ?? null) : null;
}

const profile = argValue("--profile") ?? "debug";
const explicitTarget = argValue("--target");

// Rust-only CI has no node_modules. Build the checked-in catalog here;
// frontend protocol tests verify it against Zod, including its content hash.

function hostTriple() {
  const result = spawnSync("rustc", ["-vV"], { encoding: "utf8" });
  if (result.status !== 0) {
    console.error("[prepare-sidecars] rustc -vV failed");
    process.exit(result.status ?? 1);
  }
  const match = result.stdout.match(/host: (\S+)/);
  if (!match) {
    console.error(
      "[prepare-sidecars] could not parse host triple from rustc -vV"
    );
    process.exit(1);
  }
  return match[1];
}

function cargoTargetDir() {
  const result = spawnSync(
    "cargo",
    ["metadata", "--format-version", "1", "--no-deps"],
    { cwd: srcTauriDir, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }
  );
  if (result.status !== 0) {
    console.error("[prepare-sidecars] cargo metadata failed");
    process.exit(result.status ?? 1);
  }
  return JSON.parse(result.stdout).target_directory;
}

const triple = explicitTarget ?? hostTriple();
const exeSuffix = triple.includes("windows") ? ".exe" : "";

const sidecars = ["org2-pm", "org2-ui"];
const cargoArgs = [
  "build",
  "-p",
  "orgtrack-pm-cli",
  "-p",
  "org2_ui_cli",
  "--bins",
];
if (profile === "release") {
  cargoArgs.push("--release");
} else if (profile !== "debug") {
  cargoArgs.push("--profile", profile);
}
if (explicitTarget) {
  cargoArgs.push("--target", explicitTarget);
}

console.log(`[prepare-sidecars] cargo ${cargoArgs.join(" ")}`);
const build = spawnSync("cargo", cargoArgs, {
  cwd: srcTauriDir,
  stdio: "inherit",
  env: process.env,
});
if (build.status !== 0) {
  console.error("[prepare-sidecars] CLI sidecar build failed");
  process.exit(build.status ?? 1);
}

const profileDir = profile === "debug" ? "debug" : profile;
const builtDir = path.join(
  cargoTargetDir(),
  ...(explicitTarget ? [explicitTarget] : []),
  profileDir
);

const stagingDir = path.join(srcTauriDir, "binaries");
fs.mkdirSync(stagingDir, { recursive: true });
for (const name of sidecars) {
  const builtPath = path.join(builtDir, `${name}${exeSuffix}`);
  if (!fs.existsSync(builtPath)) {
    console.error(`[prepare-sidecars] built binary not found at ${builtPath}`);
    process.exit(1);
  }
  const stagedPath = path.join(stagingDir, `${name}-${triple}${exeSuffix}`);
  fs.copyFileSync(builtPath, stagedPath);
  if (process.platform !== "win32") fs.chmodSync(stagedPath, 0o755);
  console.log(`[prepare-sidecars] staged ${stagedPath}`);
}

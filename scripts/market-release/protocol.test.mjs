import assert from "node:assert/strict";
import test from "node:test";

import { protocolMarker } from "./protocol.mjs";

const commit = "a".repeat(40);
const input = {
  release: "v1.4.0",
  commit,
  tagCommit: commit,
  features: {
    default: ["market-connect"],
    "market-connect": ["dep:market-connect"],
  },
};
test("emits the Console rollout wire contract for the tagged default build", () => {
  assert.deepEqual(protocolMarker(input), {
    release: "v1.4.0",
    protocol: 1,
    sellerProtocol: 1,
    commit,
    capabilities: {
      macos: { buyerPersistentCredentials: true, sellerTemporaryAuthorization: true },
      windows: { buyerPersistentCredentials: true, sellerTemporaryAuthorization: true },
      linux: { buyerPersistentCredentials: false, sellerTemporaryAuthorization: true },
    },
  });
  assert.equal(
    protocolMarker({ ...input, release: "v1.4.0-beta.1" }).protocol,
    1
  );
});
test("rejects a moved tag or abbreviated checkout identity", () => {
  assert.throws(() => protocolMarker({ ...input, tagCommit: "b".repeat(40) }));
  assert.throws(() => protocolMarker({ ...input, commit: "abcdef0" }));
});
test("does not label a module-off default build as Market capable", () => {
  assert.throws(() => protocolMarker({ ...input, features: { default: [] } }));
  assert.throws(() =>
    protocolMarker({ ...input, features: { default: ["market-connect"] } })
  );
});
test("rejects arbitrary revisions and paths as release tags", () => {
  for (const release of [
    "HEAD",
    "--help",
    "v1.0",
    "v1.0.0/../../main",
    "v1.0.0\n",
  ])
    assert.throws(() => protocolMarker({ ...input, release }));
});

test("CLI reads the actual tagged Cargo manifest and refuses output replacement", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } =
    await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join, resolve } = await import("node:path");
  const { execFileSync } = await import("node:child_process");
  const dir = mkdtempSync(join(tmpdir(), "market-protocol-test-"));
  const script = resolve("scripts/market-release/protocol.mjs");
  const run = (tool, args) =>
    execFileSync(tool, args, { cwd: dir, stdio: "pipe" });
  try {
    mkdirSync(join(dir, "src-tauri/src"), { recursive: true });
    writeFileSync(join(dir, "src-tauri/src/lib.rs"), "");
    writeFileSync(
      join(dir, "src-tauri/Cargo.toml"),
      '[package]\nname="org2"\nversion="0.1.0"\n[features]\ndefault=["market-connect"]\nmarket-connect=["dep:market-connect"]\n[dependencies]\nmarket-connect={path="../module",optional=true}\n'
    );
    mkdirSync(join(dir, "module/src"), { recursive: true });
    writeFileSync(join(dir, "module/src/lib.rs"), "");
    writeFileSync(
      join(dir, "module/Cargo.toml"),
      '[package]\nname="market-connect"\nversion="0.1.0"\n'
    );
    run("git", ["init"]);
    run("git", ["add", "."]);
    run("git", [
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-m",
      "fixture",
    ]);
    run("git", ["tag", "v1.4.0"]);
    run(process.execPath, [script, "v1.4.0", "marker.json"]);
    assert.equal(
      JSON.parse(readFileSync(join(dir, "marker.json"))).commit,
      run("git", ["rev-parse", "HEAD"]).toString().trim()
    );
    assert.throws(() =>
      run(process.execPath, [script, "v1.4.0", "marker.json"])
    );
    assert.throws(() =>
      run(process.execPath, [script, "v1.5.0", "missing.json"])
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

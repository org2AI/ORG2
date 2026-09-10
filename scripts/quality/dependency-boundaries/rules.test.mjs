import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const config = require("../../../config/dependency-cruiser.cjs");
test("real graph catches forbidden runtime and type-only edges but permits same-layer imports", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "orgii-boundaries-"));
  const files = {
    "src/api/bad.ts":
      'import { view } from "../components/view"; export const api = view;',
    "src/engines/SessionCore/core/bad.ts":
      'import type { View } from "../../../components/view"; export type Data = View;',
    "src/api/testLeak.ts":
      'import { helper } from "../test/helper"; export const leak = helper;',
    "src/api/good.ts":
      'import { utility } from "./utility"; export const good = utility;',
    "src/api/utility.ts": "export const utility = 1;",
    "src/components/view.ts":
      "export const view = 1; export type View = string;",
    "src/test/helper.ts": "export const helper = 1;",
  };
  try {
    await symlink(
      path.resolve("node_modules"),
      path.join(root, "node_modules"),
      "junction"
    );
    for (const [name, source] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(root, name)), { recursive: true });
      await writeFile(path.join(root, name), source);
    }
    await writeFile(
      path.join(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: { moduleResolution: "node" },
        include: ["src/**/*.ts"],
      })
    );
    const run = spawnSync(
      process.execPath,
      [
        path.resolve(
          "node_modules/dependency-cruiser/bin/dependency-cruise.mjs"
        ),
        "src",
        "--config",
        path.resolve("config/dependency-cruiser.cjs"),
        "--output-type",
        "json",
      ],
      { cwd: root, encoding: "utf8" }
    );
    assert.equal(run.status, 0, run.stderr);
    const report = JSON.parse(run.stdout);
    assert.deepEqual(
      new Set(report.summary.violations.map((v) => v.rule.name)),
      new Set(config.forbidden.map((r) => r.name))
    );
    assert.equal(report.summary.violations.length, 3);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const runner = "scripts/quality/dependency-boundaries/check.mjs";

async function fixture(runTest) {
  const root = await mkdtemp(path.join(os.tmpdir(), "orgii-workspace-audit-"));
  const write = async (name, source) => {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), source);
  };
  const run = (script = runner) =>
    spawnSync(process.execPath, [path.join(root, script)], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    });
  try {
    for (const name of [
      runner,
      "scripts/quality/workspace-sources.mjs",
      "scripts/quality/check-circular-dependencies.mjs",
      "scripts/quality/check-test-placement.mjs",
      "config/dependency-cruiser.cjs",
      "config/madge.json",
    ]) {
      await mkdir(path.dirname(path.join(root, name)), { recursive: true });
      await copyFile(path.join(repo, name), path.join(root, name));
    }
    await write("config/dependency-boundaries-baseline.json", "[]");
    await write(
      "package.json",
      JSON.stringify({ private: true, type: "module" })
    );
    await write(
      "tsconfig.json",
      JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          moduleResolution: "bundler",
          module: "esnext",
          paths: { "@src/*": ["src/*"] },
        },
        include: ["src/**/*.ts", "packages/**/*.ts"],
      })
    );
    for (const name of ["dependency-cruiser", "madge", "typescript"]) {
      await mkdir(path.join(root, "node_modules"), { recursive: true });
      await symlink(
        path.join(repo, "node_modules", name),
        path.join(root, "node_modules", name),
        "junction"
      );
    }
    await write(
      "src/entry.ts",
      'import { value } from "@fixture/a"; export const app = value;'
    );
    for (const name of ["a", "b"]) {
      await write(
        `packages/${name}/package.json`,
        JSON.stringify({
          name: `@fixture/${name}`,
          type: "module",
          private: true,
          exports: { ".": "./src/index.ts", "./types": "./src/types.ts" },
        })
      );
      await write(
        `packages/${name}/src/types.ts`,
        "export type Value = number;"
      );
      await mkdir(path.join(root, "node_modules/@fixture"), {
        recursive: true,
      });
      await symlink(
        path.join(root, "packages", name),
        path.join(root, "node_modules/@fixture", name),
        "junction"
      );
    }
    await write(
      "packages/a/src/index.ts",
      'import type { Value } from "@fixture/b/types"; export const value: Value = 1;'
    );
    await write("packages/b/src/index.ts", "export const other = 2;");
    await runTest({ root, write, run });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("production boundary runner resolves source exports and rejects package imports of the application", async () => {
  await fixture(async ({ write, run }) => {
    const clean = run();
    assert.equal(clean.status, 0, clean.stderr);
    assert.match(clean.stdout, /0 new forbidden edges/);
    // b/index is not reachable from the application's public entry: package
    // roots must also be explicit graph inputs to catch this edge.
    await write(
      "packages/b/src/index.ts",
      'import { app } from "@src/entry"; export const other = app;'
    );
    const bad = run();
    assert.equal(bad.status, 1, bad.stderr);
    assert.match(
      bad.stderr,
      /workspace-package-to-app: packages\/b\/src\/index.ts -> src\/entry.ts/
    );
  });
});

test("production boundary runner rejects cross-package source shortcuts and test dependencies", async () => {
  await fixture(async ({ write, run }) => {
    await write(
      "packages/a/src/index.ts",
      'import { other } from "../../b/src/index"; export const value = other;'
    );
    const privatePath = run();
    assert.equal(privatePath.status, 1, privatePath.stderr);
    assert.match(
      privatePath.stderr,
      /workspace-public-api: packages\/a\/src\/index.ts -> packages\/b\/src\/index.ts/
    );
    await write(
      "packages/a/src/index.ts",
      'import { other } from "@fixture/b/src/index"; export const value = other;'
    );
    const privateSubpath = run();
    assert.equal(privateSubpath.status, 1, privateSubpath.stderr);
    assert.match(privateSubpath.stderr, /workspace-public-api:/);
    await write("packages/a/src/helper.test.ts", "export const helper = 1;");
    await write(
      "packages/a/src/index.ts",
      'import { helper } from "./helper.test"; export const value = helper;'
    );
    const testLeak = run();
    assert.equal(testLeak.status, 1, testLeak.stderr);
    assert.match(
      testLeak.stderr,
      /production-to-tests: packages\/a\/src\/index.ts -> packages\/a\/src\/helper.test.ts/
    );
  });
});

test("production quality runners still work in a checkout without packages", async () => {
  await fixture(async ({ root, write, run }) => {
    await rm(path.join(root, "packages"), { recursive: true });
    await write("src/entry.ts", "export const app = 1;");
    for (const script of [
      runner,
      "scripts/quality/check-circular-dependencies.mjs",
      "scripts/quality/check-test-placement.mjs",
    ]) {
      const result = run(script);
      assert.equal(result.status, 0, `${script}: ${result.stderr}`);
    }
  });
});

test("production cycle runner follows workspace exports instead of accepting skipped external imports", async () => {
  await fixture(async ({ write, run }) => {
    const script = "scripts/quality/check-circular-dependencies.mjs";
    const clean = run(script);
    assert.equal(clean.status, 0, clean.stderr);
    await write(
      "packages/a/src/index.ts",
      'import { other } from "@fixture/b"; export const value = () => other;'
    );
    await write(
      "packages/b/src/index.ts",
      'import { value } from "@fixture/a"; export const other = () => value;'
    );
    const cycle = run(script);
    assert.equal(cycle.status, 1, cycle.stderr);
    assert.match(cycle.stderr, /circular dependenc/);
    assert.match(cycle.stderr, /packages\/a\/src\/index.ts/);
    assert.match(cycle.stderr, /packages\/b\/src\/index.ts/);
  });
});

test("production test-placement runner audits package source roots", async () => {
  await fixture(async ({ write, run }) => {
    await write("packages/a/src/first.test.ts", "export {};");
    await write("packages/a/src/__tests__/second.test.ts", "export {};");
    const mixed = run("scripts/quality/check-test-placement.mjs");
    assert.equal(mixed.status, 1, mixed.stderr);
    assert.match(mixed.stderr, /packages\/a\/src/);
  });
});

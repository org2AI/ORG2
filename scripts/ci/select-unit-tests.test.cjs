const assert = require("node:assert/strict");
const test = require("node:test");

const {
  fullRunReasonForPaths,
  isFullRunPath,
  parseNullDelimitedPaths,
  readsFilesOutsideImports,
  selectUnitTests,
} = require("./select-unit-tests.cjs");

// A small repository: two feature tests, a guard that reads source through a
// helper, a guard that reads a file itself, and a setup file importing a
// fixture.
function fixture(changedPaths) {
  return {
    changedPaths,
    testGraphs: new Map([
      [
        "src/chat/Chat.test.ts",
        new Set(["src/chat/Chat.tsx", "src/shared/logger.ts"]),
      ],
      ["src/util/time.test.ts", new Set(["src/util/time.ts"])],
      [
        "src/app/featureBoundaries.test.ts",
        new Set(["src/test/staticImportGraph.ts"]),
      ],
      ["src/app/startupSurface.test.ts", new Set()],
    ]),
    setupModules: new Set([
      "src/test/vitest.setup.ts",
      "src/i18n/locales/en/sessions.json",
    ]),
    fileSystemModules: new Set([
      "src/test/staticImportGraph.ts",
      "src/app/startupSurface.test.ts",
    ]),
  };
}

const GUARDS = [
  "src/app/featureBoundaries.test.ts",
  "src/app/startupSurface.test.ts",
];

test("a changed module runs the tests whose graphs reach it, plus guards", () => {
  assert.deepEqual(selectUnitTests(fixture(["src/shared/logger.ts"])), {
    mode: "affected",
    files: [...GUARDS, "src/chat/Chat.test.ts"].sort(),
    reached: 1,
    guards: 2,
    total: 4,
  });
});

test("a changed test file runs itself", () => {
  const selection = selectUnitTests(fixture(["src/util/time.test.ts"]));

  assert.equal(selection.mode, "affected");
  assert.deepEqual(selection.files, [...GUARDS, "src/util/time.test.ts"]);
});

test("guard tests run even when no graph reaches the diff", () => {
  // The CI failures that motivated the rule came from Rust and source diffs
  // that these tests read through node:fs instead of importing.
  for (const changedPaths of [
    ["src-tauri/src/app/lifecycle.rs"],
    ["docs/architecture.md"],
  ]) {
    const selection = selectUnitTests(fixture(changedPaths));

    assert.equal(selection.mode, "affected", changedPaths[0]);
    assert.deepEqual(selection.files, GUARDS, changedPaths[0]);
    assert.equal(selection.reached, 0);
  }
});

test("a guard reached by the diff counts once", () => {
  const selection = selectUnitTests(fixture(["src/test/staticImportGraph.ts"]));

  assert.deepEqual(selection.files, GUARDS);
  assert.equal(selection.reached, 1);
  assert.equal(selection.guards, 1);
});

test("setup files and everything they import run the whole suite", () => {
  assert.deepEqual(
    selectUnitTests(fixture(["src/i18n/locales/en/sessions.json"])),
    {
      mode: "all",
      reason:
        "src/i18n/locales/en/sessions.json is a Vitest setup file or imported by one",
    }
  );
  assert.equal(
    selectUnitTests(fixture(["src/test/vitest.setup.ts"])).mode,
    "all"
  );
});

test("install, compiler, and runner changes run the whole suite", () => {
  for (const trigger of [
    "package.json",
    "apps/remote-ios/package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    ".npmrc",
    ".nvmrc",
    "patches/@hugeicons__core-free-icons@4.3.0.patch",
    "tsconfig.json",
    "config/tsconfig.test.json",
    "config/vitest.config.ts",
    "config/vitest.mutation.config.ts",
    "vite.config.mjs",
    ".env",
    ".env.test",
    ".github/workflows/ci.yml",
    "scripts/ci/select-unit-tests.cjs",
    "scripts/ci/run-unit-tests.mjs",
  ]) {
    assert.equal(isFullRunPath(trigger), true, trigger);
    assert.deepEqual(
      selectUnitTests(fixture(["src/util/time.ts", trigger])),
      { mode: "all", reason: `${trigger} changed` },
      trigger
    );
  }
});

test("ordinary source, docs, and other workflows do not trigger the whole suite", () => {
  for (const filePath of [
    "src/components/Button/index.tsx",
    "src/i18n/locales/de/common.json",
    "src/tailwind.css",
    "src-tauri/Cargo.lock",
    "docs/development/codeql.md",
    ".github/workflows/typed-lint.yml",
    "scripts/ci/select-lint-targets.cjs",
    "config/bundle-budget.json",
    "src/config/environment.ts",
  ]) {
    assert.equal(isFullRunPath(filePath), false, filePath);
  }
  assert.equal(fullRunReasonForPaths(["src/util/time.ts"]), null);
});

test("empty diffs fail closed", () => {
  assert.equal(fullRunReasonForPaths([]), "the diff is empty");
  assert.deepEqual(selectUnitTests(fixture([])), {
    mode: "all",
    reason: "the diff is empty",
  });
});

test("file-system and child-process imports mark a module as a guard", () => {
  for (const source of [
    'import { readFileSync } from "node:fs";',
    "import fs from 'fs';",
    'import { readdir } from "node:fs/promises";',
    'const { execSync } = require("child_process");',
    'const fs = await import("node:fs");',
    'import "node:child_process";',
  ]) {
    assert.equal(readsFilesOutsideImports(source), true, source);
  }

  for (const source of [
    'import path from "node:path";',
    'import { useFs } from "@src/hooks/fs";',
    'vi.mock("node:fs");',
    'const label = "fs";',
  ]) {
    assert.equal(readsFilesOutsideImports(source), false, source);
  }
});

test("NUL-delimited paths preserve whitespace", () => {
  assert.deepEqual(
    parseNullDelimitedPaths(Buffer.from("src/a file.ts\0docs/notes.md\0")),
    ["src/a file.ts", "docs/notes.md"]
  );
});

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");

const {
  isI18nRelevantPath,
  parseNullDelimitedPaths,
  requiresI18nCheck,
} = require("./detect-i18n-changes.cjs");

test("frontend source and locale changes require the check", () => {
  assert.equal(requiresI18nCheck(["src/components/Button.tsx"]), true);
  assert.equal(requiresI18nCheck(["src/store/session.ts"]), true);
  assert.equal(requiresI18nCheck(["src/i18n/locales/fr/common.json"]), true);
  assert.equal(requiresI18nCheck(["src/i18n/index.ts"]), true);
});

test("the check, its baseline, its gate, and workflows require the check", () => {
  for (const filePath of [
    "scripts/quality/i18n-keys/check.mjs",
    "config/i18n-keys-baseline.json",
    "scripts/ci/detect-i18n-changes.cjs",
    "scripts/ci/detect-i18n-changes.test.cjs",
    ".github/workflows/ci.yml",
  ]) {
    assert.equal(isI18nRelevantPath(filePath), true, filePath);
  }
});

test("Rust, docs, styles, tests outside src, and tooling skip the check", () => {
  assert.equal(
    requiresI18nCheck([
      "src-tauri/src/main.rs",
      "docs/plan.md",
      "src/styles/app.scss",
      "tests/e2e/specs/core/session.spec.mjs",
      "scripts/tauri/prepare-sidecars.cjs",
      "package.json",
      "README.md",
    ]),
    false
  );
});

test("an empty diff fails closed", () => {
  assert.equal(requiresI18nCheck([]), true);
});

test("null-delimited stdin parsing drops empty entries", () => {
  assert.deepEqual(
    parseNullDelimitedPaths(Buffer.from("src/a.tsx\0docs/b.md\0\0")),
    ["src/a.tsx", "docs/b.md"]
  );
});

test("CLI prints the decision for a null-delimited path list", () => {
  const script = path.join(__dirname, "detect-i18n-changes.cjs");
  const run = (input) =>
    spawnSync(process.execPath, [script], { input, encoding: "utf8" });
  assert.equal(run("docs/a.md\0src-tauri/src/lib.rs\0").stdout, "false\n");
  assert.equal(run("src/App.tsx\0").stdout, "true\n");
});

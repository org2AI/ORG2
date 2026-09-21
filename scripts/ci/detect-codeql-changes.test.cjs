const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { LANGUAGES, selectLanguages } = require("./detect-codeql-changes.cjs");

test("Rust and frontend source changes select only their own language", () => {
  assert.deepEqual(selectLanguages(["src-tauri/src/lib.rs"]), ["rust"]);
  assert.deepEqual(selectLanguages(["src/components/Button/index.tsx"]), [
    "javascript-typescript",
  ]);
  assert.deepEqual(selectLanguages(["scripts/check.py"]), ["python"]);
  assert.deepEqual(selectLanguages(["README.md", "src/app.scss"]), []);
});

test("dependency, toolchain and extraction inputs select the owning languages", () => {
  for (const file of [
    "Cargo.toml",
    "apps/remote-ios/src-tauri/Cargo.lock",
    "src-tauri/.cargo/config.toml",
    "rust-toolchain.toml",
  ])
    assert.deepEqual(selectLanguages([file]), ["rust"], file);
  for (const file of [
    "package.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "tsconfig.json",
    "config/webpack.config.cjs",
    "public/index.html",
    "src/data.xml",
    "src/a.mts",
    "src/a.cts",
    "src/a.vue",
    "src/a.ejs",
  ])
    assert.deepEqual(selectLanguages([file]), ["javascript-typescript"], file);
  for (const file of [
    "tests/requirements-dev.txt",
    "pyproject.toml",
    "uv.lock",
    "Pipfile.lock",
    "src/types.pyi",
  ])
    assert.deepEqual(selectLanguages([file]), ["python"], file);
});

test("Actions YAML retains Actions and JS extractor coverage without Rust", () => {
  for (const file of [".github/workflows/ci.yml", "tools/action.yaml"]) {
    assert.deepEqual(selectLanguages([file]), [
      "actions",
      "javascript-typescript",
    ]);
  }
});

test("mixed changes deduplicate languages in stable order", () => {
  assert.deepEqual(selectLanguages(["a.rs", "a.ts", "b.rs", "a.py"]), [
    "javascript-typescript",
    "python",
    "rust",
  ]);
});

test("empty diffs and scanner policy changes scan everything", () => {
  assert.deepEqual(selectLanguages([]), LANGUAGES);
  for (const file of [
    ".github/workflows/codeql.yml",
    ".github/codeql/config.yml",
    "scripts/ci/detect-codeql-changes.cjs",
    "scripts/ci/detect-codeql-changes.test.cjs",
    "queries/custom.ql",
  ])
    assert.deepEqual(selectLanguages([file]), LANGUAGES);
});

test("real git diff preserves deletions and both sides of cross-language renames", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "codeql-scope-"));
  function git(...args) {
    const result = spawnSync("git", args, { cwd, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  }
  try {
    git("init", "-q");
    // A commit can leave detached gc/maintenance writing into .git, which
    // races the cleanup below (ENOTEMPTY on CI).
    git("config", "gc.auto", "0");
    git("config", "maintenance.auto", "false");
    fs.writeFileSync(path.join(cwd, "old.rs"), "// shared content\n");
    fs.writeFileSync(path.join(cwd, "removed.py"), "# removed\n");
    git("add", ".");
    git(
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-qm",
      "base"
    );
    fs.renameSync(path.join(cwd, "old.rs"), path.join(cwd, "new name\n.ts"));
    fs.unlinkSync(path.join(cwd, "removed.py"));
    git("add", "-A");
    const input = git(
      "diff",
      "--cached",
      "--no-renames",
      "--name-only",
      "-z",
      "HEAD"
    );
    const result = spawnSync(
      process.execPath,
      [path.join(__dirname, "detect-codeql-changes.cjs")],
      { input, encoding: "utf8" }
    );
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), [
      "javascript-typescript",
      "python",
      "rust",
    ]);
  } finally {
    fs.rmSync(cwd, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }
});

#!/usr/bin/env node

// Fails a pull request that leaves a TypeScript file it touched longer than
// MAX_LINES.
//
// Only the diff is judged. A long file that a pull request does not touch never
// fails this check, so existing files get split the next time someone edits
// them instead of in one repo-wide sweep. The workflow passes the paths the pull
// request added, copied, modified, or renamed (git diff --diff-filter=ACMR), so
// deleted files never reach this script.
//
// Only .ts and .tsx files under src/ are judged. Docs, Markdown, JSON (locale
// catalogs included), styles, Rust, scripts, and the vendored JavaScript under
// src/ are out of scope. Test code is exempt too: test files, the shared Vitest
// setup, and the E2E bootstrap helpers grow with coverage, not with
// responsibilities. The same goes for files whose length tracks data rather than
// logic:
// - i18n code: the locale registry and loaders grow with every language.
// - Declaration files (.d.ts): type shims mirror the API they describe.
// - Data tables listed in DATA_TABLE_FILES, which grow one entry at a time.
// - Generated code: a file whose header comment says it is generated and must
//   not be edited by hand. Splitting it by hand is undone on the next
//   regeneration.

const fs = require("node:fs");
const path = require("node:path");

const MAX_LINES = 700;

const SOURCE_PREFIX = "src/";
const SOURCE_EXTENSIONS = Object.freeze([".ts", ".tsx"]);

const EXEMPT_PATTERNS = Object.freeze([
  // Unit tests.
  /\.test\.tsx?$/,
  // Shared Vitest setup and test helpers.
  /^src\/test\//,
  // E2E bootstrap helpers, seeders, and fixtures.
  /^src\/app\/root\/e2e\//,
  // i18n registry, loaders, and any locale data kept in TypeScript.
  /^src\/i18n\//,
  /(^|\/)locales\//,
  // Type declarations carry no runtime logic.
  /\.d\.ts$/,
]);

// Pure data tables, listed one by one so this never turns into a blanket
// exemption for large files.
const DATA_TABLE_FILES = Object.freeze([
  // File-type metadata: one entry per supported language or extension.
  "src/config/languageRegistry.ts",
]);

// A generated file declares itself in a comment near the top, e.g.
// "// Generated from ... Do not edit" or " * DO NOT EDIT BY HAND."
const GENERATED_HEADER_LINES = 10;
const GENERATED_MARKER =
  /^\s*(?:\/\/|\/\*|\*).*(?:\bdo not edit\b|@generated\b)/i;

function isGeneratedSource(text) {
  return text
    .split("\n", GENERATED_HEADER_LINES)
    .some((line) => GENERATED_MARKER.test(line));
}

function isCheckedSource(filePath) {
  return (
    filePath.startsWith(SOURCE_PREFIX) &&
    SOURCE_EXTENSIONS.some((extension) => filePath.endsWith(extension)) &&
    !EXEMPT_PATTERNS.some((pattern) => pattern.test(filePath)) &&
    !DATA_TABLE_FILES.includes(filePath)
  );
}

// Counts lines the way an editor numbers them: a trailing newline ends the last
// line instead of starting a new one.
function countLines(text) {
  if (text.length === 0) return 0;
  const newlines = text.split("\n").length - 1;
  return text.endsWith("\n") ? newlines : newlines + 1;
}

// Returns the checked files that exceed maxLines, longest first. A listed path
// that is missing from the checkout throws instead of passing silently: the
// diff only names files that exist at the head, so a miss means the script is
// reading the wrong tree.
function findOversizedFiles(
  filePaths,
  { root = process.cwd(), maxLines = MAX_LINES } = {}
) {
  const oversized = [];
  for (const filePath of new Set(filePaths)) {
    if (!isCheckedSource(filePath)) continue;
    const text = fs.readFileSync(path.join(root, filePath), "utf8");
    if (isGeneratedSource(text)) continue;
    const lines = countLines(text);
    if (lines > maxLines) oversized.push({ filePath, lines });
  }
  return oversized.sort(
    (a, b) => b.lines - a.lines || a.filePath.localeCompare(b.filePath)
  );
}

function parseNullDelimitedPaths(input) {
  return input.toString("utf8").split("\0").filter(Boolean);
}

if (require.main === module) {
  const filePaths = parseNullDelimitedPaths(fs.readFileSync(0));
  const checkedCount = new Set(filePaths.filter(isCheckedSource)).size;
  const oversized = findOversizedFiles(filePaths);

  if (oversized.length === 0) {
    process.stdout.write(
      `File length: ${checkedCount} changed TypeScript files checked, all within ${MAX_LINES} lines.\n`
    );
  } else {
    if (process.env.GITHUB_ACTIONS === "true") {
      // Workflow commands put an annotation on the first line past the limit.
      for (const { filePath, lines } of oversized) {
        process.stdout.write(
          `::error file=${filePath},line=${MAX_LINES + 1},title=File too long::` +
            `${filePath} has ${lines} lines; files a pull request touches must stay within ${MAX_LINES}.\n`
        );
      }
    }
    const width = Math.max(...oversized.map(({ filePath }) => filePath.length));
    process.stderr.write(
      [
        `File length: ${oversized.length} changed TypeScript file(s) exceed ${MAX_LINES} lines.`,
        ...oversized.map(
          ({ filePath, lines }) => `  ${filePath.padEnd(width)}  ${lines} lines`
        ),
        "Split each file into smaller modules before merging (keep the original path as the entry point).",
        "Only files this pull request touches are checked; see scripts/ci/check-changed-file-length.cjs.",
        "",
      ].join("\n")
    );
    process.exitCode = 1;
  }
}

module.exports = {
  MAX_LINES,
  countLines,
  findOversizedFiles,
  isCheckedSource,
  isGeneratedSource,
  parseNullDelimitedPaths,
};

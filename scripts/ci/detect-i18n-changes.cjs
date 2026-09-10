#!/usr/bin/env node

const fs = require("node:fs");

// The i18n key check cross-references `t()` call sites in frontend source
// against the locale catalogs. Either side can introduce a finding: a new
// `t("key")` in a .tsx file with no English entry, or a locale edit that drops
// a key still referenced. So the gate fires on any frontend source or locale
// change, and skips Rust-only, docs-only, and tooling-only diffs.
const I18N_RELEVANT_PREFIXES = Object.freeze([
  // Locale catalogs and the i18n bootstrap.
  "src/i18n/",
  // The check itself, its baseline, and this gate.
  "scripts/quality/i18n-keys/",
  "scripts/ci/detect-i18n-changes",
  "config/i18n-keys-baseline.json",
  // Workflow definitions decide how (and whether) the check runs.
  ".github/workflows/",
]);

const FRONTEND_SOURCE_RE = /^src\/.*\.(?:ts|tsx)$/;

function isI18nRelevantPath(filePath) {
  return (
    I18N_RELEVANT_PREFIXES.some((prefix) => filePath.startsWith(prefix)) ||
    FRONTEND_SOURCE_RE.test(filePath)
  );
}

function requiresI18nCheck(filePaths) {
  // Fail closed when diff discovery yields nothing unexpectedly.
  return filePaths.length === 0 || filePaths.some(isI18nRelevantPath);
}

function parseNullDelimitedPaths(input) {
  return input.toString("utf8").split("\0").filter(Boolean);
}

if (require.main === module) {
  const filePaths = parseNullDelimitedPaths(fs.readFileSync(0));
  process.stdout.write(`${requiresI18nCheck(filePaths)}\n`);
}

module.exports = {
  isI18nRelevantPath,
  parseNullDelimitedPaths,
  requiresI18nCheck,
};

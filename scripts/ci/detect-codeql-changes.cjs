#!/usr/bin/env node

const fs = require("node:fs");

const LANGUAGES = Object.freeze([
  "actions",
  "javascript-typescript",
  "python",
  "rust",
]);

function selectLanguages(paths) {
  // An empty/unavailable diff must never silently disable scanning. Changes
  // to the scanning policy itself also exercise every language.
  if (
    paths.length === 0 ||
    paths.some(
      (file) =>
        file === ".github/workflows/codeql.yml" ||
        file.startsWith(".github/codeql/") ||
        file.startsWith("scripts/ci/detect-codeql-changes.") ||
        /\.(ql|qll)$/.test(file) ||
        /(^|\/)(codeql-pack|qlpack)\.yml$/.test(file)
    )
  ) {
    return [...LANGUAGES];
  }

  const selected = new Set();
  for (const file of paths) {
    if (
      /^\.github\/workflows\/[^/]+\.ya?ml$/.test(file) ||
      /(^|\/)action\.ya?ml$/.test(file)
    ) {
      selected.add("actions");
    }
    // Include templates and data/config formats consumed by the JS extractor,
    // not just React source. This intentionally errs toward coverage.
    if (
      /\.(js|jsx|mjs|cjs|ts|tsx|mts|cts|es|es6|html?|xhtml?|vue|hbs|ejs|njk|json|ya?ml|raml|xml)$/.test(
        file
      ) ||
      /(^|\/)(yarn\.lock|bun\.lockb?|\.npmrc|\.yarnrc.*)$/.test(file)
    ) {
      selected.add("javascript-typescript");
    }
    if (
      /\.(py|pyi)$/.test(file) ||
      /(^|\/)(requirements[^/]*\.(txt|in)|pyproject\.toml|poetry\.lock|uv\.lock|Pipfile(\.lock)?|setup\.cfg|tox\.ini|\.python-version)$/.test(
        file
      )
    ) {
      selected.add("python");
    }
    if (
      /\.rs$/.test(file) ||
      /(^|\/)(Cargo\.(toml|lock)|rust-toolchain(\.toml)?)$/.test(file) ||
      /(^|\/)\.cargo\//.test(file)
    ) {
      selected.add("rust");
    }
  }
  return LANGUAGES.filter((language) => selected.has(language));
}

if (require.main === module) {
  const paths = fs.readFileSync(0, "utf8").split("\0").filter(Boolean);
  process.stdout.write(`${JSON.stringify(selectLanguages(paths))}\n`);
}

module.exports = { LANGUAGES, selectLanguages };

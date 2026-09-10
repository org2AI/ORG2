/**
 * i18n key check — five finding categories, one baseline ratchet.
 *
 *   missing               code references a key the English catalog does not define
 *   unused                the English catalog defines a key no code references
 *   localeGaps            English defines a key another locale lacks
 *   localeExtras          a locale defines a key English lacks (dead)
 *   placeholderMismatches a locale's {{placeholders}} differ from English
 *
 * Usage:
 *   node scripts/quality/i18n-keys/check.mjs                  fail on findings not in the baseline
 *   node scripts/quality/i18n-keys/check.mjs --report         print every current finding
 *   node scripts/quality/i18n-keys/check.mjs --json           machine-readable findings for tooling
 *   node scripts/quality/i18n-keys/check.mjs --write-baseline rewrite config/i18n-keys-baseline.json
 *
 * The baseline records today's debt so the check can land without a sweep;
 * every entry it contains is a follow-up, not an endorsement. Fixed entries
 * are reported so the baseline can be shrunk with --write-baseline.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { analyze, diffAgainstBaseline } from "./analyze.mjs";
import { SOURCE_LANG, compareLocales, indexLanguage } from "./catalog.mjs";
import { extractUsages } from "./usages.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.."
);
const localesDir = path.join(root, "src/i18n/locales");
const sourceDir = path.join(root, "src");
const baselinePath = path.join(root, "config/i18n-keys-baseline.json");
const DEFAULT_NS = "common";

const args = process.argv.slice(2);
const KNOWN_FLAGS = new Set(["--write-baseline", "--report", "--json"]);
for (const arg of args) {
  if (!KNOWN_FLAGS.has(arg))
    throw new Error(
      `Unknown flag ${arg}; supported: ${[...KNOWN_FLAGS].join(", ")}`
    );
}

const SKIP_DIRS = new Set(["__tests__", "node_modules", "locales"]);
const SKIP_FILE_RE = /(\.test\.tsx?|\.d\.ts|\.stories\.tsx?)$/;

/** Product source only: tests do not keep a key alive and do not report gaps. */
export function listSourceFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (SKIP_DIRS.has(name) || full === path.join(sourceDir, "test"))
        continue;
      listSourceFiles(full, out);
    } else if (/\.tsx?$/.test(name) && !SKIP_FILE_RE.test(name)) {
      out.push(full);
    }
  }
  return out;
}

const sourceIndex = indexLanguage(localesDir, SOURCE_LANG);
const namespaces = new Set(sourceIndex.keys());
const usages = [];
const literals = new Set();
const keyPrefixes = new Set();
const files = listSourceFiles(sourceDir);
for (const file of files) {
  const relative = path.relative(root, file);
  const extracted = extractUsages(readFileSync(file, "utf8"), relative, {
    defaultNs: DEFAULT_NS,
    namespaces,
  });
  usages.push(...extracted.usages);
  for (const literal of extracted.literals) literals.add(literal);
  for (const prefix of extracted.keyPrefixes) keyPrefixes.add(prefix);
}

// The Rust side ships some keys to the frontend as data (builtin tool label
// tables in agent-core, for example), so its string literals count as
// key-path literals too. They mark keys used; they never report keys missing.
const RUST_LITERAL_RE =
  /"((?:[A-Za-z][\w-]*:)?[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+[._]?)"/g;
export function listRustFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "target" || name === "node_modules") continue;
      listRustFiles(full, out);
    } else if (name.endsWith(".rs")) {
      out.push(full);
    }
  }
  return out;
}
const rustFiles = listRustFiles(path.join(root, "src-tauri"));
let rustLiterals = 0;
for (const file of rustFiles) {
  for (const match of readFileSync(file, "utf8").matchAll(RUST_LITERAL_RE)) {
    if (!literals.has(match[1])) rustLiterals++;
    literals.add(match[1]);
  }
}

const { missing, unused, stats } = analyze(sourceIndex, usages, literals, {
  keyPrefixes,
});
const locales = compareLocales(localesDir, sourceIndex);
const dynamic = usages.filter((usage) => usage.kind === "dynamic");
const current = {
  missing: missing.map((finding) => finding.id),
  unused,
  localeGaps: locales.gaps,
  localeExtras: locales.extras,
  placeholderMismatches: locales.placeholderMismatches,
};
const CATEGORIES = Object.keys(current);
const totalLeaves = [...sourceIndex.values()].reduce(
  (sum, ns) => sum + ns.leaves.size,
  0
);

const countBy = (entries, splitAt) => {
  const counts = new Map();
  for (const entry of entries) {
    const group = entry.slice(0, entry.indexOf(splitAt));
    counts.set(group, (counts.get(group) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1]);
};

if (args.includes("--json")) {
  process.stdout.write(
    JSON.stringify(
      {
        ...current,
        missingDetails: missing,
        dynamic,
        stats: { files: files.length, englishKeys: totalLeaves, ...stats },
      },
      null,
      2
    ) + "\n"
  );
  process.exit(0);
}

console.log(
  `Scanned ${files.length} files, ${totalLeaves} English keys: ` +
    `${stats.static} static, ${stats.pattern} pattern, ${stats.dynamic} dynamic t() calls ` +
    `(${stats.loose} loosely bound); ${stats.literalHits} key-path literal hits ` +
    `(${rustLiterals} literals from ${rustFiles.length} Rust files).`
);

if (args.includes("--write-baseline")) {
  writeFileSync(baselinePath, JSON.stringify(current, null, 2) + "\n");
  console.log(
    `Wrote baseline: ${CATEGORIES.map((c) => `${current[c].length} ${c}`).join(", ")}. ` +
      "Review the diff before committing."
  );
} else if (args.includes("--report")) {
  console.log(`\nMissing keys (${missing.length}):`);
  for (const finding of missing) {
    console.log(
      `  ${finding.file}:${finding.line}  ${finding.namespaces?.join("|") ?? "*"}:${finding.key}` +
        (finding.hasDefault ? "  (has defaultValue)" : "")
    );
  }
  console.log(`\nUnused keys (${unused.length}):`);
  for (const [ns, count] of countBy(unused, ":"))
    console.log(`  ${ns}: ${count}`);
  for (const entry of unused) console.log(`  ${entry}`);
  for (const [category, label] of [
    ["localeGaps", "Locale gaps"],
    ["localeExtras", "Locale-only keys"],
    ["placeholderMismatches", "Placeholder mismatches"],
  ]) {
    console.log(`\n${label} (${current[category].length}):`);
    for (const [locale, count] of countBy(current[category], "/"))
      console.log(`  ${locale}: ${count}`);
    if (category !== "localeGaps")
      for (const entry of current[category]) console.log(`  ${entry}`);
  }
  console.log(
    `\nDynamic keys (${dynamic.length}) — resolved at runtime, not checked; ` +
      "their literal values count as used when they look like key paths:"
  );
  for (const usage of dynamic)
    console.log(`  ${usage.file}:${usage.line}  t(${usage.expr})`);
} else {
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  let failed = false;
  for (const category of CATEGORIES) {
    const { added, fixed } = diffAgainstBaseline(
      current[category],
      baseline[category] ?? []
    );
    if (added.length) {
      failed = true;
      console.error(
        `\n${category}: ${added.length} new finding(s) not in the baseline:`
      );
      for (const entry of added) {
        const finding =
          category === "missing" ? missing.find((f) => f.id === entry) : null;
        console.error(`  ${entry}${finding ? `  (line ${finding.line})` : ""}`);
      }
    }
    console.log(
      `${category}: ${current[category].length} current, ${baseline[category]?.length ?? 0} baselined, ` +
        `${added.length} new, ${fixed.length} fixed`
    );
  }
  if (failed) {
    console.error(
      "\nmissing: add the key to src/i18n/locales/en/<namespace>.json (and every other locale)." +
        "\nunused: delete the key from every locale, or reference it from product code." +
        "\nlocaleGaps: add the translated key to that locale (`check-missing-i18n-keys.mjs --fix` seeds English)." +
        "\nlocaleExtras: delete the key from that locale; English no longer defines it." +
        "\nplaceholderMismatches: make the {{placeholders}} match the English value." +
        "\nIf a finding is a scanner false positive, describe it in the PR and refresh with --write-baseline."
    );
    process.exitCode = 1;
  }
}

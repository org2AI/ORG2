/**
 * Translation catalog model.
 *
 * Loads `src/i18n/locales/<lang>/<namespace>.json` into an index that the
 * usage analyzer can query: leaf keys, internal (object) nodes, and the
 * plural/ordinal families that i18next resolves from a single base key.
 */
import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

export const SOURCE_LANG = "en";

const PLURAL_SUFFIX_RE = /^(.*?)_(?:ordinal_)?(?:zero|one|two|few|many|other)$/;
const CONTEXT_SUFFIX_RE = /^(.*)_[^._]+$/;

/** Locale files may carry a UTF-8 BOM; strip it so JSON.parse doesn't choke. */
export function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf-8").replace(/^﻿/, ""));
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Flatten a locale JSON object into leaf key paths and internal node paths.
 * Arrays are leaves (i18next returns them via `returnObjects`).
 */
export function flattenNamespace(data) {
  const leaves = [];
  const nodes = [];
  const values = new Map();
  const walk = (obj, prefix) => {
    for (const [key, value] of Object.entries(obj)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (isObject(value)) {
        nodes.push(path);
        walk(value, path);
      } else {
        leaves.push(path);
        values.set(path, value);
      }
    }
  };
  walk(data, "");
  return { leaves, nodes, values };
}

/** Interpolation placeholders of one translation, as a sorted unique list. */
export function placeholders(value) {
  if (typeof value !== "string") return [];
  const found = value.match(/\{\{\s*[\w.-]+\s*\}\}/g) ?? [];
  return [...new Set(found.map((match) => match.replace(/\s/g, "")))].sort();
}

/**
 * The key a suffixed sibling is reached from at runtime:
 * `foo_one` / `foo_ordinal_other` (plurals) and `foo_male` (context) → `foo`.
 * Returns the key itself when it carries no suffix.
 */
export function siblingBase(key) {
  const plural = PLURAL_SUFFIX_RE.exec(key);
  if (plural) return plural[1];
  const context = CONTEXT_SUFFIX_RE.exec(key);
  return context ? context[1] : key;
}

/**
 * Build the per-namespace index for one language directory.
 *
 * @returns Map<namespace, { leaves: Set<string>, nodes: Set<string>,
 *   families: Map<baseKey, string[]> }>  — families group the plural and
 *   context siblings that a single `t(baseKey, { count | context })` reaches.
 */
export function indexLanguage(localesDir, lang) {
  const dir = join(localesDir, lang);
  const namespaces = new Map();
  for (const fileName of readdirSync(dir)) {
    if (!fileName.endsWith(".json")) continue;
    const ns = basename(fileName, ".json");
    const { leaves, nodes, values } = flattenNamespace(
      readJson(join(dir, fileName))
    );
    const families = new Map();
    for (const leaf of leaves) {
      const base = siblingBase(leaf);
      if (base === leaf) continue;
      if (!families.has(base)) families.set(base, []);
      families.get(base).push(leaf);
    }
    namespaces.set(ns, {
      leaves: new Set(leaves),
      nodes: new Set(nodes),
      families,
      values,
    });
  }
  return namespaces;
}

export function listLanguages(localesDir) {
  return readdirSync(localesDir)
    .filter((name) => !name.startsWith("."))
    .sort();
}

/**
 * Compare every other locale against the source language.
 *
 *   gaps      source keys the locale lacks               → `lang/ns:key`
 *   extras    locale keys the source lacks (dead)        → `lang/ns:key`
 *   mismatch  {{placeholder}} sets differ from the source → `lang/ns:key`
 *
 * A namespace file that does not exist in a locale is skipped: the runtime
 * loader falls back to English for those by design (see
 * `loadMobileRemoteBundle` in src/i18n/index.ts).
 */
export function compareLocales(localesDir, sourceIndex) {
  const gaps = [];
  const extras = [];
  const placeholderMismatches = [];
  for (const lang of listLanguages(localesDir)) {
    if (lang === SOURCE_LANG) continue;
    const langIndex = indexLanguage(localesDir, lang);
    for (const [ns, source] of sourceIndex) {
      const target = langIndex.get(ns);
      if (!target) continue;
      for (const key of source.leaves) {
        if (!target.leaves.has(key)) {
          gaps.push(`${lang}/${ns}:${key}`);
        } else if (
          placeholders(source.values.get(key)).join() !==
          placeholders(target.values.get(key)).join()
        ) {
          placeholderMismatches.push(`${lang}/${ns}:${key}`);
        }
      }
      for (const key of target.leaves) {
        if (!source.leaves.has(key)) extras.push(`${lang}/${ns}:${key}`);
      }
    }
  }
  return { gaps, extras, placeholderMismatches };
}

/** Source keys another locale lacks; see `compareLocales`. */
export function localeGaps(localesDir, sourceIndex) {
  return compareLocales(localesDir, sourceIndex).gaps;
}

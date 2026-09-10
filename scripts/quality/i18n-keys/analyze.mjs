/**
 * Cross-reference extracted usages against the source-language catalog.
 *
 *   missing → a resolved usage whose key exists in none of its candidate
 *             namespaces (a runtime `t()` would render the raw key)
 *   unused  → a catalog leaf no usage, pattern, or key-path literal touches
 */

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function leavesUnder(index, prefix) {
  const dotted = `${prefix}.`;
  const out = [];
  for (const leaf of index.leaves) if (leaf.startsWith(dotted)) out.push(leaf);
  return out;
}

/** Raw catalog leaves a static key resolves to in one namespace. */
export function resolveStatic(index, key) {
  // A plain leaf and its `_one` / `_other` / `_<context>` siblings are one
  // family: i18next picks a sibling when `count` or `context` is passed and
  // the plain key otherwise.
  const family = index.families.get(key) ?? [];
  if (index.leaves.has(key)) return [key, ...family];
  if (family.length) return family;
  if (index.nodes.has(key)) return leavesUnder(index, key);
  return [];
}

function resolvePattern(index, regexSource) {
  const regex = new RegExp(regexSource);
  const out = [];
  for (const leaf of index.leaves) if (regex.test(leaf)) out.push(leaf);
  return out;
}

function missingId(usage) {
  const ns = usage.namespaces ? usage.namespaces.join("|") : "*";
  return `${usage.file} ${ns}:${usage.key}`;
}

/**
 * @param {Map<string, {leaves:Set<string>, nodes:Set<string>, families:Map}>} sourceIndex
 * @param {Array} usages      from extractUsages, concatenated across files
 * @param {Iterable<string>} literals  key-path literals, concatenated across files
 * @param {object} [options]
 * @param {Iterable<string>} [options.keyPrefixes]  every `keyPrefix` seen in the
 *   codebase; a loosely bound `t` (passed down from a prefixed hook) is retried
 *   under each of them before being reported missing
 */
export function analyze(
  sourceIndex,
  usages,
  literals,
  { keyPrefixes = [] } = {}
) {
  const allNamespaces = [...sourceIndex.keys()];
  const used = new Map(allNamespaces.map((ns) => [ns, new Set()]));
  const mark = (ns, leaves) => {
    const set = used.get(ns);
    for (const leaf of leaves) set.add(leaf);
  };

  const missing = [];
  const stats = { static: 0, pattern: 0, dynamic: 0, loose: 0, literalHits: 0 };

  const resolveIn = (index, usage, prefix) => {
    if (usage.kind === "static")
      return resolveStatic(
        index,
        prefix ? `${prefix}.${usage.key}` : usage.key
      );
    const regex = prefix
      ? `^${escapeRegex(prefix)}\\.${usage.regex.slice(1)}`
      : usage.regex;
    return resolvePattern(index, regex);
  };

  for (const usage of usages) {
    if (usage.kind === "dynamic") {
      stats.dynamic++;
      continue;
    }
    stats[usage.kind]++;
    if (!usage.namespaces) stats.loose++;
    const candidates = usage.namespaces ?? allNamespaces;
    const prefixes = usage.namespaces ? [null] : [null, ...keyPrefixes];
    let found = false;
    for (const prefix of prefixes) {
      for (const ns of candidates) {
        const index = sourceIndex.get(ns);
        if (!index) continue;
        const leaves = resolveIn(index, usage, prefix);
        if (leaves.length) {
          mark(ns, leaves);
          found = true;
        }
      }
      if (found) break;
    }
    if (!found) missing.push({ ...usage, id: missingId(usage) });
  }

  for (const literal of literals) {
    const colon = literal.indexOf(":");
    let candidates = allNamespaces;
    let key = literal;
    if (colon > 0 && sourceIndex.has(literal.slice(0, colon))) {
      candidates = [literal.slice(0, colon)];
      key = literal.slice(colon + 1);
    }
    // A trailing separator marks a prefix assembled outside t(): credit every
    // key under it (`items.` → items.*, `kind_` → kind_a, kind_b …).
    const prefix = /[._]$/.test(key) ? key : null;
    for (const ns of candidates) {
      const index = sourceIndex.get(ns);
      let leaves;
      if (prefix) {
        leaves = [];
        for (const leaf of index.leaves)
          if (leaf.startsWith(prefix)) leaves.push(leaf);
      } else {
        leaves = index.leaves.has(key)
          ? [key, ...(index.families.get(key) ?? [])]
          : (index.families.get(key) ??
            (index.nodes.has(key) ? leavesUnder(index, key) : []));
      }
      if (leaves.length) {
        mark(ns, leaves);
        stats.literalHits++;
      }
    }
  }

  const unused = [];
  for (const [ns, index] of sourceIndex) {
    const usedSet = used.get(ns);
    for (const leaf of index.leaves)
      if (!usedSet.has(leaf)) unused.push(`${ns}:${leaf}`);
  }

  missing.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { missing, unused, stats };
}

/** Entries of `current` absent from `baseline`, and vice versa. */
export function diffAgainstBaseline(current, baseline) {
  const baselineSet = new Set(baseline);
  const currentSet = new Set(current);
  return {
    added: current.filter((entry) => !baselineSet.has(entry)),
    fixed: baseline.filter((entry) => !currentSet.has(entry)),
  };
}

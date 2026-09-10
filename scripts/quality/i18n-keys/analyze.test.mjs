import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { analyze, diffAgainstBaseline, resolveStatic } from "./analyze.mjs";
import {
  compareLocales,
  flattenNamespace,
  indexLanguage,
  localeGaps,
  placeholders,
  siblingBase,
} from "./catalog.mjs";

function makeLocales(tree) {
  const dir = mkdtempSync(join(tmpdir(), "i18n-keys-"));
  for (const [lang, namespaces] of Object.entries(tree)) {
    mkdirSync(join(dir, lang));
    for (const [ns, data] of Object.entries(namespaces)) {
      writeFileSync(join(dir, lang, `${ns}.json`), "﻿" + JSON.stringify(data));
    }
  }
  return dir;
}

const EN = {
  common: {
    actions: { save: "Save", cancel: "Cancel" },
    files_one: "{{count}} file",
    files_other: "{{count}} files",
    days: "days",
    days_one: "day",
    days_other: "days",
    friend: "Friend",
    friend_male: "Boyfriend",
    status: { running: "Running", done: "Done" },
    list: ["a", "b"],
  },
  sessions: {
    chat: { send: "Send", allThreads: "All" },
    kanban: { column: { title: "T" } },
  },
};

const usage = (key, namespaces, extra = {}) => ({
  kind: "static",
  key,
  namespaces,
  file: "src/a.tsx",
  line: 1,
  ...extra,
});

test("flattenNamespace separates leaves from nodes; arrays are leaves", () => {
  const { leaves, nodes } = flattenNamespace(EN.common);
  assert.ok(leaves.includes("actions.save"));
  assert.ok(leaves.includes("list"));
  assert.deepEqual(nodes, ["actions", "status"]);
});

test("siblingBase strips plural, ordinal, and context suffixes within one segment", () => {
  assert.equal(siblingBase("files_one"), "files");
  assert.equal(siblingBase("rank_ordinal_two"), "rank");
  assert.equal(siblingBase("friend_male"), "friend");
  assert.equal(siblingBase("a.b.friend_male"), "a.b.friend");
  assert.equal(siblingBase("plain"), "plain");
  assert.equal(siblingBase("a_b.c"), "a_b.c");
});

test("resolveStatic handles leaves, plural families, nodes, and context", () => {
  const dir = makeLocales({ en: EN });
  const common = indexLanguage(dir, "en").get("common");
  assert.deepEqual(resolveStatic(common, "actions.save"), ["actions.save"]);
  assert.deepEqual(resolveStatic(common, "files"), [
    "files_one",
    "files_other",
  ]);
  assert.deepEqual(resolveStatic(common, "days"), [
    "days",
    "days_one",
    "days_other",
  ]);
  assert.deepEqual(resolveStatic(common, "status"), [
    "status.running",
    "status.done",
  ]);
  assert.deepEqual(resolveStatic(common, "friend"), ["friend", "friend_male"]);
  assert.deepEqual(resolveStatic(common, "nope"), []);
});

test("analyze reports missing keys and unused leaves", () => {
  const dir = makeLocales({ en: EN });
  const index = indexLanguage(dir, "en");
  const { missing, unused } = analyze(
    index,
    [
      usage("actions.save", ["common"]),
      usage("chat.send", ["sessions"]),
      usage("chat.nope", ["sessions"]),
      usage("allThreads", ["common"]), // exists in sessions, not common → missing
      usage("files", ["common"], { hasDefault: true }),
    ],
    []
  );
  assert.deepEqual(
    missing.map((m) => m.id),
    ["src/a.tsx common:allThreads", "src/a.tsx sessions:chat.nope"]
  );
  assert.ok(unused.includes("common:actions.cancel"));
  assert.ok(unused.includes("sessions:chat.allThreads"));
  assert.ok(!unused.includes("common:files_one"));
  assert.ok(!unused.includes("common:actions.save"));
});

test("array namespaces fall through in order; loose usages search everywhere", () => {
  const dir = makeLocales({ en: EN });
  const index = indexLanguage(dir, "en");
  const { missing, unused } = analyze(
    index,
    [usage("chat.send", ["common", "sessions"]), usage("actions.cancel", null)],
    []
  );
  assert.equal(missing.length, 0);
  assert.ok(!unused.includes("sessions:chat.send"));
  assert.ok(!unused.includes("common:actions.cancel"));
});

test("loose usages retry under known keyPrefixes before reporting missing", () => {
  const dir = makeLocales({ en: EN });
  const index = indexLanguage(dir, "en");
  const without = analyze(index, [usage("column.title", null)], []);
  assert.equal(without.missing.length, 1);
  const withPrefix = analyze(index, [usage("column.title", null)], [], {
    keyPrefixes: ["kanban"],
  });
  assert.equal(withPrefix.missing.length, 0);
  assert.ok(!withPrefix.unused.includes("sessions:kanban.column.title"));
});

test("patterns mark every matching leaf and are missing when nothing matches", () => {
  const dir = makeLocales({ en: EN });
  const index = indexLanguage(dir, "en");
  const pattern = (key, regex) => ({
    kind: "pattern",
    key,
    regex,
    namespaces: ["common"],
    file: "src/a.tsx",
    line: 3,
  });
  const { missing, unused } = analyze(
    index,
    [
      pattern("status.${*}", "^status\\..+$"),
      pattern("nothing.${*}", "^nothing\\..+$"),
    ],
    []
  );
  assert.deepEqual(
    missing.map((m) => m.id),
    ["src/a.tsx common:nothing.${*}"]
  );
  assert.ok(!unused.includes("common:status.running"));
  assert.ok(!unused.includes("common:status.done"));
});

test("key-path literals mark leaves and nodes used but never report missing", () => {
  const dir = makeLocales({ en: EN });
  const index = indexLanguage(dir, "en");
  const { missing, unused, stats } = analyze(
    index,
    [],
    ["actions.save", "sessions:chat.send", "kanban.column", "not.a.key"]
  );
  assert.equal(missing.length, 0);
  assert.equal(stats.literalHits, 3);
  assert.ok(!unused.includes("common:actions.save"));
  assert.ok(!unused.includes("sessions:chat.send"));
  assert.ok(!unused.includes("sessions:kanban.column.title"));
  assert.ok(unused.includes("common:actions.cancel"));
});

test("prefix literals credit every key under the prefix", () => {
  const dir = makeLocales({ en: EN });
  const index = indexLanguage(dir, "en");
  const { unused, stats } = analyze(
    index,
    [],
    ["status.", "sessions:kanban.", "files_"]
  );
  assert.equal(stats.literalHits, 3);
  assert.ok(!unused.includes("common:status.running"));
  assert.ok(!unused.includes("common:status.done"));
  assert.ok(!unused.includes("sessions:kanban.column.title"));
  assert.ok(!unused.includes("common:files_one"));
  assert.ok(unused.includes("common:actions.save"));
});

test("localeGaps lists missing keys per locale and skips absent namespace files", () => {
  const dir = makeLocales({
    en: EN,
    fr: { common: { actions: { save: "Enregistrer" }, days: "j" } },
  });
  const gaps = localeGaps(dir, indexLanguage(dir, "en"));
  assert.ok(gaps.includes("fr/common:actions.cancel"));
  assert.ok(!gaps.includes("fr/common:actions.save"));
  assert.ok(!gaps.some((gap) => gap.startsWith("fr/sessions:")));
});

test("compareLocales reports locale-only keys and placeholder mismatches", () => {
  const dir = makeLocales({
    en: {
      common: {
        greet: "Hi {{name}}, {{ name }}!",
        count: "{{n}} of {{total}}",
        plain: "x",
      },
    },
    de: {
      common: {
        greet: "Hallo {{name}}!",
        count: "{{n}} von {{ total }} ({{n}})",
        plain: "y",
        stale: { old: "z" },
      },
    },
    fr: { common: { greet: "Salut", count: "{{n}}", plain: "z" } },
  });
  const { gaps, extras, placeholderMismatches } = compareLocales(
    dir,
    indexLanguage(dir, "en")
  );
  assert.deepEqual(gaps, []);
  assert.deepEqual(extras, ["de/common:stale.old"]);
  assert.deepEqual(placeholderMismatches, [
    "fr/common:greet",
    "fr/common:count",
  ]);
  assert.deepEqual(placeholders("{{ b }} {{a}} {{a}}"), ["{{a}}", "{{b}}"]);
  assert.deepEqual(placeholders(["not", "a string"]), []);
});

test("diffAgainstBaseline separates new from fixed findings", () => {
  assert.deepEqual(diffAgainstBaseline(["a", "b"], ["b", "c"]), {
    added: ["a"],
    fixed: ["c"],
  });
});

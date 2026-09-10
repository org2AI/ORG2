import assert from "node:assert/strict";
import test from "node:test";

import { extractUsages } from "./usages.mjs";

const NAMESPACES = new Set(["common", "sessions", "projects", "settings"]);
const extract = (text, file = "src/x.tsx") =>
  extractUsages(text, file, { defaultNs: "common", namespaces: NAMESPACES });
const keys = (result) =>
  result.usages
    .filter((u) => u.kind !== "dynamic")
    .map((u) => `${u.namespaces ? u.namespaces.join("|") : "*"}:${u.key}`)
    .sort();

test("hook namespace, array namespaces, and defaultNS", () => {
  const { usages } = extract(`
    function A() { const { t } = useTranslation("sessions"); return t("a.b"); }
    function B() { const { t } = useTranslation(["projects", "common"]); return t("c"); }
    function C() { const { t } = useTranslation(); return t("d"); }
  `);
  assert.deepEqual(
    usages.map((u) => [u.namespaces, u.key]),
    [
      [["sessions"], "a.b"],
      [["projects", "common"], "c"],
      [["common"], "d"],
    ]
  );
});

test("explicit namespace forms win over the hook namespace", () => {
  const result = extract(`
    function A() {
      const { t } = useTranslation("sessions");
      return [t("common:x.y"), t("z", { ns: "settings" }), t("unknownNs:k")];
    }
  `);
  assert.deepEqual(keys(result), [
    "common:x.y",
    "sessions:unknownNs:k",
    "settings:z",
  ]);
});

test("keyPrefix, aliases, getFixedT, and non-destructured hook results", () => {
  const result = extract(`
    function A() {
      const { t: tSettings } = useTranslation("settings", { keyPrefix: "kanban" });
      const tr = useTranslation("projects");
      const fixed = useMemo(() => i18n.getFixedT(lang, "common"), [lang]);
      return [tSettings("title"), tr.t("p.q"), fixed("f"), i18n.t("g"), i18next.t("h")];
    }
  `);
  assert.deepEqual(keys(result), [
    "common:f",
    "common:g",
    "common:h",
    "projects:p.q",
    "settings:kanban.title",
  ]);
  assert.deepEqual(result.keyPrefixes, ["kanban"]);
});

test("bindings are scoped to the declaring function; unscoped calls use the file union", () => {
  const result = extract(`
    function A() { const { t } = useTranslation("sessions"); return t("shared"); }
    function B() { const { t } = useTranslation("projects"); return t("shared"); }
    function helper(t) { return t("orphan"); }
  `);
  assert.deepEqual(keys(result), [
    "projects:shared",
    "sessions:shared",
    "sessions|projects:orphan",
  ]);
});

test("a t never bound in the file is loose", () => {
  const result = extract(
    `export function label(t: TFunction) { return t("x.y"); }`
  );
  assert.deepEqual(keys(result), ["*:x.y"]);
});

test("nested callbacks resolve through the enclosing component", () => {
  const result = extract(`
    function A() {
      const { t } = useTranslation("sessions");
      const label = useCallback(() => t("inner"), [t]);
      return items.map((item) => <li>{t("row")}</li>);
    }
  `);
  assert.deepEqual(keys(result), ["sessions:inner", "sessions:row"]);
});

test("template literals become prefix patterns; leading interpolation is dynamic", () => {
  const result = extract(`
    function A() {
      const { t } = useTranslation("sessions");
      return [t(\`status.\${s}\`), t(\`types.\${x}.name\`), t(\`\${base}.k\`), t(\`common:\${dyn}\`)];
    }
  `);
  const patterns = result.usages.filter((u) => u.kind === "pattern");
  assert.deepEqual(
    patterns.map((u) => [u.key, u.regex]),
    [
      ["status.${*}", "^status\\..+$"],
      ["types.${*}.name", "^types\\..+\\.name$"],
    ]
  );
  assert.equal(result.usages.filter((u) => u.kind === "dynamic").length, 2);
});

test("conditional, nullish, array, and empty-string keys", () => {
  const result = extract(`
    function A() {
      const { t } = useTranslation("sessions");
      return [t(flag ? "yes" : "no"), t(maybe ?? "fallback"), t(["first", "second"]), t(MAP[k] ?? "")];
    }
  `);
  assert.deepEqual(keys(result), [
    "sessions:fallback",
    "sessions:first",
    "sessions:no",
    "sessions:second",
    "sessions:yes",
  ]);
  // `MAP[k]` and the empty string are both unresolvable; one dynamic entry per line.
  assert.equal(result.usages.filter((u) => u.kind === "dynamic").length, 1);
});

test("Trans i18nKey, options metadata, and loose aliases", () => {
  const result = extract(`
    function A() {
      return [
        <Trans i18nKey="legal.body" ns="settings" />,
        <Trans i18nKey="plain" />,
        tCommon("actions.save"),
        tCommon("noDots"),
      ];
    }
    function B() {
      const { t } = useTranslation("sessions");
      return t("obj", { returnObjects: true, defaultValue: "x" });
    }
  `);
  assert.deepEqual(keys(result), [
    "*:actions.save",
    "*:plain",
    "sessions:obj",
    "settings:legal.body",
  ]);
  const obj = result.usages.find((u) => u.key === "obj");
  assert.equal(obj.returnObjects, true);
  assert.equal(obj.hasDefault, true);
});

test("bare dotted literals are collected, consumed keys are not", () => {
  const result = extract(`
    const ITEMS = [{ labelKey: "sidebar.items.home" }, { labelKey: "common:actions.open" }];
    const version = "1.2.3";
    const path = "./relative.path";
    function A() { const { t } = useTranslation(); return t("direct.key"); }
  `);
  assert.deepEqual(result.literals.sort(), [
    "1.2.3",
    "common:actions.open",
    "sidebar.items.home",
  ]);
});

test("string concatenation with a literal head is a prefix pattern", () => {
  const result = extract(`
    function A() {
      const { t } = useTranslation("settings");
      return [t("monitor.diskCategory_" + cat.key), t(prefix + ".x")];
    }
  `);
  const patterns = result.usages.filter((u) => u.kind === "pattern");
  assert.deepEqual(
    patterns.map((u) => [u.key, u.regex]),
    [["monitor.diskCategory_${*}", "^monitor\\.diskCategory_.+$"]]
  );
  const dynamic = result.usages.filter((u) => u.kind === "dynamic");
  assert.deepEqual(
    dynamic.map((u) => u.expr),
    ['prefix + ".x"']
  );
  assert.ok(!result.literals.includes("monitor.diskCategory_"));
});

test("defaultValue text is captured from both call forms", () => {
  const result = extract(`
    function A() {
      const { t } = useTranslation("sessions");
      return [t("a", "Alpha"), t("b", { defaultValue: "Beta" }), t("c", { defaultValue: name }), t("d")];
    }
  `);
  assert.deepEqual(
    result.usages.map((u) => [u.key, u.hasDefault, u.defaultValue]),
    [
      ["a", true, "Alpha"],
      ["b", true, "Beta"],
      ["c", true, null],
      ["d", false, null],
    ]
  );
});

test("key prefixes assembled outside t() are collected with their separator", () => {
  const result = extract(`
    const items = ids.map((id) => ({ labelKey: \`settings:coreSidebar.items.\${id}\` }));
    const metric = "monitor.metricKinds." + kind;
    const sibling = "monitor.diskCategory_" + cat;
    const notAKey = \`Hello \${name}.\`;
    const url = \`https://x.y/\${p}\`;
  `);
  assert.deepEqual(result.literals.sort(), [
    "monitor.diskCategory_",
    "monitor.metricKinds.",
    "settings:coreSidebar.items.",
  ]);
});

test("translate is treated as a loose t alias", () => {
  const result = extract(`
    function label(translate: (key: string) => string) {
      return [translate("monitor.measurementKinds.unavailable"), translate(\`monitor.metricKinds.\${kind}\`), translate("plain")];
    }
  `);
  assert.deepEqual(keys(result), [
    "*:monitor.measurementKinds.unavailable",
    "*:monitor.metricKinds.${*}",
  ]);
});

test("identical usages on one line are reported once", () => {
  const result = extract(`
    function A() { const { t } = useTranslation("sessions"); return t("k") + t("k"); }
  `);
  assert.equal(result.usages.length, 1);
  assert.equal(result.usages[0].line, 2);
});

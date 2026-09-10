import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { collectFindings, newFindings } from "./findings.mjs";

const result = (source, line = 1) => [
  {
    filePath: "/repo/src/a.ts",
    source,
    messages: [
      {
        ruleId: "rule",
        message: "unhandled",
        line,
        column: 1,
        endLine: line,
        endColumn: 8,
      },
    ],
  },
];
test("line movement preserves identity, a changed expression does not", () => {
  const baseline = collectFindings(result("send();"), "/repo");
  assert.deepEqual(
    newFindings(collectFindings(result("\nsend();", 2), "/repo"), baseline),
    []
  );
  assert.equal(
    newFindings(collectFindings(result("next();"), "/repo"), baseline).length,
    1
  );
});
test("duplicate findings cannot spend the same baseline allowance twice", () => {
  const baseline = collectFindings(result("send();"), "/repo");
  const doubled = collectFindings(
    [...result("send();"), ...result("send();")],
    "/repo"
  );
  assert.equal(newFindings(doubled, baseline).length, 1);
  assert.deepEqual(newFindings([], baseline), []);
  assert.throws(() => newFindings([], [...baseline, ...baseline]));
});
test("parser/configuration failures cannot be baselined", () => {
  assert.throws(() =>
    collectFindings(
      [
        {
          filePath: "bad",
          messages: [{ fatal: true, message: "parse failed" }],
        },
      ],
      "/repo"
    )
  );
});

function switchFindings(cases) {
  const results = result("tab.type");
  results[0].messages[0].ruleId =
    "@typescript-eslint/switch-exhaustiveness-check";
  results[0].messages[0].message =
    "Switch is not exhaustive. Cases not matched: " + cases;
  return collectFindings(results, "/repo");
}

test("reordered literal cases match an unchanged legacy baseline", () => {
  const baseline = switchFindings('"project" | "browser" | "code"');
  const entry = baseline[0];
  entry.key = createHash("sha256")
    .update(
      JSON.stringify([entry.file, entry.rule, entry.message, entry.source])
    )
    .digest("hex");
  assert.deepEqual(
    newFindings(switchFindings('"code" | "project" | "browser"'), baseline),
    []
  );
  assert.equal(
    newFindings(
      switchFindings('"code" | "project" | "browser" | "new"'),
      baseline
    ).length,
    1
  );
  const doubled = switchFindings('"code" | "project" | "browser"');
  doubled[0].count = 2;
  assert.equal(newFindings(doubled, baseline).length, 1);
});

test("literal contents and unfamiliar diagnostics retain their identity", () => {
  const baseline = switchFindings('"a | b" | "c"');
  assert.deepEqual(newFindings(switchFindings('"c" | "a | b"'), baseline), []);
  assert.equal(
    newFindings(switchFindings('"a" | "b" | "c"'), baseline).length,
    1
  );
  assert.equal(
    newFindings(
      switchFindings('Some.Type | "c"'),
      switchFindings('"c" | Some.Type')
    ).length,
    1
  );
});

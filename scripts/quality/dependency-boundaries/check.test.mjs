import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

async function runFixture(toolSource, { baseline = [], args = [] } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "orgii-boundary-report-"));
  try {
    const checker = path.join(
      root,
      "scripts/quality/dependency-boundaries/check.mjs"
    );
    await mkdir(path.dirname(checker), { recursive: true });
    await copyFile(new URL("./check.mjs", import.meta.url), checker);
    await copyFile(
      new URL("../workspace-sources.mjs", import.meta.url),
      path.join(root, "scripts/quality/workspace-sources.mjs")
    );
    await mkdir(path.join(root, "src"));
    await writeFile(path.join(root, "src/entry.ts"), "export const entry = 1;");
    await mkdir(path.join(root, "config"));
    const baselinePath = path.join(
      root,
      "config/dependency-boundaries-baseline.json"
    );
    await writeFile(baselinePath, JSON.stringify(baseline));
    if (toolSource !== null) {
      const executable = path.join(
        root,
        "node_modules/dependency-cruiser/bin/dependency-cruise.mjs"
      );
      await mkdir(path.dirname(executable), { recursive: true });
      await writeFile(executable, toolSource);
    }
    const run = spawnSync(process.execPath, [checker, ...args], {
      cwd: root,
      encoding: "utf8",
    });
    return { ...run, baseline: await readFile(baselinePath, "utf8") };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
const report = (modules, violations = []) => ({
  modules: modules.map((source) => ({ source, dependencies: [] })),
  summary: { violations },
});
const print = (value, status = 0) =>
  `console.log(${JSON.stringify(JSON.stringify(value))}); process.exitCode = ${status};`;

test("missing executable produces an actionable execution diagnostic", async () => {
  const run = await runFixture(null);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /dependency-cruiser executable is missing/);
  assert.doesNotMatch(run.stderr, /SyntaxError/);
});
test("failed subprocess preserves stderr instead of a misleading JSON parser failure", async () => {
  const run = await runFixture(
    'console.error("Cannot find package missing-dependency"); process.exitCode = 1;'
  );
  assert.equal(run.status, 1);
  assert.match(run.stderr, /did not return a valid JSON report/);
  assert.match(run.stderr, /Cannot find package missing-dependency/);
  assert.doesNotMatch(run.stderr, /SyntaxError/);
});
test("malformed successful stdout fails explicitly", async () => {
  const run = await runFixture('console.log("not a graph");');
  assert.equal(run.status, 1);
  assert.match(run.stderr, /valid JSON report.*not a graph/);
});
test("a real JavaScript-only report cannot pass or overwrite the baseline for a TypeScript project", async () => {
  for (const args of [[], ["--write-baseline"]]) {
    const baseline = [["keep", "src/old.ts", "src/view.ts"]];
    const run = await runFixture(
      print(report(["src/util/qr/qrcodeGeneratorVendor.js"])),
      { baseline, args }
    );
    assert.equal(run.status, 1);
    assert.match(run.stderr, /analyzed no TypeScript modules/);
    assert.equal(run.baseline, JSON.stringify(baseline));
  }
});
test("valid graphs still detect new forbidden edges and accept known violations", async () => {
  const violation = {
    rule: { name: "api-to-view" },
    from: "src/api/a.ts",
    to: "src/components/b.tsx",
  };
  const source = print(report([violation.from, violation.to], [violation]), 1);
  const added = await runFixture(source);
  assert.equal(added.status, 1);
  assert.match(added.stdout, /1 new forbidden edges/);
  assert.match(
    added.stderr,
    /api-to-view: src\/api\/a.ts -> src\/components\/b.tsx/
  );
  const known = await runFixture(source, {
    baseline: [[violation.rule.name, violation.from, violation.to]],
  });
  assert.equal(known.status, 0, known.stderr);
  assert.match(known.stdout, /0 new forbidden edges/);
});
test("malformed report structure is rejected before baseline comparison", async () => {
  const run = await runFixture(
    print({
      modules: [{ source: "src/entry.ts" }],
      summary: { violations: [{}] },
    })
  );
  assert.equal(run.status, 1);
  assert.match(run.stderr, /invalid dependency graph or violations report/);
});

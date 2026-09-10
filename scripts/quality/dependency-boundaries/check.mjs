import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.."
);
const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--write-baseline"))
  throw new Error("Only --write-baseline is supported");
const run = spawnSync(
  process.execPath,
  [
    path.join(
      root,
      "node_modules/dependency-cruiser/bin/dependency-cruise.mjs"
    ),
    "src",
    "--config",
    "config/dependency-cruiser.cjs",
    "--output-type",
    "json",
  ],
  { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
);
if (run.error || run.signal || (run.status !== 0 && run.status !== 1))
  throw new Error(
    run.error?.message ?? run.stderr ?? "dependency-cruiser failed"
  );
const report = JSON.parse(run.stdout);
if (
  !Array.isArray(report.modules) ||
  !report.modules.length ||
  !Array.isArray(report.summary?.violations)
)
  throw new Error("Missing dependency graph or violations");
const findings = [
  ...new Set(
    report.summary.violations.map((v) =>
      JSON.stringify([v.rule.name, v.from, v.to])
    )
  ),
]
  .sort()
  .map((key) => JSON.parse(key));
const baselinePath = path.join(
  root,
  "config/dependency-boundaries-baseline.json"
);
if (args.includes("--write-baseline")) {
  writeFileSync(baselinePath, JSON.stringify(findings, null, 2) + "\n");
  console.log(`Wrote ${findings.length} boundary findings for review.`);
} else {
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  if (
    !Array.isArray(baseline) ||
    baseline.some(
      (x) =>
        !Array.isArray(x) ||
        x.length !== 3 ||
        x.some((v) => typeof v !== "string")
    )
  )
    throw new Error("Invalid boundary baseline");
  const allowed = new Set(baseline.map((entry) => JSON.stringify(entry)));
  const added = findings.filter((entry) => !allowed.has(JSON.stringify(entry)));
  for (const [rule, from, to] of added)
    console.error(`${rule}: ${from} -> ${to}`);
  console.log(
    `${report.modules.length} modules; ${findings.length} existing edges; ${added.length} new forbidden edges.`
  );
  if (added.length) process.exitCode = 1;
}

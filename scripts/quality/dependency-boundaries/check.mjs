import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  publicWorkspaceImport,
  sourceRoots,
  workspacePackages,
} from "../workspace-sources.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.."
);
const args = process.argv.slice(2);
const sources = sourceRoots(root);
const packages = workspacePackages(root, sources);
if (args.some((arg) => arg !== "--write-baseline"))
  throw new Error("Only --write-baseline is supported");
const executable = path.join(
  root,
  "node_modules/dependency-cruiser/bin/dependency-cruise.mjs"
);
if (!existsSync(executable)) {
  throw new Error(
    "dependency-cruiser executable is missing; install dependency-cruiser before running the boundary audit"
  );
}
const run = spawnSync(
  process.execPath,
  [
    executable,
    ...sources,
    "--config",
    "config/dependency-cruiser.cjs",
    "--output-type",
    "json",
  ],
  { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
);
const executionDetail = [run.error?.message, run.signal, run.stderr?.trim()]
  .filter(Boolean)
  .join("\n")
  .slice(0, 3000);
if (run.error || run.signal || (run.status !== 0 && run.status !== 1)) {
  throw new Error(
    `dependency-cruiser execution failed (exit ${run.status}): ${executionDetail || "no diagnostic output"}`
  );
}
let report;
try {
  report = JSON.parse(run.stdout);
} catch {
  throw new Error(
    `dependency-cruiser did not return a valid JSON report (exit ${run.status}): ${executionDetail || run.stdout?.trim().slice(0, 1000) || "empty stdout"}`
  );
}
if (
  !Array.isArray(report?.modules) ||
  !report.modules.length ||
  report.modules.some((module) => typeof module?.source !== "string") ||
  !Array.isArray(report.summary?.violations) ||
  report.summary.violations.some(
    (violation) =>
      typeof violation?.rule?.name !== "string" ||
      typeof violation?.from !== "string" ||
      typeof violation?.to !== "string"
  )
)
  throw new Error(
    "dependency-cruiser returned an invalid dependency graph or violations report"
  );
if (run.status === 1 && report.summary.violations.length === 0) {
  throw new Error(
    `dependency-cruiser execution failed without reporting boundary violations: ${executionDetail || "exit 1"}`
  );
}
function hasTypeScriptSources(directory) {
  const pending = [directory];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.isFile() && /\.(?:[cm]?ts|tsx)$/.test(entry.name)) return true;
      if (entry.isDirectory()) pending.push(path.join(current, entry.name));
    }
  }
  return false;
}
for (const source of sources) {
  if (
    hasTypeScriptSources(path.join(root, source)) &&
    !report.modules.some(
      (module) =>
        module.source.startsWith(`${source}/`) &&
        /\.(?:[cm]?ts|tsx)$/.test(module.source)
    )
  ) {
    throw new Error(
      `Incomplete dependency graph: ${source} contains TypeScript sources, but dependency-cruiser analyzed no TypeScript modules in that source root. Check that dependency-cruiser can resolve TypeScript; the boundary audit cannot pass on a JavaScript-only graph.`
    );
  }
}
const workspaceViolations = [];
for (const module of report.modules) {
  const owner = packages.find((pkg) =>
    module.source.startsWith(`${pkg.directory}/`)
  );
  for (const dependency of module.dependencies ?? []) {
    const target = packages.find(
      (pkg) =>
        dependency.resolved?.startsWith(`${pkg.directory}/`) ||
        (pkg.name &&
          (dependency.module === pkg.name ||
            dependency.module?.startsWith(`${pkg.name}/`)))
    );
    if (!target || owner === target) continue;
    if (!publicWorkspaceImport(target, dependency.module ?? "")) {
      workspaceViolations.push({
        rule: { name: "workspace-public-api" },
        from: module.source,
        to: dependency.resolved ?? dependency.module,
      });
    } else if (
      dependency.couldNotResolve ||
      !dependency.resolved?.startsWith(`${target.directory}/`)
    ) {
      throw new Error(
        `Workspace import was not resolved to source: ${module.source} -> ${dependency.module}. Install workspace dependencies before auditing.`
      );
    }
  }
}
const findings = [
  ...new Set(
    [...report.summary.violations, ...workspaceViolations].map((v) =>
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

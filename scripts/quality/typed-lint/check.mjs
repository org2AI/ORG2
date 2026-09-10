import { ESLint } from "eslint";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { collectFindings, newFindings } from "./findings.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.."
);
const baselinePath = path.join(root, "config/typed-lint-baseline.json");
const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--write-baseline"))
  throw new Error("Only --write-baseline is supported");
const lint = new ESLint({
  cwd: root,
  useEslintrc: false,
  allowInlineConfig: false,
  overrideConfigFile: path.join(root, "config/eslint.typed.cjs"),
});
const findings = collectFindings(
  await lint.lintFiles(["src/**/*.{ts,tsx}"]),
  root
);
if (args.includes("--write-baseline")) {
  await writeFile(baselinePath, JSON.stringify(findings, null, 2) + "\n");
  console.log(
    `Wrote ${findings.length} findings. Review the baseline diff before committing.`
  );
} else {
  const baseline = JSON.parse(await readFile(baselinePath, "utf8"));
  const added = newFindings(findings, baseline);
  for (const finding of added)
    console.error(
      `${finding.file}: ${finding.rule}: ${finding.source} (${finding.count} occurrences)`
    );
  console.log(
    `${findings.length} existing findings; ${added.length} new or increased findings.`
  );
  if (added.length) process.exitCode = 1;
}

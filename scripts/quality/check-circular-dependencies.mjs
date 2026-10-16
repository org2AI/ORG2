#!/usr/bin/env node

import madge from "madge";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

import {
  sourceRoots,
  workspacePackages,
  workspaceSourcePaths,
} from "./workspace-sources.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SCRIPT_DIR, "..", "..");
const JSON_OUTPUT = process.argv.includes("--json");
const STYLE_EXTENSION = /\.(?:css|less|sass|scss|styl)$/i;
const LOCAL_SPECIFIER = /^(?:\.{1,2}[\\/]|[\\/])/;
const sources = sourceRoots(ROOT);
const packages = workspacePackages(ROOT, sources);

function isResolvableExternalSpecifier(specifier) {
  if (LOCAL_SPECIFIER.test(specifier)) return false;
  // A workspace import skipped by Madge is a graph hole, even if Node resolves it.
  if (
    packages.some(
      (pkg) =>
        pkg.name &&
        (specifier === pkg.name || specifier.startsWith(`${pkg.name}/`))
    )
  )
    return false;

  try {
    const resolved = import.meta.resolve(specifier);
    if (resolved.startsWith("node:")) return true;
    return resolved.startsWith("file:") && existsSync(fileURLToPath(resolved));
  } catch {
    return false;
  }
}

// Path aliases from tsconfig.json that madge does not apply to specifiers
// carrying a webpack resource query.
const ALIAS_ROOTS = [
  ["@src/", join(ROOT, "src")],
  ["@/", ROOT],
];
const RESOURCE_QUERIES = ["raw", "url"];

function isResolvableRootRawSpecifier(specifier) {
  const alias = ALIAS_ROOTS.find(([prefix]) => specifier.startsWith(prefix));
  if (!alias) return false;

  // Madge reports webpack `?raw` / `?url` imports as skipped before applying
  // the path alias. Accept them only when the aliased target is a real file.
  const queryIndex = specifier.indexOf("?");
  if (queryIndex === -1) return false;

  const query = new URLSearchParams(specifier.slice(queryIndex + 1));
  if (!RESOURCE_QUERIES.some((name) => query.has(name))) return false;

  const [prefix, aliasRoot] = alias;
  const candidate = resolve(
    aliasRoot,
    specifier.slice(prefix.length, queryIndex)
  );
  if (!candidate.startsWith(`${ROOT}${sep}`) || !existsSync(candidate)) {
    return false;
  }

  return statSync(candidate).isFile();
}

function printCycles(cycles) {
  console.error(
    `Found ${cycles.length} circular dependenc${cycles.length === 1 ? "y" : "ies"}:`
  );
  for (const cycle of cycles) {
    console.error(`  ${[...cycle, cycle[0]].join(" -> ")}`);
  }
}

const madgeConfig = JSON.parse(
  readFileSync(join(ROOT, "config", "madge.json"), "utf8")
);
const configFile = ts.readConfigFile(
  join(ROOT, "tsconfig.json"),
  ts.sys.readFile
);
if (configFile.error)
  throw new Error(
    ts.flattenDiagnosticMessageText(configFile.error.messageText, "\n")
  );
const parsedConfig = ts.parseJsonConfigFileContent(
  configFile.config,
  ts.sys,
  ROOT
);
const result = await madge(
  sources.map((source) => join(ROOT, source)),
  {
    ...madgeConfig,
    fileExtensions: ["ts", "tsx"],
    baseDir: ROOT,
    tsConfig: {
      ...parsedConfig.raw,
      compilerOptions: {
        ...parsedConfig.options,
        paths: {
          ...parsedConfig.options.paths,
          ...workspaceSourcePaths(packages),
        },
      },
    },
    // Drop stylesheets from the graph. Load-bearing, not cosmetic: without it
    // detective-scss reads every animation-name and Tailwind directive as an
    // import, so 37 bogus specifiers (`modal-scale-in`, `dropIndicatorPulse`,
    // …) land in warnings().skipped and trip the unresolved gate below on a
    // perfectly clean tree.
    //
    // The cost is real and deliberate. dependency-tree applies `filter` to the
    // ALREADY-RESOLVED dependency list, so stylesheets vanish as nodes AND
    // edges, not merely as traversal targets (here: 112 nodes, 143 edges).
    // They are not leaves — 20 of them carry 56 scss->scss edges — so a cycle
    // running purely through `@import`s is no longer reported. The previous
    // `npx madge` invocation did catch that class; it is knowingly given up to
    // keep this gate usable.
    dependencyFilter: (dependencyPath) => !STYLE_EXTENSION.test(dependencyPath),
  }
);

const cycles = result.circular();
const skipped = result.warnings().skipped;
const unresolved = skipped.filter(
  (specifier) =>
    !isResolvableExternalSpecifier(specifier) &&
    !isResolvableRootRawSpecifier(specifier)
);

if (JSON_OUTPUT) {
  console.log(JSON.stringify(cycles));
} else if (cycles.length === 0 && unresolved.length === 0) {
  console.log(
    `No circular dependencies found across ${Object.keys(result.obj()).length} modules.`
  );
}

if (unresolved.length > 0) {
  console.error(
    `Madge could not resolve ${unresolved.length} source import${unresolved.length === 1 ? "" : "s"}:`
  );
  for (const specifier of unresolved) console.error(`  ${specifier}`);
}

if (cycles.length > 0 && !JSON_OUTPUT) printCycles(cycles);
if (cycles.length > 0 || unresolved.length > 0) process.exitCode = 1;

#!/usr/bin/env node

// Runs the unit test files a pull request can affect, in one Vitest process.
//
//   git diff --name-only -z <base>...HEAD | node scripts/ci/run-unit-tests.mjs
//
// select-unit-tests.cjs holds the rules. This file supplies what they need
// from Vitest itself: each test file's module graph, walked through the same
// Vite environments, aliases, and plugins the test run uses. Walking a file in
// the environment its run uses fills that environment's transform cache, so
// the run reuses the walk's transforms instead of repeating them.
//
// Anything that stops the graph from being built runs the whole suite.
// Pass --dry-run to print the selection without running tests.
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { createVitest } from "vitest/node";

const require = createRequire(import.meta.url);
const {
  fullRunReasonForPaths,
  parseNullDelimitedPaths,
  readsFilesOutsideImports,
  selectUnitTests,
} = require("./select-unit-tests.cjs");

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
const VITEST_CONFIG = path.join(REPO_ROOT, "config/vitest.config.ts");

// Vitest transforms DOM-environment test files in Vite's client environment
// and every other file in ssr.
const DOM_ENVIRONMENT_RE =
  /@(?:vitest|jest)-environment\s+(?:jsdom|happy-dom)\b/;
const DOM_ENVIRONMENTS = new Set(["jsdom", "happy-dom"]);
const SOURCE_FILE_RE = /\.[cm]?[jt]sx?$/;
const NODE_MODULES_SEGMENT = `${path.sep}node_modules${path.sep}`;
const TRANSFORM_CONCURRENCY = 16;

async function main() {
  if (process.stdin.isTTY) {
    process.stderr.write(
      "usage: git diff --name-only -z <base>...HEAD | " +
        "node scripts/ci/run-unit-tests.mjs [--dry-run]\n"
    );
    process.exitCode = 2;
    return;
  }

  const dryRun = process.argv.includes("--dry-run");
  const changedPaths = parseNullDelimitedPaths(fs.readFileSync(0));

  // Vitest's own CLI sets these before creating an instance, and the test
  // workers inherit them.
  process.env.TEST = "true";
  process.env.VITEST = "true";
  process.env.NODE_ENV ??= "test";

  const vitest = await createVitest("test", {
    config: VITEST_CONFIG,
    run: true,
    watch: false,
  });

  try {
    const selection = await selectTests(vitest, changedPaths);
    reportSelection(selection);

    if (dryRun) {
      for (const file of selection.files ?? []) {
        process.stdout.write(`${file}\n`);
      }
      return;
    }

    // Vitest reads an empty filter list as "every test file".
    if (selection.mode === "affected" && selection.files.length === 0) {
      return;
    }

    await vitest.start(
      selection.mode === "all"
        ? []
        : selection.files.map((file) => path.join(REPO_ROOT, file))
    );
  } catch (error) {
    process.exitCode = 1;
    vitest.logger.printError(error, {
      fullStack: true,
      type: "Unhandled Error",
    });
  } finally {
    // Closes the pool and forces an exit if a handle outlives the teardown
    // timeout, exactly as the vitest CLI does.
    await vitest.exit();
  }
}

async function selectTests(vitest, changedPaths) {
  const reason = fullRunReasonForPaths(changedPaths);
  if (reason !== null) {
    return { mode: "all", reason };
  }

  const startedAt = performance.now();
  try {
    const graphs = await buildGraphs(vitest);
    return {
      ...selectUnitTests({ changedPaths, ...graphs }),
      moduleCount: graphs.moduleCount,
      seconds: (performance.now() - startedAt) / 1000,
    };
  } catch (error) {
    // Workflow commands end at a newline, so fold the message onto one line.
    const message = String(error?.message ?? error)
      .replace(/\s+/g, " ")
      .trim();
    process.stdout.write(
      `::warning::Unit test selection failed, so the whole suite runs: ${message}\n`
    );
    return { mode: "all", reason: `selection failed: ${message}` };
  }
}

async function buildGraphs(vitest) {
  const specifications = await vitest.getRelevantTestSpecifications();
  const sources = new Map();
  const readSource = (file) => {
    if (!sources.has(file)) {
      sources.set(file, fs.readFileSync(file, "utf8"));
    }
    return sources.get(file);
  };

  // Each entry is walked in the Vite environment its run uses, against the
  // root its project resolves import URLs from.
  const walks = new Map();
  const addEntry = (project, environmentName, file) => {
    const environment =
      project.vite.environments[environmentName] ??
      project.vite.environments.ssr;
    if (!walks.has(environment)) {
      walks.set(environment, { root: project.config.root, files: [] });
    }
    walks.get(environment).files.push(file);
    return environment;
  };

  const tests = [];
  const projects = new Set();
  for (const { project, moduleId } of specifications) {
    projects.add(project);
    const usesDom =
      DOM_ENVIRONMENTS.has(project.config.environment) ||
      DOM_ENVIRONMENT_RE.test(readSource(moduleId));
    const environmentName = usesDom ? "client" : "ssr";
    tests.push({
      file: moduleId,
      environment: addEntry(project, environmentName, moduleId),
    });
  }

  const setupEntries = [];
  for (const project of projects) {
    for (const file of [
      ...project.config.setupFiles,
      ...project.config.globalSetup,
    ]) {
      setupEntries.push({ file, environment: addEntry(project, "ssr", file) });
    }
  }

  const edges = new Map(
    await Promise.all(
      [...walks].map(async ([environment, { root, files }]) => [
        environment,
        await walkImports(environment, root, files),
      ])
    )
  );

  const relativePaths = new Map();
  const toRelative = (file) => {
    if (!relativePaths.has(file)) {
      relativePaths.set(
        file,
        path.relative(REPO_ROOT, file).split(path.sep).join("/")
      );
    }
    return relativePaths.get(file);
  };

  const testGraphs = new Map();
  for (const { file, environment } of tests) {
    const modulePaths = reachableFrom(edges.get(environment), file, toRelative);
    const key = toRelative(file);
    const existing = testGraphs.get(key);
    testGraphs.set(
      key,
      existing ? new Set([...existing, ...modulePaths]) : modulePaths
    );
  }

  const setupModules = new Set();
  for (const { file, environment } of setupEntries) {
    setupModules.add(toRelative(file));
    for (const modulePath of reachableFrom(
      edges.get(environment),
      file,
      toRelative
    )) {
      setupModules.add(modulePath);
    }
  }

  const fileSystemModules = new Set();
  let moduleCount = 0;
  for (const [file, relative] of relativePaths) {
    if (!testGraphs.has(relative)) {
      moduleCount += 1;
    }
    if (
      SOURCE_FILE_RE.test(file) &&
      readsFilesOutsideImports(readSource(file))
    ) {
      fileSystemModules.add(relative);
    }
  }

  return { testGraphs, setupModules, fileSystemModules, moduleCount };
}

// Transforms every module reachable from `files` and records each module's
// direct imports -- static and dynamic, the same edges Vitest's own `--changed`
// follows. Returns Map<absolute file, absolute dependency[]>.
async function walkImports(environment, root, files) {
  const edges = new Map();
  const queue = [];
  const schedule = (file) => {
    if (!edges.has(file)) {
      edges.set(file, null);
      queue.push(file);
    }
  };
  files.forEach(schedule);

  await new Promise((resolve, reject) => {
    let active = 0;
    let failed = false;
    const pump = () => {
      if (failed) {
        return;
      }
      if (queue.length === 0 && active === 0) {
        resolve();
        return;
      }
      while (active < TRANSFORM_CONCURRENCY && queue.length > 0) {
        const file = queue.pop();
        active += 1;
        directImports(environment, root, file).then(
          (dependencies) => {
            edges.set(file, dependencies);
            dependencies.forEach(schedule);
            active -= 1;
            pump();
          },
          (error) => {
            failed = true;
            reject(
              new Error(
                `could not transform ${path.relative(REPO_ROOT, file)}: ${error.message}`,
                { cause: error }
              )
            );
          }
        );
      }
    };
    pump();
  });

  return edges;
}

async function directImports(environment, root, file) {
  const result =
    environment.moduleGraph.getModuleById(file)?.transformResult ??
    (await environment.transformRequest(file));
  if (!result) {
    if (SOURCE_FILE_RE.test(file)) {
      throw new Error("Vite returned no transform result");
    }
    return [];
  }

  const dependencies = [];
  for (const url of [...(result.deps ?? []), ...(result.dynamicDeps ?? [])]) {
    // `?url` and `?raw` imports still name a file on disk; Vitest's own graph
    // drops them.
    const [bareUrl] = url.split("?");
    const dependency = bareUrl.startsWith("/@fs/")
      ? bareUrl.slice("/@fs".length)
      : path.join(root, bareUrl);
    if (
      !dependency.includes(NODE_MODULES_SEGMENT) &&
      fs.existsSync(dependency)
    ) {
      dependencies.push(dependency);
    }
  }
  return dependencies;
}

function reachableFrom(edges, entry, toRelative) {
  const seen = new Set();
  const reached = new Set();
  const stack = [...(edges.get(entry) ?? [])];
  while (stack.length > 0) {
    const file = stack.pop();
    if (file === entry || seen.has(file)) {
      continue;
    }
    seen.add(file);
    reached.add(toRelative(file));
    for (const dependency of edges.get(file) ?? []) {
      if (!seen.has(dependency)) {
        stack.push(dependency);
      }
    }
  }
  return reached;
}

function reportSelection(selection) {
  const lines =
    selection.mode === "all"
      ? [`### Unit tests: whole suite`, "", `Reason: ${selection.reason}.`]
      : [
          `### Unit tests: ${selection.files.length} of ${selection.total} files`,
          "",
          `${selection.reached} test files changed or import a changed path. ` +
            `${selection.guards} more are guard tests, which read files ` +
            "through `node:fs` or `node:child_process` and always run. " +
            `Import graph: ${selection.moduleCount} modules in ` +
            `${selection.seconds.toFixed(1)}s.`,
          "",
          "<details><summary>Selected test files</summary>",
          "",
          ...selection.files.map((file) => `- \`${file}\``),
          "",
          "</details>",
        ];

  process.stdout.write(
    selection.mode === "all"
      ? `Unit tests: whole suite (${selection.reason})\n`
      : `Unit tests: ${selection.files.length} of ${selection.total} files ` +
          `(${selection.reached} reached by the diff, ${selection.guards} guards); ` +
          `import graph of ${selection.moduleCount} modules in ` +
          `${selection.seconds.toFixed(1)}s\n`
  );

  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);
  }
}

await main();

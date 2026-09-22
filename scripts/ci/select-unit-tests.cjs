// Decides which unit test files a pull request has to run.
//
// Vitest runs every test file in a fresh worker that imports the file's whole
// module graph, so a change can only reach a test through a module in that
// graph -- or through an input the test reads without importing it.
// run-unit-tests.mjs builds each graph with Vitest's own transform pipeline;
// this file is the policy on top of those graphs. It has no dependencies, so
// `node --test` pins it down before `pnpm install`.
//
// Three rules keep the shortcut sound:
//
// 1. A change that alters how every file installs, resolves, transforms, or is
//    set up runs the whole suite: manifests and the lockfile, TypeScript and
//    Vite/Vitest config, the setup files and anything they import, and this
//    selection itself. So does an empty diff (fail closed).
// 2. Otherwise a test file runs when it changed or its graph contains a changed
//    path.
// 3. Guard tests always run. A test that reads files through node:fs or runs
//    commands through node:child_process -- itself or through a helper in its
//    graph -- depends on inputs no import graph records: Rust sources,
//    index.html, other modules' text. Between 2026-09-11 and 2026-09-14,
//    three CI failures came from such tests on diffs their import graphs
//    never touched.
//
// unit-tests-develop.yml re-runs the whole suite on every push to develop, so
// a failure outside these rules still surfaces within one merge.

// Paths whose change can re-judge test files that never import them.
const FULL_RUN_PATHS = new Set([
  // Dependency resolution and the installed tree.
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  ".npmrc",
  // Node version pins.
  ".nvmrc",
  ".node-version",
  // The job that runs the selection.
  ".github/workflows/ci.yml",
]);

const FULL_RUN_PREFIXES = Object.freeze([
  // pnpm patches rewrite installed dependencies.
  "patches/",
  // This selection and its runner: a change to either proves itself on the
  // whole suite.
  "scripts/ci/select-unit-tests",
  "scripts/ci/run-unit-tests",
]);

const FULL_RUN_PATTERNS = Object.freeze([
  // Manifests anywhere, matching Vitest's own forceRerunTriggers default.
  /(^|\/)package\.json$/,
  // Compiler options feed the transform of every file.
  /(^|\/)tsconfig[^/]*\.json$/,
  // Vite and Vitest config, including config/vitest.config.ts.
  /(^|\/)(vite|vitest)(\.[^/]+)?\.config\.[cm]?[jt]s$/,
  // Vite loads root .env files into import.meta.env for every module.
  /^\.env(\.[^/]+)?$/,
]);

// Static and dynamic imports and require() of the file-system and
// child-process modules, with or without the node: prefix.
const FILE_SYSTEM_ACCESS_RE =
  /\b(?:from|import|require)\s*\(?\s*["'](?:node:)?(?:fs|fs\/promises|child_process)["']/;

function parseNullDelimitedPaths(input) {
  return input.toString("utf8").split("\0").filter(Boolean);
}

function isFullRunPath(filePath) {
  return (
    FULL_RUN_PATHS.has(filePath) ||
    FULL_RUN_PREFIXES.some((prefix) => filePath.startsWith(prefix)) ||
    FULL_RUN_PATTERNS.some((pattern) => pattern.test(filePath))
  );
}

// The reason a diff needs the whole suite before any graph is built, or null.
function fullRunReasonForPaths(changedPaths) {
  if (changedPaths.length === 0) {
    return "the diff is empty";
  }

  const trigger = changedPaths.find(isFullRunPath);
  return trigger === undefined ? null : `${trigger} changed`;
}

function readsFilesOutsideImports(source) {
  return FILE_SYSTEM_ACCESS_RE.test(source);
}

// testGraphs:        Map<test file, Set<module path>> of repo-relative paths,
//                    excluding node_modules and the test file itself.
// setupModules:      Set of the setup files and every module they import.
// fileSystemModules: Set of test files and modules that read files or run
//                    commands (see readsFilesOutsideImports).
function selectUnitTests({
  changedPaths,
  testGraphs,
  setupModules,
  fileSystemModules,
}) {
  const staticReason = fullRunReasonForPaths(changedPaths);
  if (staticReason !== null) {
    return { mode: "all", reason: staticReason };
  }

  const setupChange = changedPaths.find((filePath) =>
    setupModules.has(filePath)
  );
  if (setupChange !== undefined) {
    return {
      mode: "all",
      reason: `${setupChange} is a Vitest setup file or imported by one`,
    };
  }

  const changed = new Set(changedPaths);
  const reached = [];
  const guards = [];
  for (const [testFile, modules] of testGraphs) {
    if (changed.has(testFile) || intersects(modules, changed)) {
      reached.push(testFile);
    } else if (
      fileSystemModules.has(testFile) ||
      intersects(modules, fileSystemModules)
    ) {
      guards.push(testFile);
    }
  }

  return {
    mode: "affected",
    files: [...reached, ...guards].sort(),
    reached: reached.length,
    guards: guards.length,
    total: testGraphs.size,
  };
}

function intersects(modules, paths) {
  const [smaller, larger] =
    modules.size < paths.size ? [modules, paths] : [paths, modules];
  for (const filePath of smaller) {
    if (larger.has(filePath)) {
      return true;
    }
  }
  return false;
}

module.exports = {
  fullRunReasonForPaths,
  isFullRunPath,
  parseNullDelimitedPaths,
  readsFilesOutsideImports,
  selectUnitTests,
};

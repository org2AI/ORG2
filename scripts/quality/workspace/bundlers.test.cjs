const assert = require("node:assert/strict");
const {
  mkdtemp,
  mkdir,
  realpath,
  rm,
  symlink,
  writeFile,
} = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const webpack = require("webpack");
const { rspack } = require("@rspack/core");

const repoRoot = path.resolve(__dirname, "../../..");
const webpackConfig = require("../../../config/webpack.config.js");
const rspackConfig = require("../../../config/rspack.config.js");
const outputGlobal = "__orgiiWorkspaceBundlerTestExports";

async function temporaryDirectory(prefix) {
  // macOS exposes /var through /private/var. Match the compiler's real paths
  // while retaining ownership of precisely this newly created directory.
  return realpath(await mkdtemp(path.join(os.tmpdir(), prefix)));
}

function withEnvironment(values, readConfig) {
  const previous = new Map(
    Object.keys(values).map((key) => [key, process.env[key]])
  );
  try {
    Object.assign(process.env, values);
    return readConfig();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function applicationConfig(bundler, mode, fastProd = false) {
  return withEnvironment(
    {
      FAST_PROD: fastProd ? "true" : "false",
      FAST_DEV: "false",
      ORGII_LIGHT_DEV: "false",
      ORGII_REACT_COMPILER: "false",
      DEV_SOURCEMAPS: "false",
    },
    () => (bundler === "webpack" ? webpackConfig({}, { mode }) : rspackConfig())
  );
}

function isolatedConfig(application, outputPath, entry, mode) {
  return {
    mode,
    context: application.context,
    target: "web",
    entry,
    output: {
      path: outputPath,
      filename: "[name].cjs",
      // Keep the browser target and its actual minimizer behavior. FAST_PROD
      // wraps web output in an IIFE, so expose the fixture through globalThis
      // rather than pretending the browser bundle is a CommonJS library.
      library: { type: "global", name: outputGlobal },
      globalObject: "globalThis",
      clean: true,
    },
    module: application.module,
    resolve: application.resolve,
    snapshot: application.snapshot,
    // Use the actual production minimizer without the application's chunk
    // groups or plugins, which write the full app's HTML/assets/env output.
    optimization: {
      minimize: mode === "production",
      minimizer: application.optimization?.minimizer,
      splitChunks: false,
      runtimeChunk: false,
    },
    cache: false,
    devtool: false,
    performance: false,
  };
}

function assertSuccessful(stats) {
  assert.ok(stats, "the compiler must report a compilation");
  assert.equal(
    stats.hasErrors(),
    false,
    stats.toString({ all: false, errors: true, errorDetails: true })
  );
}

async function closeCompiler(compiler) {
  await new Promise((resolve, reject) => {
    compiler.close((error) => (error ? reject(error) : resolve()));
  });
}

async function compile(createCompiler, config) {
  const compiler = createCompiler(config);
  try {
    const stats = await new Promise((resolve, reject) => {
      compiler.run((error, result) =>
        error ? reject(error) : resolve(result)
      );
    });
    assertSuccessful(stats);
    return stats;
  } finally {
    await closeCompiler(compiler);
  }
}

function moduleResources(stats) {
  const resources = new Set();
  function visit(modules) {
    for (const module of modules ?? []) {
      if (module.nameForCondition) resources.add(module.nameForCondition);
      visit(module.modules);
    }
  }
  visit(
    stats.toJson({ all: false, modules: true, nestedModules: true }).modules
  );
  return resources;
}

function assertWorkspaceSources(stats) {
  const resources = moduleResources(stats);
  for (const source of [
    "packages/replay-core/src/shellReplayRange.ts",
    "packages/replay-core/src/findIndexAtTime.ts",
    "packages/terminal-shell-integration/src/ShellIntegrationAddon.ts",
  ]) {
    assert.ok(
      resources.has(path.join(repoRoot, source)),
      `compilation must use the real workspace source: ${source}`
    );
  }
  for (const resource of resources) {
    const relative = path.relative(repoRoot, resource).split(path.sep);
    assert.notEqual(
      relative[0],
      "src",
      "headless packages must not load app code"
    );
    if (relative[0] === "packages") {
      assert.equal(
        relative[2],
        "src",
        `workspace packages must resolve source, not built output: ${resource}`
      );
    }
  }
}

function loadOutput(outputPath, name) {
  const filename = path.join(outputPath, `${name}.cjs`);
  const previous = Object.getOwnPropertyDescriptor(globalThis, outputGlobal);
  delete require.cache[filename];
  delete globalThis[outputGlobal];
  try {
    require(filename);
    assert.ok(
      globalThis[outputGlobal],
      "compiled entry must expose its exports"
    );
    return globalThis[outputGlobal];
  } finally {
    delete require.cache[filename];
    if (previous) Object.defineProperty(globalThis, outputGlobal, previous);
    else delete globalThis[outputGlobal];
  }
}

function assertPackageBehavior(outputPath) {
  const shell = loadOutput(outputPath, "shell");
  assert.deepEqual(
    shell.filterFramesToBookmark(
      [
        {
          sequence: 1,
          stream: "stdout",
          byteStart: 0,
          byteEnd: 4,
          text: "你x",
        },
        {
          sequence: 2,
          stream: "stdout",
          byteStart: 4,
          byteEnd: 10,
          text: "future",
        },
      ],
      { visibleThroughSequence: 1, visibleBytes: 3 }
    ),
    [{ sequence: 1, stream: "stdout", byteStart: 0, byteEnd: 3, text: "你" }]
  );

  const timeline = loadOutput(outputPath, "timeline");
  const events = [0, 1, 2].map((seconds) => ({
    createdAt: `2026-09-12T00:00:0${seconds}.000Z`,
  }));
  assert.equal(
    timeline.findIndexAtTime(events, Date.parse("2026-09-12T00:00:01.500Z")),
    1
  );
  assert.equal(
    timeline.findIndexAtTime(events, Date.parse("2026-09-11T00:00:00Z"), {
      preStart: "empty",
    }),
    -1
  );

  const { ShellIntegrationAddon } = loadOutput(outputPath, "terminal");
  const calls = [];
  let oscHandler;
  let disposals = 0;
  const addon = new ShellIntegrationAddon({
    onCommandExecuted: (command) => calls.push(["command", command]),
    onCommandFinished: (exitCode) => calls.push(["finished", exitCode]),
    onCwdChanged: (cwd) => calls.push(["cwd", cwd]),
  });
  addon.activate({
    parser: {
      registerOscHandler(code, handler) {
        assert.equal(code, 633);
        oscHandler = handler;
        return { dispose: () => disposals++ };
      },
    },
  });
  assert.equal(typeof oscHandler, "function");
  for (const sequence of [
    "A",
    "B",
    "E;echo first\\x3b echo second",
    "C",
    "D;7",
    "P;Cwd=/workspace/project",
  ]) {
    oscHandler(sequence);
  }
  assert.deepEqual(calls, [
    ["command", "echo first; echo second"],
    ["finished", 7],
    ["cwd", "/workspace/project"],
  ]);
  assert.equal(addon.currentPhase, "idle");
  addon.dispose();
  assert.equal(disposals, 1);
}

for (const { name, bundler, mode, fastProd } of [
  { name: "Webpack production", bundler: "webpack", mode: "production" },
  {
    name: "Webpack FAST_PROD",
    bundler: "webpack",
    mode: "production",
    fastProd: true,
  },
  { name: "Rspack development", bundler: "rspack", mode: "development" },
]) {
  test(
    `${name} compiles and executes source-first workspace packages`,
    { timeout: 30_000 },
    async () => {
      const temporary = await temporaryDirectory("orgii-bundler-");
      try {
        const outputPath = path.join(temporary, "output");
        const stats = await compile(
          bundler === "webpack" ? webpack : rspack,
          isolatedConfig(
            applicationConfig(bundler, mode, fastProd),
            outputPath,
            {
              shell: "@orgii/replay-core/shell",
              timeline: "@orgii/replay-core/timeline",
              terminal: "@orgii/terminal-shell-integration",
            },
            mode
          )
        );
        assertWorkspaceSources(stats);
        assertPackageBehavior(outputPath);
      } finally {
        await rm(temporary, { recursive: true, force: true });
      }
    }
  );
}

function watchCompilations(compiler) {
  const queue = [];
  let pending;
  const watcher = compiler.watch({ aggregateTimeout: 20 }, (error, stats) => {
    const result = { error, stats };
    if (pending) {
      const deliver = pending;
      pending = undefined;
      deliver(result);
    } else {
      queue.push(result);
    }
  });
  return {
    async next() {
      const { error, stats } = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          pending = undefined;
          reject(
            new Error("package source edit did not trigger recompilation")
          );
        }, 10_000);
        const deliver = (result) => {
          clearTimeout(timeout);
          resolve(result);
        };
        if (queue.length) deliver(queue.shift());
        else pending = deliver;
      });
      if (error) throw error;
      assertSuccessful(stats);
      return stats;
    },
    async close() {
      try {
        await new Promise((resolve, reject) => {
          watcher.close((error) => (error ? reject(error) : resolve()));
        });
      } finally {
        await closeCompiler(compiler);
      }
    },
  };
}

for (const bundler of ["webpack", "rspack"]) {
  test(
    `${bundler} watches linked workspace TypeScript source`,
    { timeout: 30_000 },
    async () => {
      const temporary = await temporaryDirectory("orgii-bundler-watch-");
      let watching;
      try {
        const packageRoot = path.join(temporary, "packages/watch-fixture");
        const source = path.join(packageRoot, "src/index.ts");
        await mkdir(path.dirname(source), { recursive: true });
        await writeFile(source, "export const value: number = 1;\n");
        await writeFile(
          path.join(packageRoot, "package.json"),
          JSON.stringify({
            name: "@fixture/watch",
            private: true,
            type: "module",
            exports: { ".": "./src/index.ts" },
          })
        );
        const packageLink = path.join(temporary, "node_modules/@fixture/watch");
        await mkdir(path.dirname(packageLink), { recursive: true });
        await symlink(packageRoot, packageLink, "junction");
        const entry = path.join(temporary, "entry.js");
        await writeFile(entry, 'export { value } from "@fixture/watch";\n');
        const outputPath = path.join(temporary, "output");
        const config = isolatedConfig(
          applicationConfig(bundler, "development"),
          outputPath,
          { watched: entry },
          "development"
        );
        const compiler = (bundler === "webpack" ? webpack : rspack)(config);
        watching = watchCompilations(compiler);

        const initial = await watching.next();
        assert.ok(moduleResources(initial).has(source));
        assert.equal(loadOutput(outputPath, "watched").value, 1);

        await writeFile(source, "export const value: number = 42;\n");
        const rebuilt = await watching.next();
        assert.ok(moduleResources(rebuilt).has(source));
        assert.equal(loadOutput(outputPath, "watched").value, 42);
      } finally {
        try {
          if (watching) await watching.close();
        } finally {
          await rm(temporary, { recursive: true, force: true });
        }
      }
    }
  );
}

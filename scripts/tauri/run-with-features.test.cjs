const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function runWrapper(subcommand) {
  const calls = [];
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, "run-with-features.cjs"), "utf8"),
    {
      __dirname,
      console,
      process: {
        argv: ["node", "wrapper", subcommand],
        env: {},
        execPath: process.execPath,
        exit: () => {},
      },
      require(name) {
        if (name === "child_process")
          return {
            spawnSync(command, args, options) {
              calls.push({ command, args: Array.from(args), options });
              return { status: 0 };
            },
          };
        if (name === "dotenv") return { config: () => {} };
        return require(name);
      },
    }
  );
  return calls.find(({ command }) => command === "tauri");
}

test("dev-only entry point passes the dev identity and frontend environment", () => {
  const { args, options } = runWrapper("dev");
  const configPath = args[args.indexOf("--config") + 1];
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  assert.equal(config.identifier, "org2ai.org2.dev");
  assert.ok(config.bundle.icon.includes("icons/dev/icon.png"));
  assert.equal(
    config.build,
    undefined,
    "Tauri must still start its frontend hook"
  );
  assert.equal(options.env.ORGII_IDE_SERVER_PORT, "13946");
  assert.equal(options.env.ORGII_CLI_PROXY_PORT, "17987");
  assert.equal(options.env.ORGII_DEEP_LINK_SCHEME, "orgii-dev");
});

test("production builds keep their existing identity and environment", () => {
  const { args, options } = runWrapper("build");
  assert.equal(args.includes("--config"), false);
  assert.equal(options.env.ORGII_IDE_SERVER_PORT, undefined);
  assert.equal(options.env.ORGII_DEEP_LINK_SCHEME, undefined);
});

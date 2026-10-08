const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const script = fs.readFileSync(
  path.join(__dirname, "prepare-sidecars.cjs"),
  "utf8"
);

for (const target of [null, "x86_64-pc-windows-msvc"]) {
  test(`stages both sidecars without frontend dependencies (${target ?? "host"})`, (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "org2-sidecars-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const targetDir = path.join(root, "target");
    const profile = target ? "release" : "debug";
    const triple = target ?? "aarch64-apple-darwin";
    const suffix = target ? ".exe" : "";
    const builtDir = path.join(targetDir, ...(target ? [target] : []), profile);
    fs.mkdirSync(builtDir, { recursive: true });
    for (const name of ["org2-pm", "org2-ui"]) {
      fs.writeFileSync(path.join(builtDir, name + suffix), name);
    }
    assert.equal(fs.existsSync(path.join(root, "node_modules")), false);
    const calls = [];
    const childProcess = {
      spawnSync(command, args) {
        calls.push([command, args]);
        if (command === "rustc")
          return { status: 0, stdout: `host: ${triple}\n` };
        // A frontend generator or package-manager subprocess is a regression.
        assert.equal(command, "cargo");
        return {
          status: 0,
          stdout: JSON.stringify({ target_directory: targetDir }),
        };
      },
    };
    vm.runInNewContext(script, {
      __dirname: path.join(root, "scripts", "tauri"),
      require(id) {
        if (id === "child_process") return childProcess;
        if (id === "fs") return fs;
        if (id === "path") return path;
        assert.fail(`Unexpected dependency: ${id}`);
      },
      console: { log() {}, error() {} },
      process: {
        argv: [
          "node",
          "prepare-sidecars.cjs",
          "--profile",
          profile,
          ...(target ? ["--target", target] : []),
        ],
        execPath: process.execPath,
        platform: process.platform,
        env: {},
        exit(code) {
          assert.fail(`Unexpected exit: ${code}`);
        },
      },
    });
    assert.deepEqual(
      Array.from(calls.find(([, args]) => args[0] === "build")[1]),
      [
        "build",
        "-p",
        "orgtrack-pm-cli",
        "-p",
        "org2_ui_cli",
        "--bins",
        ...(target ? ["--release", "--target", target] : []),
      ]
    );
    for (const name of ["org2-pm", "org2-ui"]) {
      assert.equal(
        fs.readFileSync(
          path.join(
            root,
            "src-tauri",
            "binaries",
            `${name}-${triple}${suffix}`
          ),
          "utf8"
        ),
        name
      );
    }
  });
}

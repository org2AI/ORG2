const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const baselinePath = "config/typed-lint-baseline.json";
const digest = createHash("sha256")
  .update("scanner regression fixture")
  .digest("hex");

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    timeout: 60_000,
    maxBuffer: 1024 * 1024,
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  return result;
}

function repository(t, files) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "org2-gitleaks-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  for (const name of [".gitleaks.toml", ".gitleaksignore"]) {
    fs.copyFileSync(path.join(root, name), path.join(directory, name));
  }
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(directory, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  git(directory, ["init", "--quiet"]);
  git(directory, ["config", "user.name", "Scanner Test"]);
  git(directory, ["config", "user.email", "scanner@example.invalid"]);
  commit(directory);
  return directory;
}

function git(directory, args) {
  const result = run("git", args, directory);
  assert.equal(result.status, 0, result.stderr);
}

function commit(directory) {
  git(directory, ["add", "."]);
  git(directory, [
    "-c",
    "core.hooksPath=/dev/null",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "--quiet",
    "-m",
    "Scanner fixture",
  ]);
}

function scan(directory) {
  const image = process.env.GITLEAKS_DOCKER_IMAGE;
  const target = image ? "/repo" : directory;
  const args = [
    "git",
    target,
    "--log-opts=HEAD",
    "--no-banner",
    "--redact",
    "--config",
    `${target}/.gitleaks.toml`,
    "--gitleaks-ignore-path",
    `${target}/.gitleaksignore`,
    "--report-format",
    "json",
    "--report-path",
    `${target}/report.json`,
  ];
  const result = image
    ? run(
        "docker",
        [
          "run",
          "--rm",
          "-v",
          `${directory}:/repo`,
          "-e",
          "GIT_CONFIG_COUNT=1",
          "-e",
          "GIT_CONFIG_KEY_0=safe.directory",
          "-e",
          "GIT_CONFIG_VALUE_0=/repo",
          image,
          ...args,
        ],
        directory
      )
    : run(process.env.GITLEAKS_BIN || "gitleaks", args, directory);
  assert.ok([0, 1].includes(result.status), result.stderr);
  const findings = JSON.parse(
    fs.readFileSync(path.join(directory, "report.json"), "utf8")
  );
  assert.equal(result.status, findings.length ? 1 : 0, result.stderr);
  return findings;
}

test("generated typed-lint hashes are accepted", (t) => {
  const directory = repository(t, {
    [baselinePath]: JSON.stringify([{ key: digest }], null, 2),
  });
  assert.deepEqual(scan(directory), []);
});

test("extending the config preserves upstream synthetic-fixture exclusions", (t) => {
  const alphabet = Array.from({ length: 26 }, (_, i) =>
    String.fromCharCode(97 + i)
  ).join("");
  const directory = repository(t, {
    "fixture.txt": `api_key = "${alphabet}"`,
  });
  assert.deepEqual(scan(directory), []);
});

test("hash exception cannot hide other paths, fields, formats, or default rules", (t) => {
  const providerToken = ["gh", "p_", digest.slice(0, 36)].join("");
  const directory = repository(t, {
    [baselinePath]: [
      `  "key": "${digest}",`,
      `  "api_key": "${digest}",`,
      `  "key": "${digest.slice(0, 63)}",`,
      `  "key": "${digest}", "message": "${providerToken}"`,
    ].join("\n"),
    "config/other.json": JSON.stringify({ key: digest }, null, 2),
    "nested/config/typed-lint-baseline.json": JSON.stringify(
      { key: digest },
      null,
      2
    ),
  });
  const findings = scan(directory);
  for (const line of [2, 3, 4]) {
    assert.ok(
      findings.some((f) => f.File === baselinePath && f.StartLine === line)
    );
  }
  assert.ok(
    !findings.some((f) => f.File === baselinePath && f.StartLine === 1)
  );
  for (const file of [
    "config/other.json",
    "nested/config/typed-lint-baseline.json",
  ]) {
    assert.ok(findings.some((f) => f.File === file));
  }
  assert.ok(findings.some((f) => f.RuleID === "github-pat"));
});

test("historical fingerprint exceptions do not accept new test tokens", (t) => {
  const fixture = ["01234567", "89ab", "cdef", "0123", "456789abcdef"].join(
    "-"
  );
  const file = "src-tauri/src/api/mobile_bridge/auth.rs";
  const directory = repository(t, { [file]: `let token = "${fixture}";` });
  assert.ok(scan(directory).some((f) => f.File === file));
});

test("full history catches a credential even after deletion", (t) => {
  const directory = repository(t, {
    "credential.txt": `api_key = "${digest}"`,
  });
  fs.unlinkSync(path.join(directory, "credential.txt"));
  commit(directory);
  assert.ok(scan(directory).some((f) => f.File === "credential.txt"));
});

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  MAX_LINES,
  countLines,
  findOversizedFiles,
  isCheckedSource,
  isGeneratedSource,
  parseNullDelimitedPaths,
} = require("./check-changed-file-length.cjs");

const SCRIPT = path.join(__dirname, "check-changed-file-length.cjs");

function lines(count) {
  return Array.from(
    { length: count },
    (_, i) => `const line${i} = ${i};\n`
  ).join("");
}

function makeTree(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "file-length-"));
  for (const [filePath, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, filePath)), { recursive: true });
    fs.writeFileSync(path.join(root, filePath), text);
  }
  return root;
}

function runCli(root, input, env = {}) {
  return spawnSync(process.execPath, [SCRIPT], {
    cwd: root,
    input: Buffer.from(input),
    encoding: "utf8",
    env: { ...process.env, GITHUB_ACTIONS: "", ...env },
  });
}

test("a touched file over the limit fails; a file exactly at the limit passes", () => {
  const root = makeTree({
    "src/long.tsx": lines(MAX_LINES + 1),
    "src/edge.ts": lines(MAX_LINES),
    "src/short.ts": lines(3),
  });

  assert.deepEqual(
    findOversizedFiles(["src/long.tsx", "src/edge.ts", "src/short.ts"], {
      root,
    }),
    [{ filePath: "src/long.tsx", lines: MAX_LINES + 1 }]
  );
});

test("files the pull request does not touch are never judged", () => {
  // The whole point of scoping to the diff: an existing long file stays as it
  // is until a pull request edits it.
  const root = makeTree({
    "src/legacy.ts": lines(MAX_LINES * 2),
    "src/short.ts": lines(3),
  });

  assert.deepEqual(findOversizedFiles(["src/short.ts"], { root }), []);
});

test("lines are counted the way an editor numbers them", () => {
  assert.equal(countLines(""), 0);
  assert.equal(countLines("a"), 1);
  assert.equal(countLines("a\n"), 1);
  assert.equal(countLines("a\nb"), 2);
  assert.equal(countLines("a\r\nb\r\n"), 2);
  assert.equal(countLines("\n"), 1);
});

test("test code is exempt", () => {
  for (const exempt of [
    "src/store/chatPanel/__tests__/chatPanelTabsAtom.test.ts",
    "src/engines/ChatPanel/panels/ProjectPanelView.test.tsx",
    "src/test/vitest.setup.ts",
    "src/app/root/e2e/helpers/cloud.ts",
  ]) {
    assert.equal(isCheckedSource(exempt), false, exempt);
  }

  // The E2E exemption is the helper directory, not every file named after E2E.
  assert.equal(isCheckedSource("src/app/root/E2EBootstrap.tsx"), true);
  assert.equal(isCheckedSource("src/util/qr/buildQrCodeSvg.ts"), true);

  const root = makeTree({ "src/app/root/e2e/types.ts": lines(MAX_LINES + 50) });
  assert.deepEqual(
    findOversizedFiles(["src/app/root/e2e/types.ts"], { root }),
    []
  );
});

test("i18n code is exempt", () => {
  // The locale registry and loaders grow with each supported language.
  for (const exempt of [
    "src/i18n/index.ts",
    "src/i18n/loaders/resources.ts",
    "src/modules/MobileRemote/locales/en.ts",
  ]) {
    assert.equal(isCheckedSource(exempt), false, exempt);
  }

  // Only the i18n directories are exempt, not every file that mentions i18n.
  assert.equal(isCheckedSource("src/hooks/i18n/useRouteLabel.ts"), true);
  assert.equal(isCheckedSource("src/modules/MobileRemote/mobileI18n.ts"), true);

  const root = makeTree({ "src/i18n/index.ts": lines(MAX_LINES + 50) });
  assert.deepEqual(findOversizedFiles(["src/i18n/index.ts"], { root }), []);
});

test("declaration files and listed data tables are exempt", () => {
  for (const exempt of [
    "src/types/ambient/global.d.ts",
    "src/types/mammoth.d.ts",
    "src/config/languageRegistry.ts",
  ]) {
    assert.equal(isCheckedSource(exempt), false, exempt);
  }

  // Data tables are listed by exact path, not by name.
  assert.equal(isCheckedSource("src/config/sidebarRegistry.ts"), true);
  assert.equal(isCheckedSource("src/config/languageRegistry.tsx"), true);
});

test("generated files are exempt by their header comment", () => {
  assert.equal(
    isGeneratedSource(
      "// Generated from mobile-relay-protocol. Do not edit; run the script.\n"
    ),
    true
  );
  assert.equal(
    isGeneratedSource(
      "/**\n * Generated Codex skin.\n *\n * DO NOT EDIT BY HAND.\n */\n"
    ),
    true
  );
  assert.equal(isGeneratedSource("/** @generated */\nexport {};\n"), true);

  // Code that merely mentions generation, or says so outside a header
  // comment or below the header, is still judged.
  assert.equal(
    isGeneratedSource("const hint = `system-generated request`;\n"),
    false
  );
  assert.equal(
    isGeneratedSource('const msg = "do not edit this field";\n'),
    false
  );
  assert.equal(
    isGeneratedSource(`${lines(20)}// DO NOT EDIT below this line\n`),
    false
  );

  const root = makeTree({
    "src/contracts/relay.ts": `// Generated. Do not edit.\n${lines(MAX_LINES + 50)}`,
    "src/contracts/handwritten.ts": lines(MAX_LINES + 50),
  });
  assert.deepEqual(
    findOversizedFiles(
      ["src/contracts/relay.ts", "src/contracts/handwritten.ts"],
      { root }
    ),
    [{ filePath: "src/contracts/handwritten.ts", lines: MAX_LINES + 50 }]
  );
});

test("only .ts and .tsx files under src/ are judged", () => {
  for (const ignored of [
    "scripts/ci/pr-policy.cjs",
    "scripts/quality/typed-lint/check.mjs",
    "src-tauri/src/lib.rs",
    "src/styles/_utilities.scss",
    "src/i18n/locales/en/sessions.json",
    "src/util/qr/qrcodeGeneratorVendor.js",
    "src/scripts/legacy.jsx",
    "docs/frontend-ui-audit-2026-08-28/GLOBAL.md",
    "README.md",
  ]) {
    assert.equal(isCheckedSource(ignored), false, ignored);
  }
  assert.equal(isCheckedSource("src/components/Button/index.tsx"), true);
  assert.equal(isCheckedSource("src/store/session.ts"), true);

  // A long Markdown or JavaScript file in the diff never fails the check.
  const root = makeTree({
    "docs/long.md": "line\n".repeat(MAX_LINES * 3),
    "src/util/qr/qrcodeGeneratorVendor.js": lines(MAX_LINES * 3),
  });
  assert.deepEqual(
    findOversizedFiles(
      ["docs/long.md", "src/util/qr/qrcodeGeneratorVendor.js"],
      { root }
    ),
    []
  );
});

test("a listed file missing from the checkout fails loudly", () => {
  const root = makeTree({});
  assert.throws(() => findOversizedFiles(["src/gone.ts"], { root }), /ENOENT/);
});

test("NUL-delimited paths preserve whitespace", () => {
  assert.deepEqual(
    parseNullDelimitedPaths(Buffer.from("src/a file.tsx\0docs/notes.md\0")),
    ["src/a file.tsx", "docs/notes.md"]
  );
});

test("the CLI exits non-zero and names each oversized file", () => {
  const root = makeTree({
    "src/long.tsx": lines(MAX_LINES + 12),
    "src/short.ts": lines(3),
  });

  const result = runCli(root, "src/long.tsx\0src/short.ts\0");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /src\/long\.tsx\s+712 lines/);
  assert.doesNotMatch(result.stderr, /short/);
  assert.equal(result.stdout, "");

  const annotated = runCli(root, "src/long.tsx\0", { GITHUB_ACTIONS: "true" });
  assert.equal(annotated.status, 1);
  assert.match(
    annotated.stdout,
    /^::error file=src\/long\.tsx,line=701,title=File too long::/
  );
});

test("the CLI passes when nothing touched is over the limit, including an empty diff", () => {
  const root = makeTree({ "src/short.ts": lines(3) });

  const result = runCli(root, "src/short.ts\0docs/notes.md\0");
  assert.equal(result.status, 0);
  assert.match(result.stdout, /1 changed TypeScript files checked/);

  assert.equal(runCli(root, "").status, 0);
});

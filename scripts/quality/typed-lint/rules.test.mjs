import { ESLint } from "eslint";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const config = require("../../../config/eslint.typed.cjs");
test("real type-aware rules reject async misuse and incomplete unions", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "orgii-typed-rules-"));
  try {
    await writeFile(
      path.join(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: { strict: true, target: "ES2020" },
        include: ["*.ts"],
      })
    );
    await writeFile(
      path.join(root, "bad.ts"),
      'async function send() {}\nvoid send();\n[1].forEach(async () => {});\nfunction state(x: "idle" | "busy") { switch(x) { case "idle": return; } }\n'
    );
    await writeFile(
      path.join(root, "good.ts"),
      'async function send() {}\nasync function run() { await send(); }\nfunction state(x: "idle" | "busy") { switch(x) { case "idle": return; case "busy": return; } }\n'
    );
    const lint = new ESLint({
      useEslintrc: false,
      allowInlineConfig: false,
      baseConfig: {
        ...config,
        ignorePatterns: [],
        parser: require.resolve("@typescript-eslint/parser"),
        parserOptions: { ...config.parserOptions, tsconfigRootDir: root },
      },
      resolvePluginsRelativeTo: process.cwd(),
    });
    const results = await lint.lintFiles([path.join(root, "*.ts")]);
    const bad = results.find((r) => r.filePath.endsWith("bad.ts"));
    assert.deepEqual(
      new Set(bad.messages.map((m) => m.ruleId)),
      new Set(Object.keys(config.rules))
    );
    assert.equal(
      results.find((r) => r.filePath.endsWith("good.ts")).messages.length,
      0
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

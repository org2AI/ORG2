import { ESLint } from "eslint";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.."
);
const lint = new ESLint({
  cwd: root,
  useEslintrc: false,
  allowInlineConfig: false,
  plugins: { orgii: { rules: { "queue-authority": require("./rule.cjs") } } },
  overrideConfig: {
    parser: require.resolve("@typescript-eslint/parser"),
    parserOptions: { ecmaVersion: "latest", sourceType: "module" },
    plugins: ["orgii"],
    rules: { "orgii/queue-authority": "error" },
  },
});
const results = await lint.lintFiles([
  "src/engines/SessionCore/hooks/session/useQueueDispatch.ts",
  "src/engines/SessionCore/derived/queueDispatchSyncInputsAtom.ts",
]);
console.log((await lint.loadFormatter("stylish")).format(results));
if (results.some((result) => result.errorCount)) process.exitCode = 1;
else
  console.log(
    "Queue authority check passed for dispatcher and subscription inputs."
  );

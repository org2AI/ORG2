import { Linter } from "eslint";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const lint = new Linter();
lint.defineRule("queue-authority", require("./rule.cjs"));
const owner = "src/engines/SessionCore/hooks/session/useQueueDispatch.ts";
const check = (code, filename = owner) =>
  lint.verify(
    code,
    {
      parserOptions: { ecmaVersion: 2022, sourceType: "module" },
      rules: { "queue-authority": "error" },
    },
    { filename }
  );
test("rejects renamed imports of status mirrors", () => {
  assert.equal(
    check(
      'import { sessionRuntimeStatusAtom as gate } from "@src/store/session";'
    ).length,
    1
  );
});
test("rejects namespace property, computed property and destructuring reads", () => {
  const head =
    'import * as state from "@src/store/session/cliSessionStatusAtom";';
  for (const expression of [
    "state.isSessionActiveAtom;",
    'state["isPendingCancelAtom"];',
    "const {isSessionEngineActiveAtom: active} = state;",
  ])
    assert.equal(check(head + expression).length, 1);
});
test("covers derived queue inputs and Windows paths", () => {
  const code = 'import { isSessionActiveAtom } from "../../store";';
  assert.equal(
    check(
      code,
      "C:\\repo\\src\\engines\\SessionCore\\derived\\queueDispatchSyncInputsAtom.ts"
    ).length,
    1
  );
});
test("permits FSM reads and status writes; leaves display consumers alone", () => {
  assert.equal(
    check(
      'import { getTurnPhase } from "../../control/turnLifecycle"; import { setSessionRuntimeStatusAtom } from "@src/store/session";'
    ).length,
    0
  );
  assert.equal(
    check(
      'import { sessionRuntimeStatusAtom } from "@src/store/session";',
      "src/components/Status.tsx"
    ).length,
    0
  );
});

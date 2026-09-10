# Native failure before prompt persistence

## Authoritative failure boundary

A real secondary Claude continuation materialized six previous native messages, then the CLI exited with a rejected resume ID before writing the new prompt. The exact durable turn intent was failed. Canonical continuation nevertheless threw a recovery-pending error for the absent native anchor, leaving the shared Chat working and repeatedly revisiting the same terminal execution.

The authoritative terminal is the exact backend turn intent; provider history owns portable output. The fix passes terminal status into reconciliation. Only a failed turn enters existing bounded mismatch recovery before accepting an unchanged portable pre-turn history as an empty failed tail. The existing cloud failure publisher emits an ordinary error and releases the queue owner. Late output is retained; divergent history and cancelled missing anchors remain pending. No historical source or queue row is manually rewritten.

## Verification

- `pnpm test src/engines/SessionCore/conversations/localConversationContinuation.test.ts src/features/Org2Cloud/SessionConversation/conversationTurnRunner.test.ts`: 72 passed. Coverage includes unchanged failed history, divergent history, late partial output, cancellation, native context-recovery ownership and canonical failure publication.
- `pnpm typecheck:fast`, changed-file ESLint, normal pre-commit hooks and `git diff --check`: passed.
- An earlier test expected a terminal native context failure with permanently unchanged history to remain pending. Its expectation now requires failed settlement while preserving its assertions that frontend code neither reruns the provider nor creates another execution.
- Actual preserved-request recovery passed in the new secondary package: the same durable failed intent was read once, its unchanged history was reconciled, and one canonical failure event was published. Chat displayed the error and returned to idle. The old recovery attempts did not recur during the following two minutes or the next successful send. Provider/account setup remains separate; no credentials or queue rows were edited.

| Area               | Verdict | Evidence                                                 | Change or reason kept                                                                | Verification                                                                         |
| ------------------ | ------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Background work    | fix     | Failed execution repeatedly retried an impossible anchor | Reuse bounded 250/750 ms recovery only on missing-anchor failure, then release owner | Failure and cancellation tests; same persisted request recovered and retries stopped |
| Memory             | keep    | Existing canonical before/after arrays                   | No persistent cache or retained job; comparison temporaries end with reconciliation  | Scope inspection and tests                                                           |
| Scope/isolation    | keep    | Exact session/turn durable terminal                      | No UI timeout or cross-account state drives finality                                 | Failure, divergence and late-output tests                                            |
| Rendering/hot path | fix     | Root stayed working after child was terminal             | Existing canonical error publisher and adopted-lifecycle settlement own completion   | Publication tests; real root error/idle and next successful request                  |

Architecture review covered terminal ownership, source authority, recovery control flow, queue finality and compatibility; no UI layout or schema changed. Rollback is a bundle revert. Performance verdict: pass for this bounded failure-finalization change. The preserved request settled once without rerunning the provider, the root became idle, and a later real send completed. No whole-app CPU improvement is claimed from unit tests.

After explicitly choosing the local Claude account's Fable 5.1 model, the same shared conversation created a new native UUID under the correct source checkout. The native JSONL contained ten user/assistant records including the previous context, preserved failed request/error and the new successful answer `20`. Chat displayed `20` and returned to idle. This validates recovery followed by real cross-instance continuation with a different account-bound execution, rather than deleting the failed test and starting over. The acceptance bundle combined #1465, #1485, #1486 and this change.

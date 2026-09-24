# Continuation setup recovery and remembered configuration

Implements Share Sessions finding F10. Previously, `forkTeammateSession` treated every `ForkOperationError` as invalid configuration, discarded remembered setup, and reopened selection. Only `agent_unavailable` now prompts once more. Replay, snapshot, and backend errors retain their original type and return to the operation. Success after re-selection no longer claims that the previous setup was reused.

Memory v2 is scoped by server and signed-in user, organization, and repository. Repository-less sessions use their source session identity. It retains at most 128 entries for 30 days and cleans up on access, with no background timer. Configuration is schema-validated and serialized input is limited to 512 KiB. Unknown identity disables reuse; switching identity during selection cancels the subsequent fork.

The identity ownership of v1 entries cannot be established, so they are neither migrated nor deleted. First use after upgrading requires selection again. Historical body/native transcript data is unchanged. Remembered configuration is a prior user choice, not authority to bypass the execution boundary's agent/account validation.

## Architecture review

| Layer               | Finding                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------- |
| 1 Compilation       | Typecheck passed; 3 relevant files / 58 tests passed                                                    |
| 2 Structure         | All promptForExecution entry points share the fork wrapper and one storage module                       |
| 3 Naming            | Setup memory means execution selection, never cloud authorization                                       |
| 4 Semantics         | Configuration failure, data failure, and execution result remain distinct                               |
| 5 Defaults          | Only agent_unavailable reopens setup; signed-out, invalid, or expired entries are not reused            |
| 6 Boundaries        | Memory does not replace execution validation; model selection cannot repair data errors                 |
| 7 Understandability | Preserve non-configuration errors; do not claim reuse after re-selection                                |
| 8 Wire/persistence  | No RPC change; a new localStorage v2 key avoids guessing v1 identity                                    |
| 9 Initialization    | Cloud list, imported replay, and guest fork share the wrapper; headless configuration remains explicit  |
| 10 Symmetry         | Workspace, agent, account, and model are stored/read as one selection under the same scope and lifetime |

## Lifecycle

| Area               | Verdict | Evidence                                       | Change or reason kept                                | Verification                                                                                        |
| ------------------ | ------- | ---------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Background work    | keep    | Access occurs only during user continuation    | No polling or expiry timer                           | Advancing fake time creates no task                                                                 |
| Memory             | fix     | Previous registry lacked count/lifetime limits | 128 entries, 30 days, input limit, on-access cleanup | Overflow, expiry, invalid-data regressions                                                          |
| Scope/isolation    | fix     | Repository-only key crossed identities         | Partition by identity/org/repo or source session     | User, endpoint, organization, repository-less source, and mid-selection identity-switch regressions |
| Rendering/hot path | keep    | No component/layout change                     | Correct only dialog trigger conditions               | Data errors create no dialog; invalid setup prompts only once                                       |

Existing profile storage owns local isolation; this change adds no shared global cache. Restart/module reload reads v2; signed-out requests do not reuse memory. v1 remains unread. Offline and source-snapshot errors preserve confirmed setup. Real desktop multi-profile, CPU/RSS, bilateral transfer, and provider rewrite/rotation were not newly measured; function tests cannot establish those outcomes.

Performance verdict: blocked. Resource limits and identity regressions are verified; real desktop lifecycle/resource acceptance remains incomplete. This change makes no performance-improvement or native/canonical consistency claim.

## Verification

`pnpm exec vitest run --config config/vitest.config.ts src/features/TeamCollaboration/forkSession.test.ts src/features/TeamCollaboration/forkSetupMemory.test.ts src/features/TeamCollaboration/cloudSessionFork.test.ts src/features/TeamCollaboration/useForkImportedSession.test.ts` discovered and ran **3 files / 58 tests**, all passing. `cloudSessionFork.test.ts` does not exist and is not counted as coverage.

`pnpm typecheck:fast`, ESLint for the four changed TS files, and `git diff --check` passed. No layout, button, or input changes; no screenshots were added. Tests directly assert whether the production wrapper creates a setup request.

This English translation preserves the original verification record and its limitations; translation alone does not extend runtime acceptance.

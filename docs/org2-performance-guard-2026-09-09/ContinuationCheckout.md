# Shared continuation checkout selection

## Source and invariant

The execution workspace comes from the shared local checkout resolver. A real secondary Claude conversation belonged to one local checkout, but main continuation chose a sibling clone with the same Git remote because repo-list order won before the exact source-path fallback. This was a persisted native execution path, not a sidebar label defect.

Prefer the source path within the already known, existing local candidate list before repository-scope resolution. The same resolver still checks repository identity and can choose another matching clone; no foreign path becomes a new candidate. The existing no-scope fallback is unchanged. No user-specific path or project name is hardcoded. Existing histories are left intact; a workspace mismatch makes the continuation runner create a fresh native child rather than reuse the old execution.

## Verification

- `pnpm test src/features/TeamCollaboration/forkSession.test.ts`: 35 passed, including two-clone preference, identity verification, stale-path rejection and canonical-root behavior.
- `pnpm typecheck:fast`, changed-file ESLint and normal pre-commit checks passed. The new worktree initially lacked the generated Husky bootstrap; `pnpm exec husky install` restored it and hooks then ran normally.
- Real main package combines native replay #1465, roster loading #1485 and this change. Before the fix, main continued a secondary Opus conversation in the sibling clone. After the fix and normal app restart, logs explicitly rejected reuse of that child's mismatching workspace and created a fresh native UUID under the source checkout.
- Raw JSONL contained all 13 user/assistant records including both instances' previous answers and the latest successful answer. Chat rendered that final answer and returned to idle. The original child/history was not moved or deleted.

| Area               | Verdict | Evidence                                             | Change or reason kept                                            | Verification                                                   |
| ------------------ | ------- | ---------------------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------- |
| Background work    | keep    | Existing action-time existence/scope probes          | Reorders the same candidates, no timer, retry or additional scan | Resolver call and real execution checks                        |
| Memory             | keep    | Request-local candidate array                        | One linear preference pass, no retained cache                    | Scope inspection and typecheck                                 |
| Scope/isolation    | fix     | Same-remote clone order selected wrong persisted cwd | Prefer known existing source candidate, retain scope checking    | Two-clone, stale-path and identity tests; native cwd read-back |
| Rendering/hot path | keep    | No component or subscription change                  | Resolver feeds the existing execution boundary                   | Actual Chat final response and idle state                      |

Performance verdict: pass for this bounded resolver change; no whole-app CPU improvement is claimed. Passive cloud refresh is an independent issue. Rollback is a bundle revert; no migration, credential, schema or historical cleanup occurs.

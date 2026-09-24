# Agent Org finalization recovery architecture audit

## Outcome

The authoritative boundaries now agree on three rules:

1. A pause/resume generation change fences stale execution writes, but it does not redefine which Tasks belong to the active work episode.
2. A user message is either admitted before final-summary generation starts, or rejected before any new execution authority is written. An exact replay of an already-admitted message remains idempotently accepted.
3. A rejected Task-creation request can be restored only from its exact persisted user event after an exact tool receipt proves why creation was refused.

Historical rows are not rewritten. If an old rejection lacks exact request provenance, the recovery command fails closed and the UI explains that the request cannot be restored.

## Authoritative source and write path

| Concern                      | Authoritative source                                                 | Producing write path                                                                 | Enforced invariant                                                                                |
| ---------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Work completion after resume | Active `agent_org_runtime_work_episodes` row and its Task bindings   | Task creation associates each Task with one work episode; member exit reads that set | Every Task in the active episode counts even when its creation generation predates resume         |
| Stale execution protection   | Run activation generation plus exact turn/runtime identities         | Pause and resume lifecycle writes                                                    | Old turns cannot write or stop new work; generation is not used as a work-scope query             |
| Finalizing admission         | Active final-summary receipt (`pending`, `running`, or `persisting`) | Turn admission transaction                                                           | A new user-originated Team turn writes no context or intent after finalizing wins the transaction |
| Rejected Task recovery       | Exact Task tool receipt plus exact source turn and user event        | Task tool result extraction and read-only recovery command                           | No model reply, nearby message, or Task title can become recovered user text                      |
| Draft ownership              | Existing per-session draft and image-draft stores                    | Existing composer restoration effect                                                 | Recovery targets one session and appends rather than overwriting newer text or images             |

## Ten-layer audit

| Layer                        | Finding and decision                                                                                                                                                                                                                | Evidence                                                                                                                       |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 1. Compilation               | Rust and TypeScript types carry the new optional provenance and stable rejection code end to end.                                                                                                                                   | `cargo test -p agent_core --lib`, `cargo check -p agent_core --all-targets`, TypeScript typecheck, targeted app extractor test |
| 2. Structure and duplication | Finalizing-error recognition lives in one low-level API helper; all ordinary, queue, group-root, and member surfaces reuse it. Exact draft recovery is one backend command.                                                         | Call-chain trace from Tauri admission to the three frontend dispatch paths                                                     |
| 3. Naming                    | `activation_generation`, `work_episode`, `finalizing`, and `rejected_request_turn_intent_id` name distinct concepts.                                                                                                                | Changed Rust/TypeScript fields and tests use the same terms                                                                    |
| 4. Semantic overloading      | Generation remains an authorization fence; work episode owns the user-visible body of work. The former generation-as-task-scope overload was removed.                                                                               | Member-idle Task count joins the active episode bindings                                                                       |
| 5. Default branches          | Missing source turn, missing rejection receipt, mismatched session/run, empty original content, and unknown send outcome all fail closed. Generic send failures retain the existing failed-row behavior.                            | Recovery-command negative test and frontend classifier tests                                                                   |
| 6. Cross-domain leakage      | The UI never decides whether a message was accepted. Rust admission owns that decision; UI state only prevents avoidable attempts and restores presentation state.                                                                  | Backend admission tests cover every Team input kind                                                                            |
| 7. New-developer clarity     | The final-summary status is reused instead of adding a shadow boolean. Recovery names state that the original request was rejected and is restored only as a draft.                                                                 | No new lifecycle state machine or business table                                                                               |
| 8. Wire protocol             | Tool results add optional `requires_episode_resolution` and exact turn provenance. Finalizing rejection uses a stable code with a run suffix. Old events deserialize with absent optional fields.                                   | Extractor and TypeScript DTO tests                                                                                             |
| 9. Entry-point parity        | Group root, coordinator private, member private, group mention, queued delivery, Force Send, Wingman, and mobile remote all cross the same Rust admission check when user-originated. Formal internal continuations remain allowed. | Admission classifier and all-path transaction tests                                                                            |
| 10. Resolver symmetry        | Recovery resolves run → exact coordinator turn → exact tool receipt → exact source event in the same order for root and group-root sources; neither branch guesses.                                                                 | `rejected_request_draft` source tests                                                                                          |

## Concurrency and lifecycle review

- The finalizing check runs inside the same immediate write transaction as turn admission. Therefore the message and report-start race has one winner.
- Replay lookup runs before the finalizing guard. A message committed first can safely replay after finalizing without creating a duplicate.
- Explicit finalizing rejection retracts the exact optimistic frontend event and removes its queued owner. Unknown transport outcomes do not restore and resend automatically.
- Member exit records keep the exact producing turn. A missing identity stays informational rather than borrowing the newest member turn.
- No timer, poller, retry loop, subscription, cache, or background worker was added.

## Known limits

- Historical Task rejection rows without the new optional provenance cannot be restored automatically.
- If removing an optimistic frontend event itself fails, the dispatcher preserves the failed row instead of risking a duplicate send; the draft is still recoverable.
- The long-history execution-detail navigation defect remains outside this change. Its 57-round rendered regression is intentionally retained as separate failure evidence.
- Real-provider validation and the 65-minute service soak were explicitly removed from this delivery. The manual guide covers user-run validation.

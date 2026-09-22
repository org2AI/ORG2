# Recovering a failed message projected from the durable queue

The durable message queue owns an unsent message and its frozen runtime target.
After restart, `appendQueuedUserEvents` can display that message without a
corresponding EventStore row. This is valid recovery data, not a missing prompt.

The previous `useEditUserMessage` retry path edited and flushed the held queue
owner, then required an update of the missing EventStore row. The update returned
false, so preparation restored the old held row and never reached native history
recovery or provider dispatch. The previous delivery error stayed visible.

`prepareOptimisticQueueUserRetry` now updates the stable queue projection, or
upserts that same deterministic projection if absent. Only the retry path calls
it, after the edited owner has been durably flushed and while dispatch remains
held. The retry mints a new turn intent; the queue row ID stays unchanged. A
projection write failure still restores the original held owner and dispatches
nothing. Ordinary pending/sent/failed projection updates and native transcript
availability/ambiguity checks remain unchanged.

Historical recovery uses the existing failed bubble's Retry action. No database
or queue cleanup, direct replay, or reconstructed user message is needed.

| Area                | Verdict | Evidence and lifecycle decision                                                                                                 | Verification                             |
| ------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Background work     | keep    | One explicit Retry invokes one update and, only if absent, one upsert; no timers, listeners, scans, or background retries added | Producer and hook tests                  |
| Memory              | keep    | No new retained collection or subscription; existing bounded queue remains sole dispatch owner                                  | Source inspection                        |
| Scope/isolation     | keep    | Projection uses the verified queue owner's session and queue ID; missing owner cannot create a row                              | Cold-owner and missing-owner hook tests  |
| Rendering           | keep    | Existing failed/pending bubble, with no presentation or filter changes                                                          | Existing hook and queue projection tests |
| Failure/concurrency | fix     | Failed upsert restores original held payload; two concurrent Retry calls with real queue atoms admit one replacement intent     | Hook regressions                         |
| Native boundary     | keep    | Empty-child proof and started/ambiguous history checks unchanged                                                                | Continuation and canonical-tail suites   |

Validation: eight targeted suites, 257 tests passed; TypeScript check, changed-file
ESLint, and `git diff --check` passed. The suites include the complete retry hook,
queue persistence/repository/atoms, queue dispatch, continuation and native tail
projection. Tests preserve original images/text and prove no history truncation,
no independent submit, and no dispatch before projection preparation.

Performance verdict: blocked on the final private artifact's real GUI Retry
acceptance. The source adds no idle work, but this report does not claim measured
performance improvement, cross-device acceptance, or successful provider recovery.

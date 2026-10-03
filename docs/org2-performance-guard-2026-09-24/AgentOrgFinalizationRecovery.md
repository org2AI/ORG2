# Agent Org finalization recovery performance review

| Area                | Verdict | Evidence                                                                                                                            | Change or reason kept                                                                     | Verification                                   |
| ------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Background work     | keep    | No new timer, polling loop, listener, subscription, provider retry, process, or worker exists in the diff.                          | Finalizing is projected from the existing run view; member exit remains event-driven.     | Source sweep plus core lifecycle tests         |
| Memory              | keep    | Recovery holds at most one modal preview and one existing single-value restore atom.                                                | Images reuse the bounded composer attachment path; no retained per-session map was added. | Restore and image-merge unit tests             |
| Database I/O        | keep    | Recovery runs only after a user click and uses run/session/turn keys, one bounded 32-row receipt query, and one exact event lookup. | No history scan or eager transcript load was added.                                       | Backend exact-source tests and query review    |
| Scope and isolation | keep    | Every payload carries a target session; backend checks run, session, turn, tool name, receipt result, and source event.             | Missing or mismatched provenance fails closed.                                            | Tampered-provenance regression test            |
| Rendering           | keep    | Existing run-view subscription supplies `runPhase`; the banner and disabled-submit value add no new subscription.                   | Recovery UI is mounted only on a matching Task result card.                               | Targeted Vitest and rendered mock-provider E2E |
| Late results        | keep    | Backend transaction selects the winner; frontend removes only the exact optimistic identity and does not retry an unknown outcome.  | Existing generation and queue ownership remain authoritative.                             | Message-first and finalizing-first tests       |

Lifecycle matrix:

| State                                | Behavior                                                                                                  |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| App idle / normal Team work          | No added work; sends continue normally                                                                    |
| Final summary active                 | Existing run-view update renders the banner; backend rejects late user admission                          |
| Report persisted, failed, or stopped | Existing receipt transition removes the gate; no cleanup timer is required                                |
| Hidden window                        | No new polling or animation; behavior follows existing run-view delivery                                  |
| Session switch / deletion            | Recovery payload is consumed only by its target session; existing atoms and session lifecycle own cleanup |
| Restart                              | Durable receipt provenance recreates the restore action; no in-memory cache is required                   |

Performance verdict: **pass** for the changed surface. The user explicitly removed the real-provider run and 65-minute soak; this change adds no long-lived resource whose safety depends on either test.

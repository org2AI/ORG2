# Workstation sharing lifecycle review

| Area               | Verdict | Evidence                                                                                                                                                                          | Change or reason kept                                                                                                            | Verification                                                                            |
| ------------------ | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Background work    | keep    | Scope changes are synchronous Jotai projections; settings reuse the existing persistence path                                                                                     | No timers, polling, workers, requests, or new listeners                                                                          | Source call-chain inspection                                                            |
| Memory             | keep    | Directory workspaces are durable user configuration, retained independently of chat deletion; MRU stays capped and repo cache keeps its existing 5-repo / 20-file-per-repo limits | No hidden rendered instances introduced; workspace documents are not automatically evicted because that would discard user state | Existing cache-limit tests; shared directory survives chat deletion test                |
| Scope/isolation    | fix     | Previous UI and Terminal selectors always chose a session key                                                                                                                     | Canonical directory/session/global resolver, remote fallback, immutable delayed keys                                             | Same-directory sharing; worktree, unknown-path, guest, deletion, and delayed-open tests |
| Rendering/hot path | keep    | Primitive identity separates session metadata changes from workspace projection                                                                                                   | Same-directory switches and session status changes preserve the presented key reference                                          | Mounted Jotai subscription test receives zero workspace notifications                   |

## Lifecycle matrix

| State                                 | Expected behavior                                                        | Evidence                                                   |
| ------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------- |
| Startup / no selected chat            | Global workspace; no automatic session activation                        | State test                                                 |
| Active / switch to matching directory | Reuse tabs, selection, tab data, MRU, Terminal target and editor cache   | State integration test                                     |
| Active / switch to other worktree     | Separate workspace and captured delayed queue                            | State integration tests                                    |
| Idle / hidden / return to focus       | No added recurring work                                                  | Source inspection; live CPU/RSS not measured               |
| Policy change / change back           | Each policy restores its own saved documents                             | State and storage round-trip tests                         |
| Chat deletion                         | Keep directory configuration; clear references to deleted agent terminal | State integration tests                                    |
| Live resource close                   | Remove live resource references from all directories                     | Canonical remove-action test                               |
| Session metadata missing or remote    | Stay isolated in session workspace                                       | Resolver + production state tests                          |
| Restart                               | Read directory and per-session documents together                        | Storage round-trip test; actual restart not exercised      |
| Detached window / second instance     | Use existing settings and session hydration paths                        | Source inspection only; live synchronization not exercised |
| Network / provider / auth transitions | No new transport or provider pipeline                                    | Outside the changed runtime paths                          |

The persistent workspace registry continues the existing user-owned document
retention model: total storage grows with configured workspaces, and persistence
writes the currently retained partitions. There is no claim of reduced CPU/RAM or
bounded aggregate workspace storage. Large workspace collections and actual
cross-window lifecycle remain unmeasured.

**Performance verdict: blocked** — targeted state/subscription tests and the
isolated branch's native TypeScript check pass. Live idle/hidden/restart/detached-window
CPU/RSS verification was not run under the user's no-computer-control preference.
This report does not certify a runtime performance improvement.

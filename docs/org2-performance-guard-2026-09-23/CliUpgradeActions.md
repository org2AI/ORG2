# CLI upgrade actions lifecycle audit

| Area               | Verdict | Evidence                                                                                | Change or reason kept                                                                                                      | Verification                                                                 |
| ------------------ | ------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Background work    | keep    | Upgrade runs only from a user click; registry metadata is pure data                     | No polling, scans, retries, or subscriptions added. Existing terminal readiness wait is bounded                            | Render without click dispatches nothing; failure requires explicit retry     |
| Memory             | keep    | Atom table allocated once from finite `CLI_AGENT` values, one small state per CLI/store | No runtime key insertion or session-history retention; closed session handle is replaced on next click                     | Fixed construction inspected; remount/closed-terminal tests pass             |
| Scope/isolation    | fix     | Previously one Cursor-only atom; now one atom for each CLI                              | Same-CLI notices share a launch; another CLI/store gets independent state; callback captures original atom                 | Concurrent notice, CLI switch, late completion and separate-store tests pass |
| Rendering/hot path | keep    | Each action reads only its CLI atom                                                     | Terminal session list is read on click, not subscribed for streaming changes. Shared menu listeners only active while open | Rendered UI tests; source ownership inspection                               |

## Lifecycle matrix

| Dimension                 | Behavior / evidence                                                                                            |
| ------------------------- | -------------------------------------------------------------------------------------------------------------- |
| App start / idle / hidden | No upgrade job created by render, focus or visibility; no new automatic work                                   |
| Click / active            | Dedicated terminal owns subprocess and output; opening is single-flight                                        |
| Failure / offline         | Dispatch failure clears opening and permits user retry; vendor command failures remain visible in the terminal |
| Remount / close notice    | Same pending operation remains owned by terminal and keyed atom; no relaunch                                   |
| Close terminal            | Next explicit click permits new launch; at most one remembered handle per CLI                                  |
| CLI switch / late promise | Captured per-CLI atom prevents write into the next selection                                                   |
| Store / instance          | Each Jotai store isolates atom values; cross-process coordination is not claimed                               |
| Auth / org / endpoint     | Local installed tools are machine scoped; no credentials or org data cached here                               |
| Source / sync / transport | Not applicable; no provider transcript ingestion, sync or transport change                                     |

Performance verdict: **blocked** for native desktop visible/hidden CPU/RSS and real PTY lifecycle measurement. Behavioral tests and targeted compilation pass, but they are not native performance evidence. The development frontend and native server eventually started in the original shared workspace, but desktop automation reported `Invalid app: org2ai.org2.dev`; no screenshot or native lifecycle measurement was obtained. The isolated PR worktree is verified with targeted tests and static checks. This is a verification limitation, not a measured regression. Actual third-party CLI upgrades have not been executed.

## CI follow-up: explicit promise rejection handling

Both the direct upgrade button and installer menu attach the same rejection handler to terminal launch. Failure returns the captured CLI/store state to idle and emits one error notification; success, single-flight deduplication, remounts and terminal reuse retain their existing ownership. No timers, subscriptions, automatic retries or retained collections were added. Rendered failure/retry/terminal-closure coverage now exercises both Cursor and Codex. The native measurement limitation above remains unchanged.

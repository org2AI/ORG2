# Subagent navigation and transcript visibility

## Contract and source trace

Expanding a task with actual workers must keep those children immediately below their parent through cloud grouping, pinning and pagination. Selecting a worker must expose its launch input, tools and completed answer in order, including after reload. A childless task must not gain a disclosure control. This PR changes the native worker lifecycle and its consuming sidebar/history projections; ordinary-session steering, Canvas, provider importers and cloud transport are outside scope.

The authoritative sources are the parent/child session relationship, `agent_messages`, persisted `events`, and the parent's exact `agent` launch fact. The sidebar bug was a projection error: child rows were repartitioned and paginated independently. The transcript bug originated in dispatch/finalization: callbacks persisted output live, then terminal code appended the entire provider history, duplicating output and recording the first input last. Non-streaming completions could also save provider text without publishing a chat event.

## Resulting invariants

- Menu children carry their parent row identity; grouping and pagination select roots before reattaching children. Existing query/subscription ownership is unchanged.
- Shared dispatch saves input before either foreground or background execution. A fresh fork seeds inherited non-system provider context once; resume saves only the new prompt. Invalid or failed input persistence stops execution before calling the provider.
- Live callbacks own assistant/tool writes. The obsolete replay writer and its two completion call sites are removed. Streamed and whole-response completions use one event publication path; empty text emits no empty bubble.
- Turn bodies and previews use the canonical index's sequence boundaries, avoiding ambiguous timestamp ranges. The equal-timestamp test covers a valid latent edge case, not an observed historical occurrence.
- Historical late input is projected first only for a native worker with matching parent child-ID and exact prompt, excluding resume/fork. Index version 15 lazily replaces derived summaries. Raw events and provider-history rows are unchanged.

## Historical remediation

Read-only investigation of 499 native workers found 69 late-input cases; 68 matched the exact-parent recovery rule. One unmatched case, four interrupted workers with no initial input, and 345 older workers with assistant rows but no assistant chat events remain unreconstructed. These groups are inventory findings, not a claim that all were produced by this version. Existing duplicate provider-history rows are not deleted. There is no bulk rewrite or speculative source reconstruction.

## Ten-layer review

| Layer                   | Finding / decision                                                                                                            |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 1 Compilation           | Isolated-branch frontend and Rust results are recorded in the performance reports and PR                                      |
| 2 Ownership/dead code   | One callback writer; remove full-transcript replay API and implementation-mirroring tests                                     |
| 3 Naming                | Parent menu identity is explicit; sequence is the round boundary, timestamp is display metadata                               |
| 4 Semantic overload     | Provider history and chat events are separate projections; existence of one does not prove the other is complete              |
| 5 Defaults              | No input aborts launch; empty completion publishes nothing; missing turn stays empty; unmatched legacy records stay unchanged |
| 6 Boundaries            | Dispatch owns launch admission; handlers own writes; index owns round boundaries; menu projection owns grouping               |
| 7 Maintainability       | Shared foreground/background dispatch and one history-window range definition                                                 |
| 8 Wire                  | No public IPC, serialized menu metadata, or source schema changes; derived index version changes only                         |
| 9 Initialization parity | Foreground/background share input persistence; fork context and resume behavior stay distinct                                 |
| 10 Resolver symmetry    | Initial, preview and expanded windows share sequence boundaries; local/cloud sidebar family ordering retained                 |

No styling/component refactor or new action controls are introduced. The changed production TSX only propagates parent identity, so a full UI consistency audit is not warranted. Source inspection found no new native buttons or substitute clickable elements.

Real desktop screenshots, paid provider/fork/cancellation runs, cloud/two-device behavior and visible/hidden CPU/RSS remain unverified. Performance reports explicitly retain a blocked measurement verdict. Reverting the change restores old behavior without recovering a backup because original events/history are not rewritten; derived indexes rebuild when their version differs.

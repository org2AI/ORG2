# Subagent transcript ordering and historical loading

## Outcome and authority

Selecting an expanded native worker must show its launch input, tools, and final reply in order. The authoritative facts are `agent_messages`, persisted `events`, and the parent's exact `agent` launch event. The reported child contained 29 tool events, one final assistant event, and one user event; the user event was written last. Its materialized index consequently had one event and zero body events.

The producing path was `agent/dispatch` → foreground/background executor → live `UnifiedSubagentHandler` persistence → post-execution `save_subagent_transcript`. That final append repeated the transcript already written by live callbacks and first persisted the launch input after the output.

Both launch modes now commit initial input through the shared dispatch boundary before execution. Fresh forks seed inherited provider context once; resumed workers append only the new prompt. Live callbacks retain ownership of assistant/tool persistence. The two terminal full-transcript appends and the obsolete replay API are removed. Whole-response completions without deltas now publish a chat event through the same segment path as streamed output, without duplicating streamed completions. Preparation/input-persistence failure aborts before provider execution; cancellation/error preserves the already-written prefix.

Historical compatibility requires a native subagent, its first user event, earlier tool/assistant output, and a matching parent launch with exact child identity and prompt, excluding fork/resume launches. The turn index and both initial/full-body windows project that input at child creation time. Body and preview queries use the index's sequence ranges so equal timestamps cannot merge distinct rounds. Index version 15 invalidates old derived summaries lazily. Raw event IDs, timestamps, payloads, and provider history remain unchanged. No destructive cleanup was performed. Unmatched old records and historical duplicate provider-history rows are not silently rewritten.

## Lifecycle and performance

| Area               | Verdict | Evidence                                                    | Change or reason kept                                                                    | Verification                                                            |
| ------------------ | ------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Background work    | fix     | Both terminal paths cloned and appended the full transcript | Remove detached/awaited replay writes; commit input before dispatch on blocking boundary | Producer regression and 143 orchestration tests                         |
| Memory             | fix     | Completion cloned growing history                           | No terminal clone; legacy index still streams SQLite rows, windows stay demand-loaded    | Source trace; complete persistence suite and equal-timestamp regression |
| Scope/isolation    | keep    | Session ID and exact parent launch qualify compatibility    | No global cache or cross-session inference; unmatched launch remains unchanged           | Negative ownership assertion in regression                              |
| Rendering/hot path | keep    | Compatibility runs on history loading, not streaming deltas | One session-scoped lookup and bounded-window rotation; no new subscriptions/timers       | Initial window and expanded body regression                             |

| Provider       | Raw transition                                | App/UI state             | Topology/boundary                                            | Expected invariant                                                        | Observed evidence                                                               |
| -------------- | --------------------------------------------- | ------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Native worker  | Launch → tool → result → assistant            | New session              | Shared foreground/background writer                          | User precedes output; each callback writes once                           | Production helper + callback test passed                                        |
| Native worker  | Resume → assistant                            | Existing session         | Same writer                                                  | Old history is not appended again                                         | Producer regression passed                                                      |
| Native worker  | Late launch input after tools/reply           | Cold/reloaded history    | SQLite → turn index → initial/body window                    | Complete body in one round, original source timestamp unchanged           | Regression passed                                                               |
| Native worker  | Follow-up after legacy round                  | Collapsed previous round | Initial window and expanded body                             | Separate newer round, old body still loadable                             | Regression passed                                                               |
| Native worker  | Missing matching parent launch                | Cold history             | Authoritative compatibility check                            | No speculative reassignment                                               | Regression passed                                                               |
| Native worker  | Actual reported stored transcript             | Existing pinned child    | Read-only source inspection                                  | Match exact parent prompt/child ID                                        | Production SQL matched the reported row; 31 source events confirmed             |
| Native worker  | Non-streaming / streaming / empty completion  | Live handler             | Completed callback → native history + chat event publication | One visible event for non-empty text, no duplicate stream or empty bubble | Callback regression passed in original workspace; isolated rerun recorded below |
| Own-db history | Distinct rounds at one timestamp              | Initial/preview/expanded | SQLite → index → windows                                     | Non-overlapping sequence boundaries                                       | Producing/loading regression                                                    |
| Native worker  | Actual fresh provider run, fork, cancellation | Live desktop             | Provider → UI                                                | Ordered partial/final output                                              | Not run against paid providers                                                  |
| Native worker  | Visible/hidden idle, repeated navigation      | Desktop                  | CPU/RSS/rendering                                            | No added background work                                                  | Real measurements not run                                                       |

## Original-workspace verification

- `cargo test -p session_persistence legacy_subagent_late_input --lib -- --nocapture`: passed.
- `target/debug/deps/session_persistence-22087875ed1a382b --test-threads=1`: 62 passed.
- `cargo test -p agent_core worker_launch_input_precedes_live_output_and_resume_does_not_replay_history --lib -- --nocapture`: passed.
- `target/debug/deps/agent_core-f08d8415ce0653f9 core::tools::impls::orchestration --test-threads=1`: 143 passed.
- Scoped `git diff --check`: passed.
- Linker emitted the existing large `__eh_frame` warning; test executable completed successfully.

## Isolated PR verification

Reapplied only the subagent/sidebar/history changes to current `develop` and reran:

- `cargo test -p session_persistence --lib -- --test-threads=1`: 63 passed, including both legacy recovery and equal-timestamp window regressions.
- `cargo test -p agent_core --lib core::session::persistence::messages::tests::worker_ -- --test-threads=1`: 2 passed (launch/resume persistence and completed event publication).
- `cargo test -p agent_core --lib core::tools::impls::orchestration -- --test-threads=1`: 143 passed.
- `cargo clippy -p agent_core -p session_persistence --all-targets -- -D warnings`: passed.
- Sidebar tests: 44 passed; full frontend typecheck and changed-file ESLint passed, as listed in the sidebar report.

Architecture review focused on persistence ownership, launch/finalization ordering, derived index invalidation, and foreground/background initialization parity. No public wire or schema shape changes. This report covers the backend portion; sidebar verification is in `SidebarSubagentExpansion.md`. No cloud/two-device behavior is claimed.

Performance verdict: blocked — structural bounds and targeted behavior are verified, but live visible/hidden CPU/RSS and paid-provider/fork/cancellation transitions have not been measured.

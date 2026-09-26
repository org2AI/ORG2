# Native conversation materialization fidelity

## Source and root cause

Read-only inspection matched the reported SDE conversation and its Codex child in the local session database. The failed child was pending with no user_input, PID, accepted turn intent or usage. It retained one failed optimistic user event, one native-ID ledger row and 18 copied shell replays, but its native binding/file had been discarded after read-back verification failed. No private transcript content or identifiers are included here.

The source SDE events use built-in names such as `run_shell`; Rust native ingestion resolves them to storage names such as `run_command_line`. TypeScript previously wrote the unnormalized name and compared it strictly against the normalized read-back. The first send therefore failed despite identical arguments/output. The catch path then removed a published native artifact without removing its dependent ledger/replay records. Retry could no longer bracket the child's history with a stable revision.

The canonical IR projection now uses the Rust-owned storage alias registry and lowercase fallback, matching native ingestion for both calls and results. Comparisons still validate call identity, arguments, output, error flags and ordering. Read-back failure still prevents dispatch but retains the published artifact/binding for subsequent inspection and prefix validation. A transient read failure can recover through existing synchronization; a real mismatch still fails closed.

## Historical remediation

No live database, transcript or dependent replay was modified. Previously discarded native files are not recreated by this PR. The reported already-stranded child therefore needs separate, explicitly authorized recovery after inventory; its failed prompt and audit records must be preserved. Keeping future failed materializations avoids producing this state again. No schema, IPC or persistence-format change; rollback is a code revert, with retained artifacts remaining ordinary provider transcripts.

## Architecture review

| Layer                | Verdict / scope                                                                                 |
| -------------------- | ----------------------------------------------------------------------------------------------- |
| 1 Compilation        | Full tsgo check and changed-file ESLint passed                                                  |
| 2 Ownership          | Existing IR producer and native materializer remain the only owners                             |
| 3 Naming             | Storage canonical names replace raw built-in names at the transport boundary                    |
| 4 Semantics          | UI canonical, storage canonical and provider call identity remain distinct                      |
| 5 Defaults           | Unknown tools follow Rust's lowercase fallback; mismatches remain errors                        |
| 6 Boundaries         | Source normalization precedes native writes; no UI predicate or alias exception                 |
| 7 Discoverability    | Comments document alias and rollback failure mechanisms                                         |
| 8 Wire               | Outgoing item names asserted through materialize invocation; Rust registry contract tested      |
| 9 Init parity        | Existing bundled registry initialization reused; no startup changes                             |
| 10 Resolver symmetry | Calls/results share normalization; materialize/synchronize/prefix consumers use same projection |

## Lifecycle review

| Area               | Verdict | Evidence                                 | Change or reason kept                                   | Verification                                  |
| ------------------ | ------- | ---------------------------------------- | ------------------------------------------------------- | --------------------------------------------- |
| Background work    | keep    | User-triggered materialization/read-back | No timers/retries/subscriptions added                   | Call-chain review and invocation assertions   |
| Memory             | keep    | Existing bounded IR and registry         | No retained transcript cache                            | Source inspection                             |
| Scope/isolation    | fix     | Session-bound native receipt             | Retain exact published artifact on verification failure | Failure and subsequent synchronize regression |
| Rendering/hot path | keep    | No React/streaming changes               | No runtime performance claim                            | Source inspection                             |

| Provider            | Raw transition                                          | App/UI state                      | Topology/boundary                                  | Expected invariant                                                  | Observed evidence                                |
| ------------------- | ------------------------------------------------------- | --------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------ |
| SDE → Codex         | Native seed write/read-back                             | Existing local historical failure | Read-only database inventory                       | Tool aliases preserve semantic identity                             | Exact error and orphan evidence confirmed        |
| Shared native IR    | Built-in/CLI/custom names, failed read, synchronization | Unit fixture                      | Production projection/materializer with mocked IPC | Stable canonical names; no discard; strict changed-output rejection | Targeted regressions passed                      |
| Codex / Claude Code | GUI switch, retry, restart                              | Fixed desktop artifact            | Native runtime                                     | Successful send and stable reloaded history                         | Not run                                          |
| All                 | Idle/hidden/close/delete                                | Runtime                           | CPU/RSS                                            | No added background work                                            | Source review only; runtime measurements not run |

Performance verdict: blocked for runtime acceptance: fixed-build GUI switch/retry/restart and CPU/RSS measurements were not run. No new runtime resource is introduced; this is not a measured performance improvement.

## Verification

- `pnpm test src/engines/SessionCore/conversations src/engines/SessionCore/__tests__/rustTsContract.test.ts`: 13 files, 541 tests passed
- `pnpm typecheck:fast`: passed
- `pnpm exec eslint src/engines/SessionCore/conversations/nativeConversationProjection.ts src/engines/SessionCore/conversations/nativeConversationMaterializer.ts src/engines/SessionCore/conversations/nativeConversationMaterializer.test.ts --max-warnings 0`: passed
- `pnpm check:circular`: passed, 8,166 modules
- `pnpm check:test-placement`: passed, 634 directories
- `git diff --check`: passed
- No Rust production code changed; Rust compilation/native provider execution not run
- No visual layout changed; screenshots would not establish native round-trip correctness

# Native conversation materialization fidelity

## Source and root cause

Read-only inspection matched the reported SDE conversation and its Codex child in the local session database. The failed child was pending with no user_input, PID, accepted turn intent or usage. It retained one failed optimistic user event, one native-ID ledger row and 18 copied shell replays, but its native binding/file had been discarded after read-back verification failed. No private transcript content or identifiers are included here.

The source SDE events use built-in names such as `run_shell`; Rust native ingestion resolves them to storage names such as `run_command_line`. TypeScript previously wrote the unnormalized name and compared it strictly against the normalized read-back. The first send therefore failed despite identical arguments/output. The catch path then removed a published native artifact without removing its dependent ledger/replay records. Retry could no longer bracket the child's history with a stable revision. A native app run also reached Codex CLI → SDE and reproduced the reverse mismatch: Rust projected the retained SDE history using the raw executable name while canonical SessionEvents used the storage name.

The canonical TS materialization and Rust SDE history read-back projections now use the Rust-owned storage alias registry and lowercase fallback, matching native ingestion for both calls and results. The native executable history remains unchanged. Comparisons still validate call identity, arguments, output, error flags and ordering. Read-back failure still prevents dispatch but retains the published artifact/binding for subsequent inspection and prefix validation. A transient read failure can recover through existing synchronization; a real mismatch still fails closed.

After a restart, the native run exposed a second Retry blocker: its failed EventStore projection retained a `queueMessageId`, while the durable queue had no corresponding delivery. The Retry path now asks the existing orphan reconciler to inspect that exact session, reads the row back, and proceeds only if it is still failed and its ownership claim has been removed. This is bounded work on a user click, not a background scan. Claude Code Default is also resolved through the ambient native CLI login rather than an unrelated saved credential; an explicitly selected account still uses its own key.

## Historical remediation

No live database, transcript or dependent replay was manually modified. Previously discarded native files are not recreated by this PR. The reported already-stranded child therefore needs separate, explicitly authorized recovery after inventory; its failed prompt and audit records must be preserved. Future failed queue projections with no durable owner can be reconciled narrowly when their Retry button is clicked. Keeping future failed materializations avoids producing the missing-native-artifact state again. No schema, IPC or persistence-format change; rollback is a code revert, with retained artifacts remaining ordinary provider transcripts.

## Architecture review

| Layer                | Verdict / scope                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------ |
| 1 Compilation        | Full tsgo check, changed-file ESLint, Rust tests and clippy passed                               |
| 2 Ownership          | Canonical TS/Rust projections own aliasing; the queue reconciler owns orphan claims              |
| 3 Naming             | Storage canonical names replace raw built-in names only at comparison boundaries                 |
| 4 Semantics          | Executable native history, storage canonical names and provider call identity remain distinct    |
| 5 Defaults           | Unknown tools follow Rust's lowercase fallback; Claude Default uses ambient native login         |
| 6 Boundaries         | Projection normalization precedes native comparison; Retry proves absent queue ownership         |
| 7 Discoverability    | Comments document alias, credential and orphan Retry mechanisms                                  |
| 8 Wire               | Materialize invocation and Rust prefix regressions assert canonical names; wire format unchanged |
| 9 Init parity        | Existing bundled registry initialization reused; native CLI launch profile tested                |
| 10 Resolver symmetry | Calls/results share normalization in both TS and Rust projections                                |

## Lifecycle review

| Area               | Verdict | Evidence                                          | Change or reason kept                                               | Verification                                   |
| ------------------ | ------- | ------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------- |
| Background work    | keep    | User-triggered materialization/read-back/Retry    | No timers or subscriptions added; Retry reconciles once             | Call-chain review and invocation assertions    |
| Memory             | keep    | Existing bounded IR and registry                  | No retained transcript cache                                        | Source inspection                              |
| Scope/isolation    | fix     | Session-bound native receipt and failed queue row | Retain exact artifact; reconcile only the failed projection session | Failure, synchronization and Retry regressions |
| Rendering/hot path | keep    | No React/streaming changes                        | No runtime performance claim                                        | Source inspection                              |

| Provider            | Raw transition                                          | App/UI state     | Topology/boundary                           | Expected invariant                                                  | Observed evidence                                                                                                                                                                            |
| ------------------- | ------------------------------------------------------- | ---------------- | ------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SDE → Codex         | Native seed write/read-back                             | Native macOS app | Local synthetic conversation                | Tool aliases preserve semantic identity                             | Send succeeded after TS fix                                                                                                                                                                  |
| Shared native IR    | Built-in/CLI/custom names, failed read, synchronization | Unit fixture     | TS materializer and Rust history projection | Stable canonical names; no discard; strict changed-output rejection | Targeted TS/Rust regressions passed                                                                                                                                                          |
| Codex / Claude Code | GUI switch, retry, restart                              | Native macOS app | Same synthetic conversation                 | Successful send and stable reloaded history                         | Six sequential SDE → Codex CLI → Claude CLI → Codex CLI → SDE → Claude CLI sends passed; reverse SDE mismatch reproduced before the Rust fix, then fixed-build Retry and cold restart passed |
| All                 | Idle/hidden/close/delete                                | Runtime          | CPU/RSS                                     | No added background work                                            | Source review only; runtime measurements not run                                                                                                                                             |

Performance verdict: native round-trip, Retry and cold-restart acceptance passed. CPU/RSS and idle/hidden resource use were not measured; no performance improvement is claimed. No new retained runtime resource is introduced.

## Verification

- `pnpm test src/engines/SessionCore/conversations src/engines/SessionCore/__tests__/rustTsContract.test.ts`: 13 files, 541 tests passed
- `pnpm typecheck:fast`: passed
- `pnpm exec eslint src/engines/SessionCore/conversations/nativeConversationProjection.ts src/engines/SessionCore/conversations/nativeConversationMaterializer.ts src/engines/SessionCore/conversations/nativeConversationMaterializer.test.ts --max-warnings 0`: passed
- `pnpm check:circular`: passed, 8,166 modules
- `pnpm check:test-placement`: passed, 634 directories
- `pnpm test src/engines/ChatPanel/ChatHistory/hooks/__tests__/useEditUserMessage.test.ts src/engines/SessionCore/hooks/session/__tests__/messageQueuePersistence.test.ts`: 2 files, 56 tests passed
- `cargo test -p org2 --lib agent_sessions::cli::native_ir::tests`: 11 passed; `cargo test -p org2 --lib ambient_claude_launch_does_not_inherit_a_saved_account`: 1 passed
- Changed-file rustfmt and pre-commit `cargo clippy -p org2`: passed
- `git diff --check`: passed
- Native macOS app completed SDE → Codex CLI → Claude CLI → Codex CLI → SDE → Claude CLI in one synthetic conversation. Codex CLI → SDE reproduced the reverse mismatch before the Rust fix; fixed-build Retry passed, and cold restart preserved all six prompt/response pairs once
- Two isolated native app data homes and local clones exchanged Team Chat messages without starting an Agent run. A subsequent Agent prompt recovered both human marker strings from context; this is an integration check, not a change to Team Chat's writer
- Full `cargo fmt --all -- --check` reports pre-existing formatting differences outside this diff; changed Rust files passed rustfmt individually
- No visual layout changed; screenshots would not establish native round-trip correctness

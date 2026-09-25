# Native history acceptance

Implementation: `86df4e6bd4d08f26497e74a3a156c4906758b04c`, macOS ARM64.
Final signed Combined9 includes the separately scoped Reserve dependency only
for local acceptance; combined branches, diagnostics and bundles are not published.
The later documentation consolidation changes no runtime behavior.

## Current result and limits

**The recorded bounded macOS acceptance passed.** Clean user messages, native C7
contention/reopen, growing current ORG2 output, Stop visibility and identical
partial recovery after normal Quit/reopen were verified. The final user screenshot
at 19:57 local shows the final stopped forest-story reply and idle state.

Full large-history IPC/WebKit performance, hours-long stability, the complete
provider/platform matrix and continuous viewport pinning during Stop remain
unverified. Prior failed candidates remain failures; the historical record is
linked below rather than repeated as the current verdict.

## Product and provider matrix

| Provider     | Raw transition                             | App/UI state                                | Topology/boundary                               | Expected invariant                                 | Observed evidence                                                                                                                                                                             |
| ------------ | ------------------------------------------ | ------------------------------------------- | ----------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex        | New user/reply                             | Native GUI open                             | Isolated primary/managed                        | Clean body, one reply, correct order               | User confirmed no internal correlation markup and correct reply/order.                                                                                                                        |
| Codex        | Reverse append/LWW, C7                     | Destination loaded, then normal Quit        | Native GUI, actual SQLite store and ORG2        | Defer concurrent writes, converge after exit       | Final writer-fenced run converged automatically, cleared pending/wait/observation work and launch lock; all 15 observed process lifetimes released. No manual lock/cache edits.               |
| Codex        | Current assistant append                   | ORG2 ordinary Send                          | Provider → live buffer → GUI                    | Current body grows                                 | Combined9 screenshots show current growing text; a naturally completed 17,009-character response exactly matches native raw assistant output.                                                 |
| Codex        | Interrupted append                         | Stop → normal Quit → cold reopen            | Sparse finalized cache and ordinary native load | One exact partial in the correct position          | One cancelled 8,734-character partial retained identically across reopen, one marker; observed backend/WebKit/source lifetimes released on Quit.                                              |
| Codex        | Repeated interrupted append                | Final Stop, then user scroll                | ORG2 GUI/cache                                  | Stopped body remains visible                       | `ORG2_FINAL_STOP_0924`: one 2,866-character partial; user's screenshot shows forest-story paragraphs, worked-for14s, idle and normal Expand. This does not prove continuous viewport pinning. |
| Codex        | Both sides change/tie                      | Owning-boundary fixtures                    | Raw files + SQL                                 | Deterministic winner, no rebound                   | Tests for both directions, primary tie and unchanged bytes with changed mtime passed in recorded suites.                                                                                      |
| Codex        | Fork/generation/crash                      | Staged/published/restarted fixtures         | Raw lineage, SQLite, durable snapshot           | Frozen ancestors survive; no duplicate publication | Recorded native-store tests cover missing ancestors, rename/SQL-before-ledger recovery and source advancement after interruption; not a full new GUI fork matrix.                             |
| Claude       | First namespace registration               | Fresh instance95 Configure/Open/Quit/reopen | Official Claude 2.7032.0 and isolated home      | No fabricated namespace or live-writer bypass      | First Quit imported byte-identical history automatically; second Open showed one conversation with all six messages in order; final Quit unchanged. No new prompt sent.                       |
| Claude       | Exit-time handoff                          | Two Open/Quit cycles                        | Native process/config-lock boundaries           | Automatic recovery without page/focus workaround   | Recorded metadata-only cycles passed. Baseline also passed once, so the original race's exact cause was not proven; deterministic regressions cover both repaired boundaries.                 |
| Codex/Claude | Large append/rewrite/rotation combinations | Large active/pinned history in real GUI     | Full native ingestion, IPC and WebKit           | Correct identity and bounded cost                  | Not fully run. Shared fixtures and mocked IPC do not certify every provider adapter/transition.                                                                                               |
| Codex/Claude | Sustained lifecycle                        | Hours-long/all-platform/account transitions | Desktop resource ownership                      | No sustained growth or stale-owner writes          | Not fully run. Current evidence is bounded macOS measurement only.                                                                                                                            |

Final partial SHA-256:
`4e209ecd7a03aa9d597597ebd99d21ff4259c263590e2c7ec52173e86e0335c2`.

## Resource evidence

Five-second sampling covered a 900.044-second mixed lifecycle: generation,
cancellation, Quit, reopen and idle. CPU percentages use one core as100%.

| Sample                          | Backend         | WebKit                        | Source app-server |
| ------------------------------- | --------------- | ----------------------------- | ----------------- |
| Whole-run mean CPU              | 1.214%          | 3.817%                        | 0.134%            |
| Peak sampled RSS                | 194.38 MiB      | 712.77 MiB                    | 182.03 MiB        |
| Settled 389.397-second mean CPU | 0.465%          | 1.352%                        | Absent            |
| Settled physical footprint      | 89.25→84.97 MiB | 399.27→424.74 MiB, peak459.33 | Absent            |

The settled interval (02:39:30–02:45:59 UTC) excludes model work and the later
benchmark. Process identities stayed stable and sampled groups showed no physical
writes. UI Hide was an action, not an instrumented DOM visibility state.
WebKit footprint grew25.47 MiB; lower RSS is not evidence of deallocation or
leak-free behavior. Earlier visible/minimized and240-second build-contention
samples remain scoped to their recorded candidate builds.

## Larger-prefix supplement

A temporary test exercised production projection hydration with mocked EventStore
IPC, 1,024-character bodies, exact projected counts and prepared user last.
It was archived locally and removed from source.

| Events | Median hydration | Maximum hydration | JSON size |
| -----: | ---------------: | ----------------: | --------: |
|  1,000 |          0.13 ms |           0.31 ms |  3.28 MiB |
| 10,000 |          6.09 ms |           8.85 ms | 32.76 MiB |
| 25,000 |          2.40 ms |           2.95 ms | 81.91 MiB |

At25k, JSON encode/decode took101.8/103.9 ms. Non-monotonic JIT-influenced results
are not a scaling guarantee. This excludes real worker RPC, persistence and
WebKit rendering and cannot stand in for large-history GUI acceptance.

## Resource ownership review

| Area               | Verdict                     | Evidence                                                                    | Change or reason kept                                                                        | Verification                                                                 |
| ------------------ | --------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Background work    | keep                        | Owner leases, cancellation, bounded dirty queues and native invalidation    | No idle rescan without work; existing750ms pending/coalescing loop retained                  | Coordinator tests and bounded native lifecycle                               |
| Memory             | keep with limits            | Two native discovery slots, capped stream buffers and bounded copy passes   | Native ancestor retention is required; orphan staging remains a pre-existing disk limitation | Bound tests/resource samples; no global disk or leak-free claim              |
| Scope/isolation    | keep                        | Profile/runtime/owner generations and actual SQLite writer fences           | Stale owners and wrong roots cannot authorize publication                                    | Owner/runtime mismatch tests and actual C7                                   |
| Rendering/hot path | keep with large-history gap | Existing per-session delta buffer, trailing~50ms flush and terminal cleanup | No broad delta subscription; unchanged projection avoids extra I/O                           | Growing-text screenshots, Stop/reopen and targeted projection/viewport tests |

## Commands and results

These are recorded executed checks, not new runs caused by documentation cleanup.
Historical command lines and native fixture environments remain in the immutable
reports below.

- At implementation `86df4e6bd4`, `pnpm exec vitest run --config config/vitest.config.ts`
  with `src/engines/SessionCore/conversations/{localConversationProjectionHydration,localConversationContinuation,localConversationSettledTail}.test.ts`:
  **108 passed**; three new hydration cases fail against the previous writer.
- Same Vitest command with
  `src/engines/SessionCore/sync/__tests__/sessionSyncUtils.test.ts`,
  `src/engines/SessionCore/conversations/nativeConversationReconciliation.test.ts`,
  `src/engines/ChatPanel/ChatHistory/renderers/cliLiveActivity.test.ts`:
  **24 passed**.
- Same Vitest command with
  `src/engines/ChatPanel/ChatHistory/viewport/__tests__/useTranscriptViewport.test.ts`
  and `src/engines/ChatPanel/ChatHistory/components/__tests__/{ChatHistoryListIdentity,ChatHistoryListPinning}.test.ts`:
  **35 passed**. These do not prove real WebKit geometry.
- Same Vitest command with local-only
  `src/engines/SessionCore/conversations/localProjectionAcceptancePerf.test.ts`:
  **1 passed**; benchmark limitations above.
- `pnpm exec tsgo --noEmit`, changed-file ESLint, `git diff --check` and
  pre-commit checks passed for the implementation corrections.
- `cargo test --manifest-path src-tauri/Cargo.toml -p orgtrack_core --lib --locked sources::codex::app::transcript`:
  **31 passed, 3 existing ignored**.
  `cargo clippy --manifest-path src-tauri/Cargo.toml -p orgtrack_core --lib --locked -- -D warnings`: passed.
- Earlier Claude namespace tests, UI status tests and full owning-boundary
  storage/launch suites are recorded at their exact candidate revisions in the
  historical reports; they are not relabeled as freshly rerun final-HEAD tests.
- GitHub CI is checked on the published merge candidate. An earlier workspace
  run failed the unchanged git_api lock-drop test; the retry and later candidate
  results must be read from CI, not inferred from this document.

## Historical failures and evidence

| Candidate                     | Observed result                                                   | Resolution/evidence boundary                                                                                                                                  |
| ----------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Early C2/C6                   | Real plugin argv rejected; reservation could remain uncertain     | Typed plugin boolean allowance and observed process-lifetime recovery. Unknown launch outcomes remain fenced.                                                 |
| Early C4                      | Old bare model rejected, then upstream supply unavailable         | Narrow Codex-only bare-model fallback; Reserve supply/accounting handled separately.                                                                          |
| Combined93 / Fence follow-ups | Wrong writer/store boundary or stale physical generation          | Fence actual SQLite home and resolve its authoritative rollout.                                                                                               |
| Combined5 / diagnostic        | Typing without body; Stop cache existed but was not visible       | Sparse cache/intent recovery and cold-load parity; this candidate remains a failed acceptance.                                                                |
| Combined7 / Diagnostic8       | Prior partial duplicated after new user, obscuring current output | Diagnostic showed current buffer growth; pre-dispatch authoritative projection replacement fixed the producing boundary. Diagnostic alone was not acceptance. |
| Combined9                     | Current stream and stopped/reopened body verified                 | Final bounded acceptance above; full performance matrix remains open.                                                                                         |

[Archived architecture report](https://github.com/org2AI/ORG2/blob/86df4e6bd4d08f26497e74a3a156c4906758b04c/docs/architecture-audit-2026-09-23/native-history-compatibility.md)
and [archived acceptance chronology](https://github.com/org2AI/ORG2/blob/86df4e6bd4d08f26497e74a3a156c4906758b04c/docs/org2-performance-guard-2026-09-24/native-history-acceptance.md)
preserve exact commands, failures and historical matrices.

Final artifacts remain in the private acceptance directory:
`combined9-report-addendum.md`, `combined9-second-lifecycle.json`,
`combined9-settled-resource-summary.json`, `combined9-prefix-cost.json`,
`combined9-cancel-reopen-bottom.png`, `combined9-cancel-reopen-cache.json`,
`final-stop-stream.png`, `final-stop-cache.json`, `final-stop-user-confirmed.png`.
The last screenshot is the user's final visibility confirmation.
Credentials, native homes, caches, diagnostic builds and screenshots containing
private conversation data are not committed.

**Performance verdict: pass for the recorded bounded macOS acceptance; blocked
for complete provider/platform/large-history GUI/hours-long certification.**

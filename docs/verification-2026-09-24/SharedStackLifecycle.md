# Share Sessions lifecycle acceptance

Date: 2026-09-24. This run exercises #2142 (`3b4dfb77ca19`) integrated with #2139 (`e4e0bd416224`), plus the cold-reopen fixes described below. These are two isolated macOS debug desktops on one physical computer, not two physical machines. Cloud writes are confined to a disposable test organization; production fleet queries are read-only. Background LLM work is disabled in the harness. The current run does not establish a full production performance or provider-lifecycle pass.

## Original transcript consistency incident

The original diagnostic reports 164 items on both sides and a mismatch in tool result 94: 11,890 versus 11,899 **Unicode characters**, not UTF-8 bytes. The original call ID and paired records could not be found in the inspected local session stores, native histories, or retained logs. No historical transcript was changed.

A controlled 164-item transcript was materialized through each of the real Codex and Claude native adapters. Result 94 contains opaque JSON-like text, Unicode, escaped newlines and misleading `output` / `session_id` / `Script failed` strings. Exact synchronization passed. Deliberately appending nine characters was rejected at item 94; retrying the original transcript succeeded. This verifies opaque-result fidelity and strict rejection/recovery at the native boundary. It is **not a reproduction or resolution of the original incident**. Semantic equality has not been weakened.

## Real provider calls

- Claude Sonnet 4.6: A read a controlled 12 KiB file and answered; B opened the shared body, continued with the real provider, wrote a file, and returned a relative Markdown link. Both users rendered and downloaded the same 27-byte snapshot. Overwriting the source retained the original snapshot on both sides. A's next real continuation recalled B's marker, appeared on B, and created zero owner outbox/snapshot records for B's inherited file. B's two path-alias receipts settled as uploaded and released their stored bytes.
- Luna: the UI selection and native launch metadata independently confirmed `gpt-5.6-luna` on two authorized account identities. Both requests returned provider usage-limit errors. The current native-login identity was also tried with the available `gpt-6-luna`; it returned the same quota block. No Luna answer or continuation was accepted. The displayed retry dates were September 27 and September 29. These rows are **BLOCKED by provider quota**, not product passes.

## Cold-reopen defects found

1. The generic imported-history window creates an assistant preview from the last answer. A matching cloud row was reconciled to this native twin while preserving `turnPreviewOnly` / `unloadedTurn`. Once actual body events arrived, grouping hid the preview and therefore the final answer and attachment link. Timeline reconciliation now uses the authenticated complete cloud event when its twin is an unloaded preview. Loaded twins and unrelated lazy previews retain their existing behavior.
2. Window construction retained the text but discarded inherited-source metadata. Before cloud hydration, clicking its file link could open an overwritten receiver-local file. The producing window boundary now preserves only bounded source identity and the materialization flag for user and assistant previews. File discovery and file opening share the same inherited-event classification. Until an exact authenticated origin is available, a click shows a five-second notice asking the reader to retry; it cannot read local disk or select an arbitrary path-only revision. Genuine local output keeps local navigation.

The source fix preserves lazy-loading bounds: previews contain at most 512 bytes of text plus an ellipsis, a boolean, and a source identifier capped at 256 bytes; body/tool arguments are not copied. It creates no new polling, cache, subscription, background worker, or provider-semantic field. Existing persisted native histories are reprojected on load; no cloud rewrite or destructive historical remediation is needed. Older clients still retain the cold-click defect until upgraded.

Regression evidence: the new timeline cases failed 3 times before the fix; unresolved-source interception failed 2 cases; the native preview provenance test failed at the producing boundary. After correction, 106 frontend tests in four suites and 7 native window tests passed. Typecheck, changed-file lint, formatting and dependency boundaries passed. Tests also retain genuine-local navigation and ensure a later local answer does not inherit an earlier answer's provenance.

## Cold startup, compaction and cache recovery

After rebuilding both native applications, each instance passed two cold boots with restored authentication, three explicitly drained sync passes, the latest shared answer and original attachment bytes. The early inherited-link path is exercised before exact cloud provenance arrives; the final run also asserts the retry notice stays readable for approximately five seconds. A test exposed an initial seconds/milliseconds error in that new notice, which was corrected before acceptance. Another earlier assertion observed an editor restored from a previous failed run; subsequent runs explicitly close that old test tab and assert its absence before clicking.

A real owner-side Claude `/compact` produced one raw provider `compact_boundary`. The next real continuation recalled the participant marker and rendered on the peer. The test root's cloud epoch changed once from 1 to 2 and event count increased from 11 to 17; the retained log identifies the compacted source's frozen-prefix transition from cursor 11 to source 0. No other existing row changed. This is an explained compaction rewrite, not a claim of zero rewrites.

The owner's projection cache was backed up and evicted using the production cache-delete command, while its native transcript and code-session source remained intact. Body and attachment recovery then succeeded after restart. This is a **projection-cache eviction cell**, not a wipe of every imported-history database. Subsequent unchanged-state boots keep the post-compaction epoch constant. The repeated cold checks do not replace physical two-machine or complete provider rotation/deletion coverage.

Fleet ledger: 3,517 pre-existing rows remain unchanged; one owned test root was added; no rows disappeared and no out-of-test-org writes were observed. The 768 pre-existing high-epoch rows remain unchanged. The final inherited-artifact audit still shows zero owner snapshot/outbox records, two uploaded peer path-alias receipts with released bytes, and no pending peer outbox records.

Earlier native logs inherited `RUST_LOG=warn` and cannot prove an INFO-level effect audit. The patched cold boots explicitly use INFO logging. The only later destructive-effect match is the explained compaction rewrite; the two earlier terminal-gate warnings belong to the hidden peer execution, whose completed result separately reached the visible imported root. No watchdog fire or forced-idle recovery was observed in the available records. Earlier WARN-only startup periods remain a coverage limitation.

## Measured resource behavior

Sampling used `proc_pid_rusage` every two seconds and explicitly attributed the two native processes and their WebKit pools to isolated stores. CPU counters were converted from Mach ticks (125/3 ns per tick), not treated as nanoseconds. Unrelated desktop processes were excluded. Short sampling can miss peaks.

- Thirty-second visible / hidden / visible-return samples: combined native-plus-WebKit CPU averaged 2.69% / 3.94% / 2.56% of one core. Each native process averaged 0.03–0.10%. These are observations, not a complete idle-budget pass.
- Three 32 MiB captures and six production chunked reads preserved exact hashes after source overwrite and deletion. Three acknowledgments released all snapshot payloads. Native A RSS was 179.2 MiB initially, 190.8 MiB sampled peak, and 153.1 MiB after settling; physical footprint was 89.8 / 90.8 / 82.8 MiB. WebContent footprint was 666.4 / 964.3 / 528.7 MiB. The WebView transient cost still needs attribution and a product budget.
- Twenty-four rendered leave/reopen cycles (12 per desktop) preserved the latest answer and file link. Maximum observed reopen wait was 343 ms. Over the 80-second activity/settling interval, A/B native RSS went from 168.2/147.9 MiB to 158.7/135.0 MiB. A/B WebContent footprint went from 988.9/1162.7 MiB to 786.7/626.0 MiB; peak A footprint was 1032.5 MiB. This is no monotonic-growth finding in that short run, not proof against leaks or a pass for total desktop memory.

- Thirty seconds after closing both session views: combined native/WebKit CPU averaged 5.86%; this interval includes cold-start settling and is not a sustained-idle claim. Native A/B RSS fell from 196.0/199.1 MiB to 179.4/181.7 MiB. WebContent footprint fell from 667.5/550.3 MiB to 611.6/473.4 MiB. Resource retention and total production budgets remain unaccepted.

## Commands and evidence scope

Private scripts and raw evidence are retained under `/tmp/org2-shared-stack-desktop-r3`; raw auth, fleet data and native transcripts are not published. The one-off WebDriver holder only owns desktop setup/teardown and is not itself a passing functional spec.

```sh
pnpm exec vitest run --config config/vitest.config.ts \
  src/features/Org2Cloud/SharedSessionFilesContext.test.ts \
  src/features/Org2Cloud/sessionSharedFileCandidates.test.ts \
  src/features/Org2Cloud/SessionConversation/conversationTimeline.test.ts \
  src/engines/SessionCore/conversations/localConversationContinuation.test.ts
CARGO_BUILD_JOBS=2 cargo test --manifest-path src-tauri/Cargo.toml \
  -p orgtrack_core --lib sources::imported_history::window::tests -- --nocapture
pnpm run typecheck:fast
node scripts/quality/dependency-boundaries/check.mjs
node /tmp/org2-shared-stack-desktop-r3/consistency-164.mjs
node /tmp/org2-shared-stack-desktop-r3/bounded-io.mjs
node /tmp/org2-shared-stack-desktop-r3/reopen-cycles.mjs
node /tmp/org2-shared-stack-desktop-r3/cold-boots.mjs
node /tmp/org2-shared-stack-desktop-r3/consistency-restart.mjs
node /tmp/org2-shared-stack-desktop-r3/compact-owner.mjs
node /tmp/org2-shared-stack-desktop-r3/after-compact.mjs
node /tmp/org2-shared-stack-desktop-r3/cache-evict.mjs
```

Complete provider compact/rewrite/rotate/delete coverage in both directions, physical two-machine testing, Luna continuation, full upgrade/imported-cache-rebuild/network-fault cells and whole-app performance budgets remain separate obligations. Black/unreadable WebDriver screenshots are not accepted as visual evidence. No claim of complete root-cause resolution or full lifecycle acceptance is made.

## Teardown

Both current WebDriver sessions were explicitly closed, and the two native processes plus all six attributed WebKit processes were confirmed absent. The temporary frontend configuration was restored and the owned development server/driver processes stopped. The holder spec exited nonzero because its teardown still referenced the original, pre-restart WebDriver session IDs. That harness error is retained and is **not** reported as a green core E2E suite; the individual scripts above own the named functional assertions. Normal commit hooks subsequently passed TypeScript, scoped Rust clippy and staged lint checks.

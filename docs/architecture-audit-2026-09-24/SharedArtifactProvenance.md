# Shared artifact provenance

## Producing boundary and invariant

The provider-native transcript is execution history. Materializing another participant's history does not grant ownership of the files it mentions. Previously replay discovery re-read those paths on the owner's machine and uploaded them under the owner's identity. The mounted owner transcript also lacked remote-file interception, and imported viewers resolved only by path. Together these produced duplicate uploaders, ambiguity errors, and local-file navigation for guest output.

Artifact discovery now excludes canonical cloud projections and materialized native source rows before any filesystem read. Claude native replay and turn indexing preserve the materializer's existing `entrypoint: orgii` provenance as private `__orgiiMaterialized` metadata, including pending tool calls and their later results. This closes the provider-specific gap where Claude regenerated positional IDs instead of preserving Codex/Agent source-event IDs. Ordinary CLI user inputs, writes and assistant output remain unmarked. New local user references, writes and assistant Markdown/file links remain eligible. Canonical plane projection derives artifact uploader, root, revision and workspace from the authenticated row envelope/original payload. It replaces untrusted payload provenance and stamps native/local twins as well as plane-only rows. Per-event interception uses that origin on both imported and owner views. Missing parent scope remains intercepted and fails locally instead of falling through to disk. Genuine local owner output without inherited provenance retains local navigation.

The viewer uses the member exact-version RPC from cloud-infra migration 0035 and the capability-scoped guest RPC from migration 0036. The per-event provider preserves the mounted replay capability through lookup and byte download. It never falls back to a latest path match. Provider content and semantic-prefix checks are unchanged; the existing native projection excludes `__orgii` presentation metadata from tool arguments.

## Audit coverage

| Layer                     | Verdict | Evidence                                                                |
| ------------------------- | ------- | ----------------------------------------------------------------------- |
| 1 Compilation             | pass    | tsgo and changed-file ESLint                                            |
| 2 Ownership/deduplication | fix     | one candidate admission function used by replay and continuation outbox |
| 3 Naming                  | keep    | artifact origin differs explicitly from native source-event identity    |
| 4 Semantics               | fix     | native replay is not local file production                              |
| 5 Defaults                | fix     | missing exact version/scope never selects another file or local disk    |
| 6 Boundaries              | keep    | Markdown remains a leaf; ChatPanel composes existing feature provider   |
| 7 Readability             | keep    | original revision documented beside authenticated stamping              |
| 8 Wire                    | fix     | explicit org/root/path/uploader/revision RPC, no canonical text rewrite |
| 9 Entry parity            | fix     | imported, original owner, and native/local plane twins share origin     |
| 10 Resolution             | fix     | exact read and writer revision identity agree; legacy lookup unchanged  |

No action controls, styles or form fields were added. A UI consistency audit is not applicable to these control-flow changes; rendered tests cover interception. No historical files were deleted. Existing duplicates remain addressable by exact origin.

## Performance and verification

| Area            | Verdict | Evidence                              | Change or reason kept                                  | Verification                                                 |
| --------------- | ------- | ------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------ |
| Background work | fix     | replay candidate discovery            | reject inherited rows before file reads                | discovery and outbox tests                                   |
| Memory          | keep    | mounted provider state                | no extra cache/backlog; lazy viewer owns selected file | provider/viewer lifecycle tests                              |
| Scope/isolation | fix     | event origin plus parent endpoint/org | no local fallback on missing scope                     | owner/imported/missing-scope tests, ACL SQL tests            |
| Rendering       | keep    | event-scoped context, memo comparison | compare origin and workspace changes                   | rendered provider tests; real Tauri performance not measured |

Executed: targeted Vitest discovery, plane projection/timeline, canonical timeline, file outbox/delivery, viewer, interception, wire-client and native materializer suites; `tsgo --noEmit --pretty false`; changed-file ESLint; dependency boundary check (0 new forbidden edges); `git diff --check`.

Limitations: migrations 0035 and 0036 must precede rollout; both are now deployed. Pre-plane legacy links still lack event-level provenance; existing path-only rules apply there. Older revisions that were never captured remain unavailable rather than returning newer bytes. Handoff snapshots do not reconstruct historical event-time bytes. The server dependencies are deployed and real HTTP/JWT acceptance passed. No destructive remediation, complete lifecycle acceptance, or physical two-machine run was completed for this patch. See the current SharedStackIntegration verification record. Earlier live acceptance remains a recorded failure until repeated on the integrated build.

Performance verdict: blocked for the complete lifecycle/resource matrix; focused real bilateral Claude continuation and immutable preview checks now pass as recorded in SharedStackIntegration.md.

## Claude producing-boundary verification

A raw JSONL fixture exercises inherited user file references, assistant links, successful writes, a pending inherited call, and genuinely new CLI output in the same transcript. Full replay, turn index, window expansion and repeated reads preserve the admission distinction without rewriting provider bytes. Candidate tests reject these inherited rows while retaining new local output; existing native projection tests prove private arguments do not leak into model tool semantics.

The 11-suite frontend regression run passed 135 tests. After the Claude parser correction, the focused candidate/materializer rerun passed 42 tests and TypeScript/ESLint checks passed. That earlier parser-only pass did not run live Claude. A later isolated ambient-Claude run is recorded in SharedStackIntegration.md. Previously persisted duplicates are left intact; the exact-origin RPC resolves known versions without destructive cleanup.

`cargo test --manifest-path src-tauri/Cargo.toml -p orgtrack_core --lib sources::claude_code -- --nocapture` — 56 passed, 1 pre-existing ignored filesystem-discovery test. `cargo clippy --manifest-path src-tauri/Cargo.toml -p orgtrack_core --all-targets -- -D warnings` — passed.

## Execution-workspace publication boundary

A real shared Claude continuation uploaded an absolute Write path, but its final relative Markdown link had no receipt. The settled tail lacked `repoPath`; both candidate discovery and remote resolution therefore lacked the sender directory. `finishConversationTurn` now binds unscoped, newly produced output to the persisted execution workspace before publication. CLI worktree paths take precedence over repository paths; native agents use their persisted workspace. New, reused and crash-recovered turns converge at this boundary. Composer selections and receiver directories are never used as substitutes.

Existing event scopes and inherited cloud/materialized origins are retained. The helper copies only presentation metadata and leaves native messages/tool results untouched. Unavailable historical scope remains unavailable; no old cloud rows are rewritten. A metadata read error propagates to the durable accepted-turn recovery path rather than launching the provider again.

| Area               | Verdict | Evidence                                                                      | Change or reason kept                                                 | Verification                                                                     |
| ------------------ | ------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Background work    | keep    | One persisted-row read at terminal settlement, only for unscoped fresh output | No timer, scan, subscription or per-event IPC                         | Regression asserts the single read occurs after terminal wait                    |
| Memory             | keep    | One mapped turn tail, unchanged event payload references                      | No retained cache or additional queue                                 | Source inspection and mutation test                                              |
| Scope/isolation    | fix     | Persisted sending execution owns workspace                                    | Preserve original event/inherited scope; never use receiver workspace | Worktree, native agent, recovery, inheritance and missing-row/read-failure tests |
| Rendering/hot path | keep    | No rendering changes                                                          | Existing exact-version viewer consumes event scope                    | Publish/candidate/receiver resolution regression                                 |

Architecture layers 1–10 were checked for this focused change: compilation, shared ownership, naming, presentation-vs-provider semantics, missing-path defaults, core/feature boundary, documented provenance, additive existing wire field, new/reuse/recovery parity, and sender/receiver path resolution. No schema, credential selection, provider transcript, historical cleanup, or new UI control changes.

## Cold-reopen boundary audit

Real cold startup exposed a placeholder/cloud-twin collision and lost inherited provenance. The authoritative cloud answer remains complete; native lazy-window generation discarded source flags, and timeline reconciliation preferred the incomplete preview's presentation state. The producer now retains bounded provenance, timeline merge selects the full cloud answer for preview twins, and unresolved inherited links are intercepted with an explicit retry notice. Historical provider bytes and strict semantic-prefix comparisons remain unchanged; no cleanup or cloud rewrite is required.

Layers 1–10 were checked: targeted Rust/frontend tests and typecheck; a shared inherited-event predicate for upload/read admission; source identity versus exact artifact origin naming; presentation versus provider semantics; no receiver-local fallback; renderer leaf boundary; documented pending behavior; additive bounded existing IPC args; cold/full-history and owner/imported parity; exact uploader/revision resolution. No architecture layers were silently skipped. This is a focused control-flow bug fix, not a component redesign; no buttons, form controls or styling were introduced.

| Area            | Verdict | Evidence                                 | Change or reason kept                                   | Verification                                           |
| --------------- | ------- | ---------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------ |
| Background work | keep    | Projection and click boundaries only     | No new timer, listener, scan or worker                  | Call-chain inspection                                  |
| Memory          | fix     | Preview previously copied only text      | Retain only bounded source metadata, not full body args | Native window provenance/bounds regression             |
| Scope/isolation | fix     | Early click opened receiver-local bytes  | Intercept inherited links until exact origin resolves   | Red/green interception tests; desktop lifecycle record |
| Rendering       | fix     | Preview flags hid the final cloud answer | Prefer complete cloud event only for preview twins      | Three red/green timeline cases; cold-reopen record     |

Performance verdict remains incomplete for the whole application; measured native/WebKit figures and uncovered lifecycle cells are recorded in `docs/verification-2026-09-24/SharedStackLifecycle.md`.

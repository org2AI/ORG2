# PR #2103 necessity and architecture audit

Scope: the complete PR against its merge base with `develop`, reviewed again at
`56f9417a0d2c78befb66bcef6ca1ecf0cd6be147` and reduced in this audit.
The objective is raw native history handoff with deterministic last-write-wins,
not a general upstream compatibility monitoring service. PR #2110 is separate.

## Acceptance criteria and result

- Trace retained production additions from Configure, Open or the automatic
  history coordinator to a concrete invariant; tests alone do not establish use.
- Preserve raw sessions, tools, destination configuration, frozen fork ancestors
  and interruption recovery. Never delete persisted evidence to reduce code size.
- Remove monitoring/download/notification machinery and unnecessary full-bundle
  reads. Keep direct production/native regression entry points usable.
- Distinguish source checks, engine/CLI tests, desktop GUI acceptance and resource
  measurements. Unverified cells remain unverified.

**Scope verdict: reduced, with reasons for the retained groups below.** This is
not a claim of completed product acceptance or permission to merge.

## Claude follow-up: exit recovery and first use

The follow-up fixes two failure boundaries: a process exiting between kernel
identity reads no longer invalidates the entire Claude writer scan, and history
work waits for the in-process configuration mutex instead of treating a status
reader's lock as an ownership failure. Unknown live processes still fail closed;
configuration and owner identity are rechecked after waiting. Cross-process locks
remain nonblocking. The local mutex wait lasts until its current holder releases
it and cannot be cancelled mid-wait. No polling or retry service was added.

The fixed build passed two real metadata-only Open/Quit cycles: raw source and
target converged automatically after exit, without a Refresh or page switch.
The historical binary also passed one baseline cycle, so these observations do
not establish which race caused the original incident. Deterministic tests cover
both repaired boundaries. The follow-up Rust suites passed 412 tests with five
opt-in native tests ignored; Clippy passed.

A genuinely fresh managed profile initially displayed no history. After the first
native Quit, automatic import completed; the second Open displayed one expected
conversation. The cause is the ordering between vendor namespace registration
and the live-writer guard. The user chose to retain this minimal lifecycle:
**open once to initialize, quit Claude Desktop and Claude Code to allow import,
then reopen Claude Desktop to view history**. First-window history visibility is
not promised. The existing namespace and writer-wait messages now explain these
steps in all 15 locales. There is no automatic application termination/relaunch,
fabricated vendor namespace or relaxed writer guard.

The namespace regression additionally checks that registration while a writer is
live creates neither a target transcript nor a discovery row, then checks that
the post-exit import is idempotent. This extends the owning-boundary fixture;
it does not substitute for the first-use product flow.

The new isolated instance95 passed the selected product flow through normal
Configure/Open actions with official Claude 2.7032.0: the first-use and exit/reopen
messages rendered in full, first Quit imported byte-identical raw history without
Refresh or navigation, and the second Open showed one conversation with all six
source messages in order. The final Quit retained the same raw bytes and journal
without duplication. No new prompt was sent. A fresh-login catalog-load failure
required restarting ORG2 before profile creation; that separate issue remains.

Follow-up verification: `cargo test --manifest-path src-tauri/Cargo.toml -p org2
--lib --locked market_connection::claude_history::namespace_tests:: --
--test-threads=1` passed both tests. `pnpm test
src/modules/MainApp/Settings/sections/HarnessConnections/AppConnectionPage.test.ts
src/modules/MainApp/Settings/sections/HarnessConnections/historyStatus.test.ts`
passed 24 tests. `pnpm check:i18n-keys`, `pnpm check:i18n:quality`, the frontend and
instance95 product builds, and `git diff --check` passed. English dark-mode
screenshots cover the new pending and writer-wait copy; light mode, narrow window
and other locale screenshots were not captured. Existing format differences in
the namespace test's unrelated timeout assertion were left unchanged.

Architecture coverage for this follow-up: layers 1–7 cover compilation, the
shared configuration lock, process classification and their failure semantics;
layer 8 preserves existing IPC reason codes and native file formats; layer 9
covers first-use registration versus reopen; layer 10 preserves the same
vendor-owned account/project resolver. No React component or action control was
changed. The full performance verdict remains blocked on the resource matrix
and new-message/provider-accounting evidence described below.

## Remove / simplify / keep decisions

| Group                                   | Verdict     | Necessity and consequence                                                                                                                                                                                                                                                                                                              |
| --------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dedicated Claude/Codex workflows        | remove      | Scheduled/PR latest-release downloads and issue notifications are independent monitoring. Delete both workflows, including their older weekly baseline; ordinary build/test/security/PR-policy CI is unchanged.                                                                                                                        |
| CI drivers and driver-only tests        | remove      | Release manifests, checksum/download orchestration and report classification no longer have a caller. Delete both drivers and their tests. No automated upstream drift warning remains.                                                                                                                                                |
| Python subprocess support               | simplify    | Move only bounded process-group execution and its eight lifecycle tests next to the Claude fixture. Delete wrapper-only source-commit/SHA helpers and the repo-root import-path workaround.                                                                                                                                            |
| App installation fingerprint            | simplify    | Full executable/archive/signature-file SHA is only used by process-local bindings/model caches. Replace it with a local inspection generation, cached while all stamps match. Retain inode/device/ctime/mtime/length checks, containing-directory checks and process-start fencing. No persisted format changes.                       |
| Launch result                           | simplify    | Keep the verified binding inside launch/activation; stop exposing an unused successful binding to the sole caller.                                                                                                                                                                                                                     |
| Claude raw storage and receipts         | keep        | The authoritative source is vendor JSONL plus registered catalog/namespace. The old message projection could reject or discard ordinary vendor fields. Whole raw publication, independent accepted hashes and stable write clocks fix the producing boundary. Receipts suppress self-copy loops.                                       |
| Claude scan/namespace coordinator       | keep        | A fabricated directory is not vendor registration. Complete bounded catalog scans avoid treating an incomplete inventory as an empty recent window; writer/owner checks guard transcript and catalog writes. Shared Open/background coordination prevents competing import paths.                                                      |
| Codex revision and SQL adapter          | keep        | Authoritative data spans rollout files and native SQL projections. Stable raw/metadata revisions choose the winner; dynamic compatible columns preserve opaque data. Necessary keys, triggers, relationships and source/target contracts still gate writes. SQL quoting and bound values avoid executing native data as arbitrary SQL. |
| Codex recovery and retained generations | keep        | File rename and SQLite publication cannot be one atomic transaction. Durable pending snapshots repair interrupted publication. A frozen child can read a parent without its writer lock, so overwriting that physical ancestor is unsafe; retain it and publish a new physical identity. No automatic ancestor sweep.                  |
| Old receipt/journal/snapshot readers    | keep        | These read persisted evidence, not dead feature branches. Removing them would strand or misclassify existing operations. Ambiguous state pauses with artifacts intact.                                                                                                                                                                 |
| Native process/profile binding          | keep        | Before a write, verify the actual GUI/core and managed profile. A matching executable path alone cannot prove an already running image matches an updated installation. Environment/argument checks prevent primary-profile or inherited-route leakage.                                                                                |
| Catalog/default route/bootstrap         | keep        | Select the actual bundled runtime; discover models/defaults through bounded offline native calls. Never guess a return model or borrow the package's provider. Cold SQL schema remains vendor-owned; record ownership before thread/start so a lost reply cannot authorize duplicate creation or deletion of unrelated history.        |
| Connection/authentication plumbing      | keep        | Configure/Open and background work must share the installation and owner fences. Numbered/development callback schemes make the same product flow usable in isolated instances; exact compiled callback ownership is still checked. This supports native acceptance without bypassing Market authorization.                            |
| UI status, event scope and 15 locales   | keep        | Show Claude as well as Codex pause/pending state and disclose destructive LWW semantics. Use public reason codes instead of private path-bearing errors; target-scoped events avoid refreshing unrelated/hidden connection pages. These are behavior/status changes, not a layout redesign.                                            |
| Regression tests and native fixtures    | keep        | Exercise producing boundaries, migration, cancellation, SQL opacity, writer locks, tools and native continuation. They replace evidence for removed projection semantics rather than adding a second production engine.                                                                                                                |
| Design/compatibility/retention docs     | keep/update | Define write ordering, irreversible overwrite and fork retention; replace obsolete CI instructions with direct fixture commands and disclose outstanding acceptance.                                                                                                                                                                   |
| Dependency changes                      | keep        | `agent_cli` UUID creates fresh physical rollout IDs; macOS `toml` reads effective runtime/profile settings. Both use existing workspace versions; the lockfile only adds the package dependency edge.                                                                                                                                  |

Historical data remediation: none performed. Existing user history, backups,
transaction journals and frozen ancestors are not deleted by this audit. To roll
back LWW after it has run, stop synchronization first and preserve the files and
journals; use a reader that understands Claude receipt v3 and Codex journal v4 /
snapshot v2. A source-code revert cannot recover already overwritten unique text.

## Ten architecture layers

| Layer                     | Coverage and result                                                                                                                                                                                                    |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 Compilation             | Local Rust check/tests and changed-source formatting; current results below. Cross-platform CI belongs to the published revision.                                                                                      |
| 2 Dead code / duplication | Removed independent CI wrappers and unused helper APIs. Kept migration readers and distinct metadata-vs-action boundaries.                                                                                             |
| 3 Naming                  | Local installation generation is explicitly process-local; raw revision hashes remain content identities. Logical session ID and physical rollout ID stay distinct.                                                    |
| 4 Semantic overloading    | Separate version diagnostics, action capability checks, raw write time, publication receipts and GUI/CLI evidence.                                                                                                     |
| 5 Defaults                | Explicit target route wins; native default must match provider. Unknown route/namespace pauses instead of guessing. Exact LWW timestamp tie favors primary.                                                            |
| 6 Domain boundaries       | Native source storage is authoritative; display parser and UI filters do not define admissible history. Destination credentials/configuration remain local.                                                            |
| 7 Discoverability         | One operation resolver, named raw/storage modules, shared history status and direct native fixture instructions. Removed monitoring-only entry points.                                                                 |
| 8 Wire / serialization    | Read legacy evidence, write current receipt formats; opaque native columns retained; actual incompatible contracts pause. Event target/reason mapping checked across Rust/TS.                                          |
| 9 Initialization parity   | Cold target uses vendor bootstrap with durable ownership; existing target uses the same route/profile fences. Claude first use explicitly requires initialization, exit and reopen; no first-window history guarantee. |
| 10 Resolver symmetry      | Both handoff directions use destination config and independent revision receipts. Primary default probe uses a disposable home, never the primary account.                                                             |

No layer was omitted from the source audit. Non-macOS native execution and full
product/performance acceptance were not exercised here. Frontend layout refactoring,
React runtime optimization and rendered E2E edits are not part of this reduction;
their methodology sweeps were not invoked. The existing changed TSX uses shared
controls; this reduction introduces no production UI controls or native inputs.

## Lifecycle and performance

| Area            | Source-level assessment                                                                                                              | Evidence / limit                                                                             |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Background work | Owner-scoped watchers and bounded dirty sets; no new timer added. Dedicated scheduled CI removed.                                    | Code review and coordinator regressions; complete idle measurement pending.                  |
| Memory / I/O    | Removed full-bundle reads; resolver retains two cache slots. Raw captures, catalogs, probes and retained generations remain bounded. | Stamp/replacement tests and storage budget tests; no measured total-product speedup claimed. |
| Isolation       | Owner/config/runtime generations checked at publication; unknown writers preserve pending work.                                      | Revocation, runtime replacement and profile tests.                                           |
| Rendering       | Status reads return snapshots; event target scopes refresh.                                                                          | Existing frontend tests; no new UI layout in this audit.                                     |

| State / transition                    | Expected invariant                                                     | Remaining evidence                                                                                                      |
| ------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Disabled / signed out / retired owner | Release service and reject stale writes                                | Unit coverage; full account-switch product run pending                                                                  |
| Visible idle / hidden idle            | No periodic history scanning without pending work                      | Full CPU/RAM/I/O observations pending                                                                                   |
| Active native writer                  | Read only completed stable source; never overwrite loaded destination  | Engine/native fixture coverage; GUI concurrency pending                                                                 |
| Writer exit / namespace created       | Wake queued work from native invalidation                              | Two metadata-only exit cycles passed; fresh-profile exit/import/reopen passed; original incident cause remains unproven |
| Update / provider switch / revocation | Invalidate runtime/config binding before commit                        | Source-boundary regression coverage; live App update matrix pending                                                     |
| Failure / crash / repeated open-close | Bound work, retain unknown pending transaction, avoid duplicate writer | Recovery/launch tests; full repeated GUI lifecycle pending                                                              |

The Codex coordinator restores dirty work when a reconciliation call returns a
transient `busy` / `already synchronizing` error, then uses the existing 750 ms
coalescing delay before retrying that pending invalidation. A per-thread busy
count returned in a successful report is different: it waits for a relevant
invalidation and does not itself request another timed pass. Persistent transient
errors can therefore retry, while a loaded writer requires a release event or
explicit invalidation. Neither behavior establishes the persistent-contention
idle case without measurement.

**Performance verdict: blocked.** Source bounds and lifecycle tests cannot replace
the missing visible/hidden/active resource measurements and real account/provider
transitions. This audit removes a known unnecessary read path but does not certify
overall product performance.

## Provider acceptance and verification

| Provider | Engine / native core                                                                                                                    | Desktop product acceptance                                                                                                                                           |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude   | Historical implementation `05a87eec871`: 21 raw handoffs and 21 CLI resumes, destination config preserved, completed tools not replayed | Two exit/writeback cycles passed; fresh initialization/exit/reopen passed with one conversation and all six source messages; first-window visibility is not promised |
| Codex    | Historical implementation `05a87eec871`: five engine/core cases, seven LWW checks, frozen forks/cold target/live writers                | Not passed: native GUI control was refused; no Configure/Open/continue/writeback/reopen claim                                                                        |
| Both     | Local audit revision checks listed below                                                                                                | Paid provider/SJC accounting and full resource matrix unverified                                                                                                     |

Historical CI/native results are not current-head GUI evidence. This audit does
not change raw-storage semantics; it does change the installation cache path and
relocates the fixture process helper, which require their own regression runs.

Audit-revision checks (macOS; test binaries built from this checkout):

- `node scripts/tauri/prepare-sidecars.cjs --profile debug` and
  `cargo check --manifest-path src-tauri/Cargo.toml -p org2 -p agent_cli --lib --locked`: passed.
- `cargo test --manifest-path src-tauri/Cargo.toml -p org2 -p agent_cli --lib --locked --no-run --message-format=json`: passed. The Cargo-reported test executables then ran these exact filter/argument sets:
  - `agent_cli`: `managed_config::native_app::codex_history --test-threads=1`: 70 passed.
  - `app_lib`: `market_connection:: --test-threads=1`: 154 passed, including same-length rewrite with restored mtime and staged installation replacement.
  - `app_lib`: `agent_sessions::cli::native_materializer:: --test-threads=1`: 99 passed / 5 opt-in ignored.
  - `app_lib`: `agent_sessions::cli::parsers::codex_app_server:: --test-threads=1`: 60 passed / 5 opt-in ignored.
- `python3 src-tauri/src/agent_sessions/cli/native_materializer/claude_history_handoff/offline_process.test.py`: 8 passed; importing `offline_fixture_capture` from its own directory also passed.
- `pnpm test` with `AppConnectionPage.test.ts`, `historyStatus.test.ts`, `useHarnessConnection.test.ts`, `appScheme.test.ts`, `accountConnection.test.ts`, `backgroundAuthorization.test.ts`, `rpc.auth.test.ts`: 7 files / 90 tests passed.
- `pnpm exec tsgo --noEmit --pretty false`: passed.
- `rustfmt --edition 2021 --config skip_children=true --check` on the two modified Rust files: passed. The exploratory whole-workspace `cargo fmt --all -- --check` reports pre-existing formatting differences; unrelated files were not reformatted.
- `git diff --check`, deleted-helper reference check, and added-line private-path/secret-pattern inspection: passed. The only retained old driver paths are explicitly marked removed in this inventory.
- Latest `develop` fetched; merge-tree integration check is clean. No unrelated base merge or history rewrite is needed.

- `cargo clippy --manifest-path src-tauri/Cargo.toml -p org2 -p agent_cli --lib --tests --locked -- -D warnings`: passed.

- `cargo test --manifest-path src-tauri/Cargo.toml -p market-connect --lib --locked environment:: -- --test-threads=1`: 3 passed, including exact callback ownership.

The vendor CLI/core fixtures were not rerun for this reduction: raw engine and
fixture behavior are unchanged, and the relocated helper has direct lifecycle
and import coverage. Historical native results are identified separately above;
GUI/resource/provider acceptance remains unverified.

## Changed-file scope inventory

Every path in the audited PR is assigned below. `keep` includes focused updates
explained by its group; `remove` means the file is absent in the final tree.
New driver-only files deleted during reduction disappear from the PR diff and are
recorded in the removal table above rather than listed as retained additions.

| Path                                                                                                             | + / − vs base | Verdict  | Group                         |
| ---------------------------------------------------------------------------------------------------------------- | ------------: | -------- | ----------------------------- |
| `.github/workflows/claude-history-canary.yml`                                                                    |        0 / 66 | remove   | 监控 CI / 下载器              |
| `.github/workflows/codex-history-canary.yml`                                                                     |        0 / 70 | remove   | 监控 CI / 下载器              |
| `docs/architecture-audit-2026-09-23/native-history-compatibility.md`                                             |       238 / 0 | keep     | 行为契约 / 验证说明           |
| `docs/design/codex-history-retention.md`                                                                         |        58 / 0 | keep     | 行为契约 / 验证说明           |
| `docs/design/native-history-last-write-wins.zh-CN.md`                                                            |       135 / 0 | keep     | 行为契约 / 验证说明           |
| `docs/native-history-compatibility.md`                                                                           |       146 / 0 | keep     | 行为契约 / 验证说明           |
| `scripts/ci/claude-history-canary.py`                                                                            |       0 / 191 | remove   | 监控 CI / 下载器              |
| `scripts/ci/codex-history-canary.py`                                                                             |       0 / 163 | remove   | 监控 CI / 下载器              |
| `src-tauri/Cargo.lock`                                                                                           |         1 / 0 | keep     | 现有 workspace 依赖边         |
| `src-tauri/Cargo.toml`                                                                                           |         1 / 0 | keep     | 现有 workspace 依赖边         |
| `src-tauri/crates/agent-cli/Cargo.toml`                                                                          |         1 / 0 | keep     | 现有 workspace 依赖边         |
| `src-tauri/crates/agent-cli/examples/codex_history_native_probe.py`                                              |       161 / 9 | keep     | 生产引擎原生回归入口          |
| `src-tauri/crates/agent-cli/examples/codex_history_probe.rs`                                                     |         2 / 0 | keep     | 生产引擎原生回归入口          |
| `src-tauri/crates/agent-cli/src/managed_config/native_app/codex_history.rs`                                      |     810 / 162 | keep     | Codex 原文、SQL、分叉与恢复   |
| `src-tauri/crates/agent-cli/src/managed_config/native_app/codex_history/files.rs`                                |       42 / 52 | keep     | Codex 原文、SQL、分叉与恢复   |
| `src-tauri/crates/agent-cli/src/managed_config/native_app/codex_history/revision.rs`                             |       229 / 0 | keep     | Codex 原文、SQL、分叉与恢复   |
| `src-tauri/crates/agent-cli/src/managed_config/native_app/codex_history/routing.rs`                              |       3 / 162 | keep     | Codex 原文、SQL、分叉与恢复   |
| `src-tauri/crates/agent-cli/src/managed_config/native_app/codex_history/store.rs`                                |      256 / 61 | keep     | Codex 原文、SQL、分叉与恢复   |
| `src-tauri/crates/agent-cli/src/managed_config/native_app/codex_history/store/schema.rs`                         |     236 / 119 | keep     | Codex 原文、SQL、分叉与恢复   |
| `src-tauri/crates/agent-cli/src/managed_config/native_app/codex_history/store/snapshot.rs`                       |      176 / 38 | keep     | Codex 原文、SQL、分叉与恢复   |
| `src-tauri/crates/agent-cli/src/managed_config/native_app/codex_history/store/tests.rs`                          |      423 / 21 | keep     | Codex 原文、SQL、分叉与恢复   |
| `src-tauri/crates/agent-cli/src/managed_config/native_app/codex_history/tests.rs`                                |     243 / 122 | keep     | Codex 原文、SQL、分叉与恢复   |
| `src-tauri/crates/agent-cli/src/managed_config/native_app/codex_history/tests/last_write_wins.rs`                |       639 / 0 | keep     | Codex 原文、SQL、分叉与恢复   |
| `src-tauri/crates/agent-cli/src/managed_config/native_app/codex_history/tests/retained_generation.rs`            |       168 / 0 | keep     | Codex 原文、SQL、分叉与恢复   |
| `src-tauri/crates/market-connect/src/environment.rs`                                                             |        73 / 2 | keep     | 隔离实例的正常授权回调        |
| `src-tauri/src/agent_sessions/cli/native_materializer.rs`                                                        |      123 / 57 | keep     | Claude 原文、注册、扫描与回归 |
| `src-tauri/src/agent_sessions/cli/native_materializer/claude_catalog_scan.rs`                                    |       214 / 0 | keep     | Claude 原文、注册、扫描与回归 |
| `src-tauri/src/agent_sessions/cli/native_materializer/claude_history_handoff/automatic.rs`                       |       27 / 51 | keep     | Claude 原文、注册、扫描与回归 |
| `src-tauri/src/agent_sessions/cli/native_materializer/claude_history_handoff/mod.rs`                             |      20 / 152 | keep     | Claude 原文、注册、扫描与回归 |
| `src-tauri/src/agent_sessions/cli/native_materializer/claude_history_handoff/native_canary.rs`                   |       186 / 0 | keep     | Claude 原文、注册、扫描与回归 |
| `src-tauri/src/agent_sessions/cli/native_materializer/claude_history_handoff/offline_completed_tools_fixture.py` |       19 / 19 | keep     | Claude 原文、注册、扫描与回归 |
| `src-tauri/src/agent_sessions/cli/native_materializer/claude_history_handoff/offline_fixture_capture.py`         |       130 / 0 | simplify | Claude 原文、注册、扫描与回归 |
| `src-tauri/src/agent_sessions/cli/native_materializer/claude_history_handoff/offline_process.py`                 |        77 / 0 | simplify | Claude 原文、注册、扫描与回归 |
| `src-tauri/src/agent_sessions/cli/native_materializer/claude_history_handoff/offline_process.test.py`            |       155 / 0 | simplify | Claude 原文、注册、扫描与回归 |
| `src-tauri/src/agent_sessions/cli/native_materializer/claude_history_handoff/offline_resume_fixture.py`          |       68 / 66 | keep     | Claude 原文、注册、扫描与回归 |
| `src-tauri/src/agent_sessions/cli/native_materializer/claude_history_handoff/records.rs`                         |      56 / 687 | keep     | Claude 原文、注册、扫描与回归 |
| `src-tauri/src/agent_sessions/cli/native_materializer/claude_history_handoff/storage.rs`                         |     700 / 544 | keep     | Claude 原文、注册、扫描与回归 |
| `src-tauri/src/agent_sessions/cli/native_materializer/claude_history_handoff/tests.rs`                           |    636 / 1497 | keep     | Claude 原文、注册、扫描与回归 |
| `src-tauri/src/agent_sessions/cli/native_materializer/isolated_claude_history.rs`                                |     220 / 312 | keep     | Claude 原文、注册、扫描与回归 |
| `src-tauri/src/agent_sessions/cli/native_materializer/isolated_claude_history/namespace.rs`                      |       311 / 0 | keep     | Claude 原文、注册、扫描与回归 |
| `src-tauri/src/agent_sessions/cli/native_store.rs`                                                               |        40 / 0 | keep     | 原子发布前后权限检查          |
| `src-tauri/src/agent_sessions/cli/parsers/codex_app_server.rs`                                                   |         5 / 1 | keep     | 原生目录、默认路由与冷启动    |
| `src-tauri/src/agent_sessions/cli/parsers/codex_app_server/catalog.rs`                                           |        41 / 2 | keep     | 原生目录、默认路由与冷启动    |
| `src-tauri/src/agent_sessions/cli/parsers/codex_app_server/catalog/default_route.rs`                             |       282 / 0 | keep     | 原生目录、默认路由与冷启动    |
| `src-tauri/src/agent_sessions/cli/parsers/codex_app_server/history_bootstrap.rs`                                 |     471 / 117 | keep     | 原生目录、默认路由与冷启动    |
| `src-tauri/src/harness_connections.rs`                                                                           |        9 / 19 | keep     | 产品调用链、owner 与状态      |
| `src-tauri/src/harness_connections/desktop.rs`                                                                   |       91 / 90 | keep     | 产品调用链、owner 与状态      |
| `src-tauri/src/market_connection.rs`                                                                             |        19 / 8 | keep     | 产品调用链、owner 与状态      |
| `src-tauri/src/market_connection/claude_history.rs`                                                              |      342 / 67 | keep     | 产品调用链、owner 与状态      |
| `src-tauri/src/market_connection/claude_history_namespace_tests.rs`                                              |       166 / 0 | keep     | 产品调用链、owner 与状态      |
| `src-tauri/src/market_connection/codex_history.rs`                                                               |     602 / 114 | keep     | 产品调用链、owner 与状态      |
| `src-tauri/src/market_connection/configure_catalog.rs`                                                           |       35 / 39 | keep     | 产品调用链、owner 与状态      |
| `src-tauri/src/market_connection/external_client.rs`                                                             |        16 / 5 | keep     | 产品调用链、owner 与状态      |
| `src-tauri/src/market_connection/history_status.rs`                                                              |        28 / 0 | keep     | 产品调用链、owner 与状态      |
| `src-tauri/src/market_connection/native_app_launch.rs`                                                           |      74 / 274 | keep     | 原生进程与目标 profile 绑定   |
| `src-tauri/src/market_connection/native_app_launch/account_home.rs`                                              |         5 / 1 | keep     | 原生进程与目标 profile 绑定   |
| `src-tauri/src/market_connection/native_app_launch/lifecycle.rs`                                                 |       84 / 39 | simplify | 原生进程与目标 profile 绑定   |
| `src-tauri/src/market_connection/native_app_launch/lifecycle_tests.rs`                                           |        74 / 1 | keep     | 原生进程与目标 profile 绑定   |
| `src-tauri/src/market_connection/native_app_launch/process.rs`                                                   |      247 / 38 | keep     | 原生进程与目标 profile 绑定   |
| `src-tauri/src/market_connection/native_app_launch/process_codex_runtime.rs`                                     |       383 / 0 | keep     | 原生进程与目标 profile 绑定   |
| `src-tauri/src/market_connection/native_app_launch/process_codex_runtime_tests.rs`                               |       210 / 0 | keep     | 原生进程与目标 profile 绑定   |
| `src-tauri/src/market_connection/native_app_launch/process_profile.rs`                                           |       225 / 0 | keep     | 原生进程与目标 profile 绑定   |
| `src-tauri/src/market_connection/native_app_launch/process_profile_tests.rs`                                     |       208 / 0 | keep     | 原生进程与目标 profile 绑定   |
| `src-tauri/src/market_connection/native_app_launch/process_tests.rs`                                             |       270 / 1 | keep     | 原生进程与目标 profile 绑定   |
| `src-tauri/src/market_connection/native_compatibility.rs`                                                        |       699 / 0 | simplify | 安装失效检查 / 原生模型目录   |
| `src-tauri/src/market_connection/native_compatibility/catalog.rs`                                                |       192 / 0 | keep     | 安装失效检查 / 原生模型目录   |
| `src/features/MarketConnect/accountConnection.test.ts`                                                           |        17 / 0 | keep     | 隔离实例的正常授权回调        |
| `src/features/MarketConnect/accountConnection.ts`                                                                |         2 / 1 | keep     | 隔离实例的正常授权回调        |
| `src/features/MarketConnect/appScheme.test.ts`                                                                   |        50 / 0 | keep     | 隔离实例的正常授权回调        |
| `src/features/MarketConnect/appScheme.ts`                                                                        |         9 / 0 | keep     | 隔离实例的正常授权回调        |
| `src/features/MarketConnect/backgroundAuthorization.test.ts`                                                     |        15 / 0 | keep     | 隔离实例的正常授权回调        |
| `src/features/MarketConnect/rpc.auth.test.ts`                                                                    |        14 / 0 | keep     | 隔离实例的正常授权回调        |
| `src/features/MarketConnect/rpc.ts`                                                                              |         2 / 1 | keep     | 隔离实例的正常授权回调        |
| `src/i18n/locales/de/settings.json`                                                                              |        14 / 3 | keep     | 覆盖语义与公开状态文案        |
| `src/i18n/locales/en/settings.json`                                                                              |        14 / 3 | keep     | 覆盖语义与公开状态文案        |
| `src/i18n/locales/es/settings.json`                                                                              |        14 / 3 | keep     | 覆盖语义与公开状态文案        |
| `src/i18n/locales/fr/settings.json`                                                                              |        14 / 3 | keep     | 覆盖语义与公开状态文案        |
| `src/i18n/locales/hi/settings.json`                                                                              |        14 / 3 | keep     | 覆盖语义与公开状态文案        |
| `src/i18n/locales/id/settings.json`                                                                              |        14 / 3 | keep     | 覆盖语义与公开状态文案        |
| `src/i18n/locales/ja/settings.json`                                                                              |        14 / 3 | keep     | 覆盖语义与公开状态文案        |
| `src/i18n/locales/ko/settings.json`                                                                              |        14 / 3 | keep     | 覆盖语义与公开状态文案        |
| `src/i18n/locales/pl/settings.json`                                                                              |        14 / 3 | keep     | 覆盖语义与公开状态文案        |
| `src/i18n/locales/pt/settings.json`                                                                              |        14 / 3 | keep     | 覆盖语义与公开状态文案        |
| `src/i18n/locales/ru/settings.json`                                                                              |        14 / 3 | keep     | 覆盖语义与公开状态文案        |
| `src/i18n/locales/tr/settings.json`                                                                              |        14 / 3 | keep     | 覆盖语义与公开状态文案        |
| `src/i18n/locales/vi/settings.json`                                                                              |        14 / 3 | keep     | 覆盖语义与公开状态文案        |
| `src/i18n/locales/zh-Hant/settings.json`                                                                         |        14 / 3 | keep     | 覆盖语义与公开状态文案        |
| `src/i18n/locales/zh/settings.json`                                                                              |        14 / 3 | keep     | 覆盖语义与公开状态文案        |
| `src/modules/MainApp/Settings/sections/HarnessConnections/AppConnectionPage.test.ts`                             |        81 / 6 | keep     | 状态展示与事件作用域          |
| `src/modules/MainApp/Settings/sections/HarnessConnections/AppConnectionPage.tsx`                                 |       19 / 15 | keep     | 状态展示与事件作用域          |
| `src/modules/MainApp/Settings/sections/HarnessConnections/historyStatus.test.ts`                                 |        27 / 0 | keep     | 状态展示与事件作用域          |
| `src/modules/MainApp/Settings/sections/HarnessConnections/historyStatus.ts`                                      |        22 / 0 | keep     | 状态展示与事件作用域          |
| `src/modules/MainApp/Settings/sections/HarnessConnections/useHarnessConnection.test.ts`                          |       254 / 0 | keep     | 状态展示与事件作用域          |
| `src/modules/MainApp/Settings/sections/HarnessConnections/useHarnessConnection.ts`                               |         4 / 4 | keep     | 状态展示与事件作用域          |

## Codex follow-up: runtime parameters, historical model routing and launch recovery

The official core's plugin boolean overrides are now parsed as dotted CLI keys
(including plugin IDs with `@` and `-`) plus typed TOML values. Only the known
non-routing keys and plugin enabled booleans are allowed; credentials, profile,
model and plugin command overrides remain rejected.

The AppSource compatibility rule applies only to Codex bare model names. Explicit
package aliases keep strict ownership; both Claude agents remain strict. Bare
names use the configured default package even in a multi-package catalog. This
is a declared compatibility policy, not proof of request provenance. A local HTTP
regression uses the real AppSource resolver and production proxy, with synthetic
remote credentials, to verify default fallback and explicit second-package
routing across body model, destination and credential together. It does not
prove live Market billing or a successful native canary.

Launch recovery persists the observed GUI PID/start time before binding checks,
then requires kernel evidence that the lifetime ended and a new profile scan
before redispatch. Unknown dispatches, unreadable/live identities, owner changes,
malformed records and concurrent Open remain protected. The existing bounded
startup loop is unchanged; there is no idle timer, new background scan or kill.
The reservation format/rollback boundary is documented in the compatibility guide.

Architecture coverage: layers 1–10 reviewed for these paths (compile, live call
chain, naming, model/alias distinction, fallback, cross-client scope, explicit
policy, HTTP wire tuple, startup parity, resolver consistency). No whole-repo
cleanup or performance claim is made.

| Area               | Verdict | Evidence                                                             | Change or reason kept                                 | Verification                                         |
| ------------------ | ------- | -------------------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------- |
| Background work    | keep    | Existing user-action startup loop only                               | No new polling service; exit check on explicit Open   | Lifecycle tests; GUI recovery pending                |
| Memory             | keep    | Reservation read capped at 257 bytes, stored state <=256             | One observed process, no growing registry             | Malformed/partial/oversized record coverage          |
| Scope/isolation    | fix     | Strict aliases and both Claude agents; profile lock and owner checks | Codex-only compatibility; persisted lifetime recovery | Resolver, real HTTP proxy and kernel/lifecycle tests |
| Rendering/hot path | keep    | No production React change in this follow-up                         | Existing #2110 remains separate                       | Not reverified here                                  |

Performance verdict: blocked — visible/hidden/repeated GUI cycles, successful
native continuation and remaining provider/resource matrix still require the
acceptance executor. A built candidate and automated checks are not full GUI
acceptance.

Automated follow-up verification (final local source):

- `cargo test --manifest-path src-tauri/Cargo.toml -p org2 -p agent_cli --lib --locked -- market_connection:: cli_managed_proxy:: managed_config:: agent_sessions::cli::native_materializer:: --test-threads=1`: 156 agent_cli + 281 app_lib passed; 5 explicit opt-in materializer tests ignored. Child test-process output is included in the parent coverage, not added again.
- Targeted runtime/catalog/proxy checks also passed during implementation; these overlap the final suites and are not additional unique coverage.
- The new local HTTP case checks the real compatibility policy and proxy path with two packages and distinct wire models/credentials; it does not contact Market.

## 2026-09-24 delivery and external supply acceptance

The follow-up source and Ready93 candidate were checked against the saved build
receipt before submission: all 29 file hashes and the executable hash matched.
The 437 passing tests (5 opt-in ignores), clean Clippy result and candidate
build therefore apply to this source; this documentation update does not imply
a new test execution. Latest `develop` was fetched and merge-tree checked without
conflicts. No target-branch code was incorporated into the tested candidate.

Claude H1 previously passed two normal-exit writeback rounds. The chosen H2
behavior is first-use initialization followed by quit/reopen, with a fresh
instance passing that workflow. These are recorded historical product results;
they do not replace a final-candidate full lifecycle/resource run.

The independent CPA reserve blocker was resolved in cloud-infra PR #148, now
merged. One real request through instance 93's existing package proxy completed
with upstream `gpt-reserve` while ordinary quota was denied: 343 input and 15
output tokens. Database receipt/ledger reads verified buyer charge 65, seller
payable 48 and platform revenue 17 micro-USD, with unused hold released. This
used the prior running desktop package and is **not** Ready93 native GUI C4,
cross-model pre-compaction acceptance or reservation recovery evidence. The
provider's integer reserve percentage remained 0; no percentage delta is claimed.

At that stage, remaining product acceptance was Ready93 C1–C6, C7–C14 and the visible/hidden/active/
repeated-open resource matrix. The old second-round C6 used manual lock cleanup
and cannot certify automatic reservation recovery. Do not clear a lock or call
a reconciliation helper to make product acceptance pass. Performance verdict
remains **blocked on the unexecuted runtime matrix**, not on reserve supply.

## 2026-09-24 C7 writer boundary correction

A real reverse continuation exposed a source fence mismatch: the account-scoped
native app-server kept its rollout FD and native thread lock open, while ORG2
published newer managed metadata over the indexed source path. The path received
a new inode while the producer still held the old one. The completed canary was
visible once in the GUI; no subsequent append or observed data loss is claimed.
That successful transfer did not make C7 a pass.

The producing boundary now fences the actual native store before app-server
spawn, independently of account `CODEX_HOME`. Native producers share this lock;
publication and pending recovery take it exclusively in addition to native
per-thread locks. The native child inherits the locked open-file description.
Teardown closes the parent's locked descriptor, then confirms exclusive
availability using a separate notification descriptor for the same inode before
updating its timestamp. Cancellation may drop the runner before native process
teardown. Only a busy release starts asynchronous 100 ms checks for up to ten
seconds on the existing Tokio runtime, so the final notification follows actual
inherited-descriptor release. No provider-wide kill ordering is changed.
Existing auth homes and native lock directories are neither moved nor deleted.

| Layer / boundary                                | Verdict          | Reason                                                                                         | Verification                                                                        |
| ----------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Owning writer boundary and native lock protocol | fix              | `sqlite_home` and account `CODEX_HOME` may differ                                              | Separate-home source/destination and pending-recovery regressions                   |
| Startup parity                                  | fix              | OwnKey, hosted and managed turns use the same final store and app-server spawn                 | Shared runner path, inherited-FD regression, fresh/resume routing review            |
| Contention defaults                             | fix              | A normal send must not fail on a millisecond engine probe                                      | Only `WouldBlock` waits asynchronously, at most ten seconds, during explicit launch |
| Lifecycle / cancellation                        | keep with reason | Child owns the fence even if parent drops; bounded release cleanup confirms final close        | Real child FD inheritance, deferred-release and timeout regressions                 |
| Source / destination symmetry                   | fix              | Loaded terminal source may export; loaded target must never be replaced                        | Exclusive target guard spans preparation, file/SQL publication and recovery         |
| Persistence / wire / identity                   | keep with reason | No auth, native schema, model route, journal format or account-generation migration            | Diff and resolver-path inspection                                                   |
| Background work                                 | keep with reason | Existing watcher observes release; bounded release-only cleanup, no idle timer or account scan | Event/coalescing call-chain inspection; final GUI resource matrix still required    |
| UI / React                                      | skipped          | No UI implementation changed in this correction                                                | Source diff                                                                         |

A producer conservatively delays writeback into other threads of the same store;
independent stores remain independent. Native command/exec did not inherit the
FD in the real probe, while stdio MCP did. Normal process-group teardown
terminates those MCP children, and release cleanup observes the resulting close; an orphan or a descendant that escapes the group can
conservatively retain the lock. If its final close exceeds the ten-second cleanup bound, or the runtime is absent
or shutting down, a later native event or explicit invalidation may be needed for
convergence. These are availability
limitations, not permission to replace a live writer's file. Old-build producers
must finish before the new fence protects their stores.

The initial 42-test engine run passed, as did two runner regressions and library
Clippy. Fence93 proved the production spawn holds the actual store lock; its
product request hit ordinary quota exhaustion. Two protocol reserve replies kept
the live inode stable, but exposed an overly strict historical status check:
old failed turns prevented exporting an otherwise completely projected live
snapshot. The adapter now accepts exactly the native terminal states completed,
failed and interrupted while rejecting active/unknown states and projection lag.
The full history suite passed 76 tests, including a live-store boundary regression,
and agent_cli test Clippy passed. No historical data cleanup was performed.

Fence93 predates that terminal-state fix. It converged automatically after source
EOF, but did not pass C7 while the source was live. A separate final review found normal Stop releases its parent guard before child
process-tree teardown. Release cleanup now confirms actual final close rather
than announcing the earlier parent drop; a two-child regression and bounded-timeout
regression cover that ordering. The final complete history suite passed 78 tests
and test Clippy passed. Final runtime and complete performance acceptance remain pending; see the
[acceptance report](../org2-performance-guard-2026-09-24/native-history-acceptance.md).

## 2026-09-24 authoritative Codex generation lookup

Combined93 used local-only merge `b9056d6abaf196ed4c3576bfa30d5cf4b798aaea`
(#2103 `4a29a30d` plus #2143 `a02d3da4` for Reserve selection). A real product
250-line reply completed while the target exited; the writer fence kept the
source FD attached, and current raw/index/journal stores converged automatically.
ORG2 nevertheless reloaded the earlier two-turn transcript and entered recovery.
The SQLite current generation contained the reply; an older retained file with
the same canonical header did not. No native data was lost in this observation.

The earliest invalid authority decision was `existing_codex_native_paths`: its
cache trusted file existence and its cold fallback selected a filename suffix.
LWW deliberately retains previous physical generations, so existence cannot
prove the canonical thread still selects that path. Transcript reconciliation
then replaced the frontend projection with the old file's valid but stale data.

| Layer / boundary                    | Verdict          | Reason                                                                                     | Verification                                                                          |
| ----------------------------------- | ---------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| Domain authority / reader ownership | fix              | Native SQLite chooses the current rollout generation                                       | Indexed resolver used by managed reads, revision checks and materialization           |
| Hidden defaults / error handling    | fix              | Unreadable or invalid indexed state must not fall through to an older cache/profile file   | Owning transcript/history boundary propagates resolution failure                      |
| Cold/warm parity                    | fix              | A retained old file previously survived both cache validation and cold suffix discovery    | Remove existence-only path cache; reselect current indexed path                       |
| Legacy compatibility                | keep with reason | Pre-index stores still need discovery, with no authoritative row to distinguish duplicates | Bounded discovery rejects ambiguous matching files                                    |
| Persistence / recovery              | keep with reason | Previous generations are valid recovery material, not malformed records                    | No deletion, schema migration, auth change or manual repair                           |
| Background/resource behavior        | keep with reason | Resolution occurs at explicit history/continuation boundaries                              | No new poller, scan subscription or retained cache; runtime matrix remains incomplete |
| React / UI / API wire               | skipped          | Correction changes the backend source selection and error boundary                         | No UI filters, retry masks or control/layout changes                                  |

Source regressions pass; a rebuilt combined runtime remains required after this
correction. The preceding Combined93 source safety/automatic export success does
not pass C7 continuation, Stop or the full performance matrix. Detailed measured
results and remaining acceptance cells are in the performance report.

Subsequent Combined2 (`88d60750`) rebuilt the correction and recovered the existing
answer without resending or changing native raw data. A real short continuation
and a bounded long reply completed against the current generation. Stop was not
exercised successfully: the empty composer exposed Send while an older failed
turn appeared at the tail; the bounded request completed naturally. This
separate control/projection observation is preserved without a UI workaround or
data cleanup. Configure later synchronized both replies; the rebuilt concurrent
loaded-target case and full lifecycle matrix remain pending. See the subsequent
Combined2 section of the acceptance report rather than treating the older
Combined93 failure as the current source result.

The subsequent user-selected loaded-target run passed the rebuilt concurrency
boundary: the real source retained its indexed inode across target SIGTERM,
completed 250 lines, and automatically published to the managed store in about
0.842 seconds. Source readback retained the new answer and settled to idle. A
separate actual product Stop then released its inherited fence and automatically
published the persisted interruption in about 0.833 seconds. Both stores'
indexed records/messages remained consistent with no pending journal work.
There was no visible partial assistant text before Stop, so live-rendering and
partial-text retention are unverified. Native final reopen/menu-exit and the
full performance matrix remain pending; signal exit required narrow cleanup of
a verified vendor helper orphan.

Final user inspection showed the latest completed reply and subsequent
cancellation request in order. Normal native Quit then released all 16 reopen
identities and all 23 identities observed by the bounded native sampler, with no
signal cleanup in that cycle. Both indexes, ordered messages and interruption
records remained consistent with zero pending journal work. The screenshot also
exposed the pre-existing producer's `orgii-turn-intent` correlation envelope in
native user input; this raw-data/presentation compatibility gap was not hidden
or destructively cleaned up. Full performance/lifecycle matrix coverage remains
incomplete despite the successful finite normal-exit check.

Indexed-generation correction verification:

```sh
cargo test --manifest-path src-tauri/Cargo.toml -p org2 --lib --locked native_transcript_resolution_tests
cargo test --manifest-path src-tauri/Cargo.toml -p org2 --lib --locked native_materializer
cargo test --manifest-path src-tauri/Cargo.toml -p org2 --lib --locked commands::history
cargo test --manifest-path src-tauri/Cargo.toml -p org2 --lib --locked transcript_revision_tests
cargo clippy --manifest-path src-tauri/Cargo.toml -p org2 --lib --tests --locked -- -D warnings
```

The four filters passed 5, 102, 8 and 6 tests respectively: **121 passed**, with
seven existing opt-in tests ignored (five materializer, two history). Clippy and
`git diff --check` passed. Owning-boundary regressions cover current-generation
selection after an earlier read, same-size/mtime revision changes, invalid or
locked indexes without stale fallback, managed/account symmetry and ambiguous
legacy discovery. This does not replace the pending rebuilt GUI run.

Removing the existence-only cache means each ordinary indexed resolution reads
one SQLite row on demand. Unindexed legacy homes use a bounded directory walk;
repeated legacy reads can cost more I/O than the old cached path. No new timer is
added, but a large-legacy-home runtime baseline has not been measured.

## Native user-message correlation correction

The screenshot's XML is authoritative persisted user content, produced by
`native_correlated_user_input` → `with_turn_intent` → `turn/start.input`.
The native renderer correctly shows that content; hiding a matching string in
ORG2 would not correct the producing boundary. The writer now keeps the input
literal and passes the bounded, namespaced intent through Codex's supported
`clientUserMessageId`. Both ordinary and context-recovery starts share this
construction. Native `client_id` is consumed at the current and legacy transcript
boundaries, preserving submit identity on replay without a second lookup store.

Source invariant: ORG2 must never inject its correlation envelope into newly
submitted user text. Owned malformed client IDs do not acquire a fallback
identity; absent/foreign metadata retains read-only legacy-envelope support.
The historical inventory is the already-recorded C7 source and managed raw
copies and their recovery artifacts. None are rewritten or deleted by this fix.
The old screenshot therefore remains valid evidence of the prior producer.

Architecture coverage: writer/reader wire contract, names/validation, dependency
direction, default/legacy behavior, shared fresh/resume/recovery initialization,
identity/dedupe and compilation. UI component design, schema migrations and
new background-resource ownership are inapplicable to this correction. No
frontend filtering, dependency, native database format or CI change is added.
Current installed-native protocol verification and remaining GUI/compatibility
limitations are recorded in the acceptance report.

## Fresh Codex split-home correction

Combined3's actual new own-key session exposed a resolver regression: the native
core wrote a valid fresh rollout below the persisted account's `CODEX_HOME`,
while its `sqlite_home` pointed at the shared native index. ORG2 incorrectly
required the indexed body to be below the index directory and raised a history
RPC error after a successful model reply. The authoritative sources are the
vendor's current SQLite row and its raw rollout; neither was manually repaired.

The indexed resolver now accepts only the native history home or the exact
persisted owning account's history home. Both require a canonical regular JSONL
under `sessions` or `archived_sessions`. Managed-session homes retain their
single-home restriction. Missing/invalid/locked current rows still fail closed,
and retained generations never become fallback candidates.

`indexed_path` explicitly distinguishes current read authority from the durable
native destination and runner alias. Replay and revisions use the indexed path;
existing fenced convergence promotes bytes and the supported native catalog RPC
rebinds the row. Native App availability cannot claim a different, stale copy as
current. No native schema, wire format, directory-wide scan, cache, timer or
credential sharing is added. Historical recovery uses these ordinary product
paths; no history is rewritten solely to conceal the error or XML marker.

Architecture coverage: all ten layers checked within the storage boundary:
compilation, live call chains, naming, current-path/destination semantics,
fail-closed defaults, persisted-owner isolation, readable ownership, unchanged
wire/schema, fresh-versus-resumed initialization and read/revision/mutation
resolver symmetry. Unrelated UI, React and other provider refactors are skipped.

## CLI live-text delivery correction

The rebuilt GUI test located valid native deltas at the parser while workstation
Messages remained empty until completion. The CLI ingestion adapter omitted the
existing direct-stream callback. Connect that boundary without replacing provider
history or interrupted-output persistence. One existing session-scoped buffer owns
live text and coalescing; the live EventStore row is retained for cancellation,
recognized by Chat instead of generating a duplicate placeholder, and loses its
live classification at terminalization. Late completion of a different stream
kind cannot clear the active kind.

Architecture layers covered: compilation and call chains; live versus durable
naming and state semantics; existing defaults and ownership; unchanged public wire
and schema; shared handler initialization; symmetric completion/reset/disposal.
No cross-provider transport rewrite, new cache, timer, subscription, UI control,
configuration or migration. The source invariant is one live projection per
surface with terminal partial text remaining durable. No historical cleanup.
The performance report separates native exit success, the observed display
failure, unit regression results and pending rebuilt GUI verification.

## Interrupted native output follow-up

Covered layers: provider ingestion, durable identity/storage ownership, canonical reconciliation, and rendered turn lifecycle. Configuration, network/auth, catalog/billing, and platform launch policy are unchanged in this follow-up. Native raw history remains authoritative; the sparse finalized-output cache is joined only by a unique accepted intent on the last interrupted native user turn. Provider-completed output wins, and reset/missing anchors fail closed. No schema or wire format changes, historical deletion, or UI string filter is introduced. Rollback is a code revert; the raw source and cache are left intact.

Real Combined5 inspection exposed the formerly synthetic test assumption that persisted events contain a complete native prefix. Reconcile/reopen regressions now use assistant-only cache fixtures. The Codex source parser separately excludes structured provider cancellation context while preserving literal user lookalikes. A transient completion latch can also suppress actual live output; its correction is tested at the turn-phase owner, with GUI validation pending. Recovery remains deliberately limited to the last interrupted native turn rather than reviving older cached output after newer native activity.

## Cold-load recovery ownership follow-up

The pure native reconciliation module now exports the narrow sparse-output rule to the shared local-history projection boundary. Initial loading, guarded idle refresh and terminal reconciliation reuse existing cache reads and the same exact intent/lifecycle validation. Canonical continuation also handles unrelated failed-user sidecars without treating them as a complete native prefix. No new wire, persistence or resource owner is introduced. Actual loader/refresh/canonical-entry regressions replace the earlier insufficient inference that two terminal reconciles proved reopening. Architecture coverage: call-chain ownership, identity semantics, defaults and equivalent initialization paths; unrelated backend/platform layers unchanged. Real GUI reopening remains pending.

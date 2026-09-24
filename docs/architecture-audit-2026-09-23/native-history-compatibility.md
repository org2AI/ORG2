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

| Layer                     | Coverage and result                                                                                                                                                           |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 Compilation             | Local Rust check/tests and changed-source formatting; current results below. Cross-platform CI belongs to the published revision.                                             |
| 2 Dead code / duplication | Removed independent CI wrappers and unused helper APIs. Kept migration readers and distinct metadata-vs-action boundaries.                                                    |
| 3 Naming                  | Local installation generation is explicitly process-local; raw revision hashes remain content identities. Logical session ID and physical rollout ID stay distinct.           |
| 4 Semantic overloading    | Separate version diagnostics, action capability checks, raw write time, publication receipts and GUI/CLI evidence.                                                            |
| 5 Defaults                | Explicit target route wins; native default must match provider. Unknown route/namespace pauses instead of guessing. Exact LWW timestamp tie favors primary.                   |
| 6 Domain boundaries       | Native source storage is authoritative; display parser and UI filters do not define admissible history. Destination credentials/configuration remain local.                   |
| 7 Discoverability         | One operation resolver, named raw/storage modules, shared history status and direct native fixture instructions. Removed monitoring-only entry points.                        |
| 8 Wire / serialization    | Read legacy evidence, write current receipt formats; opaque native columns retained; actual incompatible contracts pause. Event target/reason mapping checked across Rust/TS. |
| 9 Initialization parity   | Cold target uses vendor bootstrap with durable ownership; existing target uses the same route/profile fences. Claude fresh-window behavior remains an acceptance gap.         |
| 10 Resolver symmetry      | Both handoff directions use destination config and independent revision receipts. Primary default probe uses a disposable home, never the primary account.                    |

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

| State / transition                    | Expected invariant                                                     | Remaining evidence                                                                  |
| ------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Disabled / signed out / retired owner | Release service and reject stale writes                                | Unit coverage; full account-switch product run pending                              |
| Visible idle / hidden idle            | No periodic history scanning without pending work                      | Full CPU/RAM/I/O observations pending                                               |
| Active native writer                  | Read only completed stable source; never overwrite loaded destination  | Engine/native fixture coverage; GUI concurrency pending                             |
| Writer exit / namespace created       | Wake queued work from native invalidation                              | Claude delayed post-reopen recovery observed previously; exact trigger not resolved |
| Update / provider switch / revocation | Invalidate runtime/config binding before commit                        | Source-boundary regression coverage; live App update matrix pending                 |
| Failure / crash / repeated open-close | Bound work, retain unknown pending transaction, avoid duplicate writer | Recovery/launch tests; full repeated GUI lifecycle pending                          |

One pre-existing limitation remains: the Codex coordinator restores dirty work for
`busy` / `already synchronizing` failures and retries after 750 ms while pending.
The same loop exists on `develop`; it was not introduced or expanded here. Do not
use the event-driven design claim to certify the persistent-contention idle case.

**Performance verdict: blocked.** Source bounds and lifecycle tests cannot replace
the missing visible/hidden/active resource measurements and real account/provider
transitions. This audit removes a known unnecessary read path but does not certify
overall product performance.

## Provider acceptance and verification

| Provider | Engine / native core                                                                                                                    | Desktop product acceptance                                                                                             |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Claude   | Historical implementation `05a87eec871`: 21 raw handoffs and 21 CLI resumes, destination config preserved, completed tools not replayed | Existing-profile GUI writeback/reopen was observed separately; fresh first Open and delayed recovery remain unresolved |
| Codex    | Historical implementation `05a87eec871`: five engine/core cases, seven LWW checks, frozen forks/cold target/live writers                | Not passed: native GUI control was refused; no Configure/Open/continue/writeback/reopen claim                          |
| Both     | Local audit revision checks listed below                                                                                                | Paid provider/SJC accounting and full resource matrix unverified                                                       |

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

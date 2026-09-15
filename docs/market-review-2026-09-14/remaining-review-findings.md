# Market 外部审计复核：仍不满足发布验收

本报告合并当前状态，后面的历史记录保留测试边界，不作为重复待办。原审计针对 `4ae0a568e73ab55aec522a27963c8ba90a2283b0`；后续并发修复及本轮恢复链路复核基于 `031768e2db0d94424102cf5d6b102d449c926497`。主要修复在 `373335f36`，授权持久化补偿在 `3734a65d1`。

**结论：原审计指出的问题成立。当前已有针对性修复，但不能将这些修复或局部测试等同于可发布的一键接入。保持不合并、不宣称全流程已验收。**

本轮新增闭环（代码 `80d710936`）：Market 失败卡提供中文恢复入口；原生错误解析及历史导入会脱敏本地代理令牌；最终未签名桌面包重启后，旧 assistant 错误中的令牌已显示为占位符，重新授权按钮仍可见。91 项前端测试、42 项原生测试通过，另有 3 项 opt-in 客户端测试跳过；提交检查中的 TypeScript 与 Clippy（org2、terminal）通过。**真实重新授权后的续跑、独立失败重试及完整发布验收仍未完成。**

## 七项发现的当前状态

| 发现                              | 当前实现及已有证据                                                                                                                                           | 仍需验证的边界                                                                                   |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| P1 Codex 丢失 `/v1`               | 初始 destination 和刷新凭据后的 destination 均通过协议基址函数保留 Codex `/v1`；真实本地 Router → mock upstream 测试已通过，覆盖 URI、query 和错误本地 token | 真实 Market 续期后经 Codex 发起上游请求及计量                                                    |
| P1 关闭终端删除原生历史           | 不再递归删除 home；只删除 hash 匹配的模块配置，保留其他文件；关闭后发现历史、SQLite 索引重启及原生会话 ID 回归已通过                                         | **尚未关闭整个恢复问题**：实际关闭应用、重启、继续原会话，并确认原 CODEX_HOME 与 Market 计费选择 |
| P2 断开部分成功后无法重试         | 按配置恢复 → grant 删除 → 索引写入执行；已切换到新来源时保留新配置；六个阶段前后故障场景及重复重试测试通过                                                   | 故障注入使用文件替身，尚无真实 OS Keychain 故障/进程崩溃验收                                     |
| P2 离线/过期时无法退出            | 本地配置独立于远端购买列表加载，离线、请求悬挂、无有效购买时仍可断开；渲染测试通过                                                                           | 真实桌面离线及撤销后的恢复操作                                                                   |
| P2 Linux 兑换 code 后才发现不支持 | buyer begin/complete 在兑换前检查平台能力；buyer 持久存储与 seller 临时授权分别声明，13 种语言有不可用提示                                                   | Linux 实机能力与发布包验收；不是已实现 Linux buyer 存储                                          |
| P2 Settings 删除后选择越界        | 改为身份/workspace/target 稳定选择；删除及重排渲染测试通过                                                                                                   | 真实 Settings 多连接操作                                                                         |
| P2 PowerShell 环境赋值            | RHS 始终单引号字符串并转义单引号；在 macOS PowerShell 7.6.6 实际执行生成命令，验证字面量原值                                                                 | Windows 实机路径、客户端启动及完整请求                                                           |

以上表格汇总原七项发现。后续恢复链路的代码和测试进展见本报告各 follow-up；真实 provider、主应用及 Windows 验收仍未完成。

## 仍然开放的问题

1. **恢复执行链路**：已持久化并返回动态来源，普通启动器已接入会话配置重建及代理生命周期；原生配置和启动器回归见下文。canonical target 已保留来源并参与匹配，新执行 episode 原子绑定来源；会话列表及 ChatPanel 默认选择已保留来源，实际模型选择器交互和消息 UI 尚未验收；native history materialization 的读写、同步、回滚及索引现已接入会话目录归属，本地组合回归已通过；实际应用与 provider 验收仍待完成。必须完成主应用关闭、重启、继续原会话和真实计量验收。
2. **跨工作区阻塞**：凭据请求与购买列表现已按身份/workspace/target 使用独立锁，索引表锁不跨 I/O；断开和重新授权仍独占授权变更屏障。锁边界、同授权串行、清空旧缓存和上限回收测试已通过；真实多工作区网络与桌面 CPU/RSS 尚未测量。
3. **断开与撤销**：当前桌面断开只恢复配置、清理本地凭据和索引，不包含服务端撤销。不能把本地断开描述为服务端授权已撤销。
4. **模块移除与残留目录**：module-off 编译和目录数量限制不能证明运行时配置恢复或崩溃残留处理。不得为清理目录再次删除原生会话数据。
5. **授权持久化**：已改为先写非秘密索引、再保存凭据，避免新 grant 无法发现；缺少真实 Keychain 故障与崩溃测试，也没有自动恢复历史孤立 grant。
6. **跨仓库及发布**：seller complete/cancel 竞态、重复绑定、过期边界，以及签名主应用 → 浏览器授权 → buyer 请求 → 计量 → 续期/撤销需要联合验收。真实 Claude App 和 Windows 尚未通过，不能用 compatibility marker 替代。

## PR 与证据范围

本次已能读取配套后端 PR 元数据，因此原审计“无法访问 #75”不再是当前取证阻碍；**能读取 PR 不代表其跨仓库契约已验收**。

- [ORG2 #1761](https://github.com/org2AI/ORG2/pull/1761)：OPEN，base `codex/search-input-renderer-types`；最新提交以 PR 为准
- [Cloud infra #75](https://github.com/org2AI/ORGII-cloud-infra/pull/75)：OPEN，head `d05755d85d6a3b26ce189dffb86ff3d1613860ad`
- [Cloud infra #76](https://github.com/org2AI/ORGII-cloud-infra/pull/76)：OPEN，head `57031e98e7134ab1f2843f844ae0c8d368cf6eb1`
- [Cloud infra #77](https://github.com/org2AI/ORGII-cloud-infra/pull/77)：OPEN，head `bfb8b372857160534834dae50e7461ae8d0b05ef`

未合并、未由本次报告修改触发部署，也未将 CI queued/completed（无 conclusion）记为通过。以下为历史修复与测试记录，早期的 pending 以本报告上面的状态表为准。

## Recovery follow-up

- Conditional config restoration now returns the current status without changing files when a different source is selected. Repeating old-source restoration is covered by a Rust regression (1 passed); the newer manifest and config bytes remain unchanged.
- Disconnect no longer treats an already-removed index entry as a fatal precondition. Keychain removal already treats missing entries as success. Full per-stage Keychain/index fault injection is still required before closing the partial-failure finding.
- ConnectionDialog loads local configuration independently from remote purchases. Matching local metadata keeps disconnect available when remote loading rejects, never resolves, or returns no active purchases. Launch remains gated by an active compatible purchase.
- ConnectionSettings uses stable identity/workspace/target selection; refresh preserves that identity after reorder and selects the remaining item after deletion.

Verification: 8 rendered tests passed using the repository's `pnpm test` configuration across ConnectionDialog and ConnectionSettings, including the offline/pending/expired and reorder/delete cases. `tsgo --noEmit` passed. An initial direct Vitest invocation omitted the repository config and failed alias resolution; it is not passing evidence. Native disconnect per-stage failure recovery, actual UI acceptance, and the remaining review items are still open.

## PowerShell assignment follow-up

`withCliCommandEnvironment` now always emits single-quoted PowerShell string literals for environment assignment RHS values, doubling embedded single quotes. It no longer uses the command-argument safe-character shortcut.

Verification: 26 terminal command tests passed, including actual generated-command execution with official PowerShell 7.6.6 for macOS ARM64. The executable was obtained from the official PowerShell/PowerShell GitHub release into a temporary verification directory. Execution covers a space-free forward-slash Windows path, apostrophes, a `$()` expression, a variable expression and an empty string; each reaches the client body with the original literal value. `tsgo --noEmit` and diff whitespace checks passed. This verifies PowerShell parsing/execution, not a Windows desktop installation, native path access, or full Codex launch. The test runs on Windows with powershell.exe and can be enabled elsewhere with ORG2_TEST_PWSH; absence of a runtime is an explicit skip.

## Platform capability follow-up

Buyer begin and complete both check native persistent-credential availability before enrollment or code exchange. On Linux they return `market_buyer_credential_store_unavailable`; seller temporary authorization remains independently available. Module status and the versioned release marker now distinguish buyer persistent storage from seller temporary authorization. Module-off status advertises neither capability.

Verification so far: 5 release marker tests, 1 host-platform credential gate test, and TypeScript typecheck passed. The host is macOS; this is not Linux runtime acceptance. Linux execution, user-visible unavailable messaging and consumer handling of the new capability fields remain part of final acceptance.

## Router regression in progress

The production route table is now built by `proxy_router` with an injected context resolver (production uses the existing managed-config resolver). A loopback HTTP regression exercises the actual `/cli/codex/{token}/v1/{*path}` handler and `forward_request` against a mock upstream; it asserts `/w/ws_route_test/v1/responses`, query preservation and local-token rejection. Only configuration/credentials are supplied by the fixture; URI extraction and HTTP forwarding are real. This test does not perform Market token renewal or provider calls.

Native test compilation was started with `cargo test --lib codex_router_forwards_workspace_v1_uri_and_query_to_upstream` from src-tauri. Its result is pending; do not count the test as passed before inspecting the process result. The workspace credential validator was also checked: it requires the exact root `https://org2-market.fly.dev/w/{workspace}`, so adding `/v1` at the Codex protocol boundary does not duplicate a server-supplied prefix.

## Capability messaging and combined UI regression

Unsupported buyer credential storage now has a specific user-visible message in all 13 locales. The deep-link handler matches only the known capability error code and never displays raw callback/IPC data. The regression verifies that authorization is not opened and no success is reported. All 13 dictionary files parse and contain the message.

Combined Market UI and terminal regression: 59 passed, 1 skipped (the optional PowerShell executable was not supplied for this combined run; its separate real-execution run previously passed). Typecheck passed for the messaging change.

Router HTTP test first execution failed before HTTP due to missing test TLS provider initialization. The existing `test_utils::install_crypto_provider_for_tests` initializer was added and the same named test was restarted after the failed process terminated. Result pending; the initial failure is not evidence of route correctness.

Router rerun result: **1 passed, 0 failed**. The real local HTTP route delivered `/w/ws_route_test/v1/responses` (including the query case) to the mock upstream and rejected an invalid local token. This closes the route-stripping regression at the HTTP boundary; real Market credential refresh and external Codex/provider acceptance remain separate required checks.

## Disconnect fault injection

The native disconnect path now uses a shared ordered cleanup function; the intended index is serialized before effects begin. A filesystem-backed fault-injection test covers six cases: failure before or after each of configuration restoration, credential removal and index replacement. Retry plus repeated retry preserve a newer user-selected configuration and unrelated index entries while removing the old credential/index. The index effect uses the production atomic profile writer. **1 test passed covering all six cases** in the native app test binary.

Boundary: credential storage is a file-backed test double, not the operating-system Keychain, and the restore effect models the independently tested compare-before-restore contract. This proves retry orchestration under those injected failures; OS Keychain error behavior and actual desktop disconnect acceptance remain to be checked. The original P1 history issue also remains open for restart/discovery/resume even though recursive deletion has been removed.

## Native history discovery follow-up

Found an additional gap: retaining files did not make the new launch homes discoverable. Added a shared `app_paths::managed_cli_launch_root` used by the launcher and existing history scanners. Codex discovery now includes each retained home's sessions directory; Claude discovery includes projects directories and classifies their transcripts as ORG2-managed. The directory is scanned independently of any remaining temporary config/ownership marker.

Verification: the changed Codex discovery regression passed and confirms a closed launch home without temporary config is rediscovered repeatedly. Related native history suites: Codex 101 passed/3 ignored; Claude 50 passed/1 ignored. Managed launch retention 2 passed. Ignored tests were not counted as verified. These tests establish retention/discovery and guard existing parsers, but do not establish actual UI restart or `codex resume` using the correct original home. That end-to-end restoration check remains open.

## Persistent history index restart regression

Added a combination test with a valid Codex rollout in a retained launch home and a real SQLite history index. It scans, closes the database connection, reopens/scans, resolves the original native thread UUID and cwd through `cli_resume_plan_for_cached_session`, and confirms the original transcript bytes/source path survive. **1 passed**.

Remaining execution question: `CliResumePlan` carries native ID/cwd but no original CODEX_HOME. The current frontend continuation adapter consumes cwd and enters the canonical continuation machinery; no direct resumeArgs consumer was found in the scoped frontend search. Therefore this result proves persisted history/identity resolution, not that the eventual CLI execution restores the original home or preserves Market billing selection. Trace and verify the execution adapter before closing P1 history recovery.

## Authorization persistence follow-up

The authorization commit now checks the active enrollment and publishes the non-secret connection index before writing the OS credential store. Previously, an index failure after a successful credential write could leave an undiscoverable grant. A failed credential write now leaves discoverable metadata: status reports reauthorization required if no grant exists, and disconnect can remove the entry. Existing grants are retained if replacement fails before the credential write. Retired attempts cannot publish index entries. No secrets or new schema fields are added to the index. This does not recover historical orphaned grants or remotely revoke authorization.

Verification on top of integrated upstream commit `c5564be9e`: Market UI/terminal suite 60 passed including PowerShell execution on macOS; frontend typecheck passed; exact retained-history SQLite restart test 1 passed. An initial broad Rust test filter matched zero tests and is not counted as evidence. The Market native crate passes 31 tests, including before/after index and credential commit failure injection with in-memory store effects and cancelled-attempt rejection. Real Keychain failure and process-crash execution remain unverified.

## Connection concurrency follow-up

Both credential minting and purchase-list requests now share an owner-scoped entry rather than holding the registry mutex over filesystem, Keychain and HTTP operations. The fixed production endpoint plus identity/workspace/target define the owner; selections retain their entitlement-specific credential caches. A shared authorization read barrier spans each request, while disconnect and enrollment completion take the exclusive barrier, clear entries, and retain exclusivity through the persistent commit. Existing spawned-task ownership is retained so dropping an IPC/request future does not release the barrier during a credential commit.

The registry remains capped at 32 owners and 32 selection reservations globally, including failed/in-flight attempts. Failed restoration is retryable in the same slot. Retirement reclaims all reservations. There is no eviction during a rotating-grant operation, no timer, no polling, and no new persistence/wire format. Explicit authorization mutations still pause all owners; this change removes cross-owner serialization for ordinary requests, not for mutations.

Verification: `cargo test --lib market_connection::source::tests -- --nocapture` passed 6 tests; `cargo test --lib market_connection::` passed 7 including disconnect fault injection. Controlled lock tests prove another workspace can acquire while one is stalled, the same owner serializes, a queued authorization writer waits for old requests and excludes new ones, and retirement replaces the old cache and reclaims bounds. These tests exercise the production coordinator but do not perform real Keychain/HTTP operations or prove refresh-token single consumption against a live server.

### Architecture and performance review

Architecture layers 1–10: Rust test compilation passed; restore logic is shared by both production request entry points; owner state and authorization barrier have separate names/responsibilities; protocol selection/validation and authenticated cache lifetime are preserved; no Market concepts moved into generic proxy crates; no wire/schema changes; both request paths acquire the same coordinator; initial/refreshed destinations still use the same protocol-base resolver. This is a scoped audit of the changed call chain, not a fresh whole-repository audit.

| Area               | Verdict | Evidence / lifecycle decision                                                                                                   | Verification                                                |
| ------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Background work    | keep    | Demand-driven requests; no new timer or polling; existing spawned operations retain ownership through completion                | Source trace; real idle/hidden/shutdown measurement not run |
| Memory             | keep    | 32 owners and 32 selection reservations; failed attempts bounded; authorization mutation clears all                             | Bound/reclamation test passed                               |
| Scope/isolation    | fix     | Per-identity/workspace/target lock; request read barrier and mutation write barrier; no late old-cache publication after commit | Cross-owner/same-owner and invalidation tests passed        |
| Rendering/hot path | keep    | No React or streaming-delta code changed; registry lock contains no I/O                                                         | Source trace; desktop latency/CPU/RSS not measured          |

Performance verdict: blocked for full runtime acceptance. Coordinator tests pass, but the matching desktop build has not yet been exercised with real concurrent workspaces, network failures, primary/secondary instances, or visible/hidden/closed measurements. This does not block further implementation work and does not mean the overall thread goal is blocked.

Clippy follow-up: `cargo clippy --lib -- -D warnings` passed after simplifying the cache-expiry predicate and naming the proxy resolver function type. The initial strict run failed on those two lints; it is not counted as passing evidence. No lint was suppressed.

Final rerun after lint corrections: `cargo test --lib market_connection::` passed 7/7 and `cargo test --lib codex_router_forwards_workspace_v1_uri_and_query_to_upstream` passed 1/1; zero ignored in either filtered suite.

## Execution recovery audit: selected model and credential ownership

The current Market launcher creates a TUI row via `cliAgentCreateTuiSession` before generating its session-owned proxy profile. That create wrapper previously sent neither the chosen model nor any credential selection; it always sent `keySource: own_key`. The initial terminal still used the generated Market configuration, so a successful first request did not prove that the persisted Session could reproduce it after restart.

This follow-up preserves the selected model through the shared TUI create request into the existing `CreateCodeSessionParams.model` field. The production SQLite writer already inserts that field. There is no schema change or new default for ordinary TUI callers. Tests cover both the Market caller and actual shared IPC request construction, including omission for callers without a model.

**Credential ownership remains unresolved.** The Market selection is a dynamic-source key, while the normal session runner's accountId is resolved by KeyVault and refreshed through provider-specific KeyVault functions. Copying a `market:` selection into accountId would overload that contract and would not create a functioning restart path. The next implementation must retain the source identity through the session owner's execution contract and resolve it through the registered dynamic source before launch, without substituting an unrelated KeyVault/default account. This requires coverage of create, follow-up, restart, and explicit account switching; merely retaining CODEX_HOME or model is insufficient.

Additional direct-resume consumers were found: `orgtrack-cli::commands` launches the planned native ID with args/cwd only, and the mobile imported Codex adapter similarly constructs exec/resume without the transcript's custom home. Desktop imported continuation instead enters canonical materialization with the selected target. These paths have different execution semantics and must not be fixed by blindly injecting the same environment in all three.

Verification: targeted Market launch and shared terminal tests passed 36 with one existing PowerShell runtime test skipped because no runtime override was supplied. The skipped test is not new Windows evidence. No real continuation, provider request, native app build, or production rollout was performed by this follow-up.

## Live-session proxy isolation follow-up

New Market TUI launches now receive a session-owned local proxy token rather than copying the mutable global selection's token. The request resolver maps that token to its frozen agent/source/model before consulting any global selection; unknown and released session tokens cannot fall back. Provider credentials still resolve through the existing dynamic source on each request. Initial selection/hash checks remain in profile preparation.

Lifetime coverage in code: failed preparation, terminal release, normal CLI deletion and agent-core deletion remove the token; profile cleanup preserves native history. A release does not cancel an already admitted upstream request. The registry is capped at 256 process-owned entries and rejects duplicate session reservations. It performs no I/O under its mutex and introduces no timers.

This solves live-session dependence on global settings, not persistence/restart or ordinary runner integration. Those remaining items above are unchanged. Remote revocation, real grant rotation, actual Tauri close/delete, multiple app instances and CPU/RSS remain unverified.

| Area               | Verdict | Evidence and lifecycle decision                                                  | Verification boundary                                     |
| ------------------ | ------- | -------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Background work    | keep    | Demand-driven reserve/resolve/release; no new polling or worker                  | Source inspection                                         |
| Memory             | fix     | At most 256 entries; duplicate rejection and explicit release                    | Registry bound/reclamation regression                     |
| Scope/isolation    | fix     | Random token resolves exact agent/source/model independently of global selection | Real local Router with synthetic upstream; not production |
| Rendering/hot path | keep    | No React changes; short registry lock, no I/O while held                         | No real desktop CPU/RSS measurement                       |

Performance verdict: blocked for full runtime acceptance because the matching native build has not been measured through visible/hidden/closed, crash and multiple-instance states. This is not an overall task block; restart integration remains actionable.

Verification for this follow-up: `cargo test --lib cli_managed_proxy:: -- --nocapture` passed 14 tests, including real localhost Router→synthetic upstream requests for independent Codex workspaces, Claude Messages and HEAD probes, released-token rejection, and the existing global-route regression. `cargo test -p agent_cli managed_launch -- --nocapture` passed 2 tests covering both client profile formats, independent token insertion, external-edit refusal and history retention. Zero tests were ignored in either filtered suite. Strict `cargo clippy --lib -- -D warnings` passed. These are native Rust/local HTTP tests, not an installed-app, real-provider or restart acceptance run.

Preparation and terminal release also take the existing per-session control lock used by ordinary deletion. The owned guard stays inside blocking work so dropping the IPC future cannot release it while profile writes are still executing. Agent-core deletion retains its existing synchronous orchestration; it now revokes a route before deleting a row.

## Persisted execution-source binding

The initial launch now records the validated non-secret source under its durable Session before exposing a process-local route. It refuses a different source on the same Session and requires the stored TUI/client/model to match. The new additive table is initialized with the canonical CLI schema. The normal KeyVault runner is not yet taught to consume it; source binding alone does not close restart acceptance.

A real SQLite file regression passed with foreign-key enforcement explicitly off and on: matching/repeated binding, mismatched source/client/model, missing/non-TUI owner, close/reopen readback and owner deletion cleanup. The cleanup trigger does not depend on SQLite's build-dependent foreign-key default. Initial failures were a pooled-connection type mismatch and an incorrect test assumption that the bundled default was off; neither is passing evidence. Actual current bundled default was on.

No application runtime, provider or production database was touched. Additive-schema rollback retains this metadata; an older binary ignoring it cannot be considered a verified restore path. The core synchronous delete adapter and post-reservation owner check also close the route-reservation/deletion ordering gap; actual concurrent desktop IPC fault injection remains unverified.

Final verification for persisted-source changes: `cargo test --lib agent_sessions::cli::persistence:: -- --nocapture` passed 23 tests, zero ignored, including the new file-backed binding regression and existing account-scoped native-resume state tests. `cargo clippy --lib -- -D warnings` and `git diff --check` passed. These checks do not cover actual restored execution or prove the synchronous deletion race through a real desktop process.

## Session-owned profile reconstruction

The launch IPC now distinguishes a first launch from a persisted same-source retry. A retry validates the durable client/model/source binding and generates a fresh local route into the original native home, without depending on the current global account selection. Proxy startup uses the existing bounded two-second readiness wait. No permanent polling was added.

Profile replacement publishes an ownership intent containing the previous and next hashes before the atomic configuration write. This makes interruption on either side retryable while rejecting unmarked or externally edited configuration. Both initial creation and restoration use this intent. The marker addition is optional on read, preserving older markers. Existing owned homes can be restored at the 256-profile limit without increasing the count; retained native transcripts remain outside cleanup ownership.

Filesystem regression: `cargo test --manifest-path src-tauri/Cargo.toml -p agent_cli managed_launch -- --nocapture` passed 3 tests, zero ignored. Both client formats cover release/reconstruct in the same directory, live owned-file rotation, changed global selection, interruption before/after replacement, wrong-client refusal, external/unmarked-file refusal, and transcript preservation. These tests simulate write-boundary interruption; they do not kill a real desktop process.

The frontend still creates a fresh terminal Session. Connecting the canonical history/resume flow to this durable source is outstanding. This backend reconstruction path is not evidence that installed-app restart, actual provider execution, receipts or Windows acceptance have passed. Runtime CPU/RSS and multi-instance filesystem contention remain unmeasured. No production deployment occurred in this follow-up.

Additional verification: `cargo test --lib cli_managed_proxy:: -- --nocapture` passed 14 tests, zero ignored, including local HTTP forwarding and per-session token isolation. `cargo clippy --lib -- -D warnings` passed. The IPC restoration branch itself still requires installed-app integration coverage; the filesystem and HTTP tests exercise its constituent boundaries separately.

## Durable source projection into Session reads

`CodeSession` now returns optional `credentialSource`, independently of `accountId`. The shared SQL projection performs an indexed source lookup inside the same query for single, full-list, offset-page and keyset-page reads. The launch adapter consumes this snapshot to choose initial preparation versus same-source restoration; the post-reservation owner read remains to guard deletion races. No secret or new database schema is introduced. Old rows omit the optional field, and deserialization accepts older payloads without it.

Verification: `cargo test --lib agent_sessions::cli::persistence:: -- --nocapture` passed 24 tests, zero ignored. The added sandbox database test verifies every read variant, both keyset branches, JSON field naming, separate account identity, and old-row serialization/deserialization compatibility. `pnpm typecheck:fast` passed. The initial test command was mistakenly run from the repository root without a manifest and did not execute tests; the passing command ran in `src-tauri`.

Architecture coverage: persistence ownership, read projection, RPC compatibility and launch consumption. Frontend canonical target selection and normal runner integration remain outstanding. Performance: no new timers, workers, locks or per-row IPC; an indexed scalar lookup is added per returned row. Large-list query latency and actual desktop CPU/RSS are unmeasured, so this is not runtime performance acceptance. No production database or application was touched.

Strict `cargo clippy --lib -- -D warnings` passed for the source projection and its launch consumer. No rendered UI or installed-app behavior is claimed by these checks.

## Ordinary runner consumes the durable dynamic source

The ordinary CLI runner now prepares a session-owned execution profile when the Session contains `credentialSource`. Conflicting KeyVault/hosted ownership is rejected. Preparation validates the registered dynamic source, waits for the local proxy, reserves a fresh generation, rechecks the persisted source/client/model, and reconstructs the native home. Its lifetime guard revokes only its exact token and releases owned configuration on return/cancellation. A stale guard cannot remove a replacement generation. Blocking preparation retains ownership even if its awaiting future is dropped.

The runner uses this same home for Codex config/MCP materialization and its app-server native store. Claude receives the owned settings arguments. Managed execution bypasses KeyVault auth/profile rewriting and filters ambient/runtime-profile provider routing variables before applying its own configuration. Runtime controls such as PATH and CODEX_SANDBOX_NETWORK_DISABLED remain intact. Provider secrets still resolve through the existing dynamic source on requests; none are added to Session rows.

Verification so far: `cargo test --lib cli_managed_proxy:: -- --nocapture` passed 15 tests, zero ignored, including the new sandbox SQLite/profile lifecycle regression for both clients, same-home reconstruction, duplicate rejection, release, stale-generation safety and rejected-source retry. Existing local Router tests remain separate synthetic-upstream coverage. This does not exercise a real child CLI, installed-app cancellation, grant rotation or receipts. Canonical frontend target/dispatch propagation and native history materialization still require integration and app acceptance.

Architecture covers Session authority, application-owned source resolution, provider-neutral configuration and execution lifecycle. Performance: demand-driven preparation, bounded existing route registry and readiness wait; no recurring polling or worker. Drop performs small synchronous owned-file cleanup, whose desktop latency/CPU/RSS and cross-process behavior have not been measured. No production changes or deployment were made.

The ordinary runner suite (`cargo test --lib agent_sessions::cli::session_runner::session::tests:: -- --nocapture`) passed 56 tests, zero ignored. The added process-command regression verifies inherited provider values are explicitly removed, runtime controls remain, and owned CODEX_HOME is applied afterward. It inspects the production Command environment; it does not launch a real provider binary.

Strict `cargo clippy --lib -- -D warnings` passed for this runner integration. Real native execution, canonical materialization and rendered recovery remain unverified.

## Canonical source identity and atomic episode creation

Canonical CLI targets now carry a bounded `credentialSource` exclusively from `accountId`. Hydration reads the persisted source and rejects corrupt/mixed source ownership instead of turning it into ambient Claude. Candidate matching includes source identity, so another workspace or KeyVault account cannot reuse the same execution episode. New episode creation carries the source through SessionService, launch RPC and the application CLI bridge. The CLI branch also now preserves the selected model, which previously disappeared in SessionService's launch projection.

The application validates the registered source/client/model before creation. Session creation and source binding now commit in a single SQLite transaction under the existing writer/retry owner. Binding failure rolls back the Session insert as well; no intermediate unbound Session is returned. This reuses the existing source table and adds only optional RPC fields. Old requests continue to create ordinary Sessions.

Verification: the conversation type/continuation suites passed 71 tests. Added cases cover durable source roundtrip, bounds/mixed-owner rejection, source-aware candidate selection, malformed-source refusal and propagation into episode creation before a controlled timeline failure. `pnpm typecheck:fast` and strict `cargo clippy --lib -- -D warnings` passed. Initial failures included a mock status using workspaceRepoPath instead of repoPath, a rollback return-type mismatch in an abandoned two-step implementation, and persistence fixtures using the wrong creation wire name or assuming Serialize. Those runs are not passing evidence.

This does not yet prove rendered account-picker preservation, native history materialization under the managed home, or complete create→resume→real-provider receipt behavior. Architecture coverage: canonical target identity, optional wire compatibility, application credential ownership and transaction lifecycle. No new polling, cache or per-turn IPC was introduced; source lookup stays in the existing status query. Added transaction latency and actual desktop CPU/RSS remain unmeasured. No deployment or production database changes occurred.

Final persistence verification: `cargo test --lib agent_sessions::cli::persistence:: -- --nocapture` passed 25 tests, zero ignored. The new transaction regression proves successful local source creation and complete rollback for mixed-account ownership, wrong runner and empty source. Existing TUI binding, deletion and source readback tests also passed. This is database/application-boundary evidence, not a process-crash or installed-app test.

## ChatPanel and aggregate source preservation

The unified Session aggregate now carries the CLI owner's optional non-secret source; imported/native-agent records leave it absent. Frontend Session conversion and ChatPanel target reconstruction preserve it separately from accountId. Corrupt/mixed ownership returns no target. Default/runtime restoration recognizes a retained dynamic source directly instead of passing it through KeyVault inventory or ambient-Claude fallback. The selected source label identifies ORG2 Market. Picker-draft reconciliation compares the source, so another workspace's persisted target cannot clear the current override. Explicit account picks still resolve through the ordinary account path.

Verification: 50 frontend tests passed across aggregate conversion, ChatPanel selection/binding and override lifecycle. New assertions cover aggregate→frontend→target propagation, source retention without a KeyVault inventory row, unavailable-runtime/mixed-owner rejection, source-specific draft reconciliation and explicit account selection. 84 session-directory Rust tests passed, including a real sandbox database source→aggregate→JSON regression and legacy payload compatibility. `pnpm typecheck:fast` passed. These are converter/selection tests, not rendered installed-app acceptance.

Native materialization remains incomplete: Claude paths/index publication and Codex native catalog paths still use ordinary account/default homes in materialize, read, sync and rollback. That whole storage-owner contract must be updated together; patching only the initial writer would leave unsafe or unreadable recovery. No native materializer code was changed in this follow-up. Actual model-picker interaction, app restart/request/receipt, module-off behavior and runtime CPU/RSS remain unverified. No polling or extra per-row RPC was added; no production changes or deployment occurred.

Strict `cargo clippy --lib -- -D warnings` passed for aggregate source propagation. Architecture coverage is DTO compatibility, source ownership and target/draft identity; runtime/UI evidence remains bounded as described above.

The final 50-test frontend rerun also covers a CLI Session carrying an Agent definition for tool scope: that metadata does not replace its CLI runtime or erase its dynamic source. No additional provider/native execution was performed.

## Session-owned native storage follow-up

The remaining recovery failure was at the provider-native materialization boundary: a dynamic-source Session has no KeyVault account, but Codex readers/writers required one and Claude resolved the ordinary global/account store. The runner already used a Session-owned home. Keeping files without making these owners agree could not restore execution.

A shared `NativeStorageOwner` now resolves paths from the persisted Session. Read, fresh materialization, suffix synchronization, rollback, finalizer convergence and pending catalog repair all use it. Managed Codex catalog operations carry the same home as CODEX_HOME; Claude publishes/removes its project index beside the actual transcript. Identical native/runner paths are retained as a regular file rather than made into a self-link. Ordinary account behavior remains unchanged. Mixed credential owners and symlinked managed stores are rejected. This adds no database schema, credential storage, background task or cross-workspace scan; managed Codex discovery searches only one Session's bounded store.

Verification: `cargo test --lib native_materializer -- --test-threads=1` from `src-tauri`: **41 passed, 0 failed, 1 ignored**, including new Claude create/release/reload/append/idempotence/catalog/rollback test, Codex source-home read/pending catalog/canonical-path test, and symlink rejection. These use sandbox files and SQLite. They do not execute a live Codex app-server or provider, or close/restart the installed application. The ignored helper is not passing acceptance evidence. `cargo clippy --lib -- -D warnings` passed.

Recovery boundary: existing managed histories stay in place; there is no bulk migration or cleanup. Reverting to an older reader can make them inaccessible through continuation, so preserve both the files and durable source bindings on rollback. Existing ordinary-account regressions remain required.

Architecture scope: persistence owner, native-store resolver symmetry, initial/final/deferred paths, configuration ownership and file effects. No UI/wire-schema change in this follow-up. Performance scope: demand-driven bounded scan of one Session, no new cache/timer/subprocess beyond existing catalog operations; actual CPU/RSS, concurrent processes and provider rewrite/rotation remain unmeasured.

## Primary app-settings recovery entry

The current App connections page did not mount Market connection management; it was only mounted in the older CLI detail view. The current page now reuses `ConnectionSettings` for its selected client. It uses a distinct `market:` React key: the first combined-page regression caught that sharing the editor's key retained Claude recovery state after switching to Codex. This was corrected before delivery.

Verification: `pnpm run test src/modules/MainApp/Settings/sections/HarnessConnections/HarnessConnectionsSection.test.ts src/features/MarketConnect/ConnectionSettings.test.ts` passed 3 tests in 2 files. The actual segmented control and Market settings component are rendered; the tests check client-specific workspace recovery, Desktop with no saved grant, and preserve the existing editor-selection and credential-import assertions. `pnpm typecheck:fast` passed. These tests replace only RPC and unrelated editors, not the selected-client controls.

The unsigned macOS acceptance bundle at the preceding commit built and opened the normal workstation and App connections page through native computer use. It used an isolated test profile and custom test scheme; this is startup evidence, not a signed main-app authorization, provider, receipt or restart acceptance result. The updated settings wiring was then rebuilt with `pnpm exec tauri build --debug --bundles app --no-sign --config <isolated-acceptance-config>` (production webpack frontend plus debug macOS bundle, exit 0). Native computer use confirmed the Market entry on Claude Code and Codex, and its disappearance on Claude Desktop with no matching record. The Codex layout was visually inspected in a screenshot. Two non-secret connection-index fixtures without stored grants were used; no provider credentials were copied, no authorization was submitted, and no charge was made. This proves page wiring and target switching only. Full authorization, offline disconnect and installed main-app restart remain open.

## Missing-grant settings recovery

The settings row previously treated `reauthorization_required` as an instruction to start browser authorization. That bypassed the existing local recovery dialog exactly when a grant was missing. The row now always offers **Manage connection**, with a separate **Authorize again** action for missing grants; both labels are translated in all 13 locales. A distinct validated `market-connection-open` event opens the dialog without emitting a false authorization-saved event or refreshing the connection index unnecessarily.

The composed Settings → Host → real recovery-dialog regression uses a saved local selection and failing remote purchase RPC. It verifies that management opens without browser authorization, disconnect sends the exact saved entitlement, and the row/dialog disappear after successful cleanup. A separate test verifies that browser authorization starts only from the explicit action. RPC, seller UI and launch UI are test substitutes; this does not exercise OS credential deletion or production requests. The existing local dialog and stable-selection regressions remain included.

Verification: `pnpm run test src/features/MarketConnect/ConnectionRecovery.test.ts src/features/MarketConnect/ConnectionSettings.test.ts src/features/MarketConnect/ConnectionDialog.test.ts src/modules/MainApp/Settings/sections/HarnessConnections/HarnessConnectionsSection.test.ts` passed 12 tests in 4 files; `pnpm typecheck:fast` passed.

| Area               | Verdict | Evidence                                            | Change or reason kept                                                | Verification                           |
| ------------------ | ------- | --------------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------- |
| Background work    | fix     | Management no longer dispatches authorization-saved | One host-owned open-event listener, removed on unmount; no timer     | Source and composed rendered test      |
| Memory             | keep    | One selected connection in host                     | Same bounded single-dialog state                                     | Rendered open/close test               |
| Scope/isolation    | fix     | Missing grant must not force browser enrollment     | Connection schema validates identity/workspace/target before opening | Missing-grant offline composition test |
| Rendering/hot path | keep    | User-clicked management only                        | Existing lazy dialog, no hot-path polling                            | Rendered test; no CPU/RSS benchmark    |

Performance verdict: blocked for full runtime acceptance; repeated hidden/visible lifecycle, multiple processes and CPU/RSS remain unmeasured. This is not an overall work blockage. At that point, a stored grant/index without a matching selected profile still lacked standalone cleanup. The subsequent connection-scoped disconnect section records the implementation and its verification boundary.

Native verification for missing-grant management: the updated unsigned macOS bundle rebuilt successfully with `pnpm exec tauri build --debug --bundles app --no-sign --config <isolated-acceptance-config>`. In the isolated profile, computer use clicked Manage connection on a missing-grant Claude record and reached the local dialog with the expected workspace/client and unavailable-purchases/error state. No browser authorization was submitted. General settings was then switched to Simplified Chinese; 管理连接 and 重新授权 rendered correctly and their layout was visually inspected. There was no managed client profile in this fixture, so native credential/config restoration and index removal were not exercised. All 13 locale JSON files contain both non-empty labels. Standalone cleanup was not part of that native check; see the subsequent connection-scoped disconnect section.

## Connection-scoped local disconnect

Disconnect previously required an entitlement from the dialog, even though the grant/index are owned by identity + workspace + client. After switching to an ordinary account, there was no selected Market entitlement to supply and the cleanup action disappeared. The dialog now offers local disconnect independently of remote purchases or the current local profile. Its IPC sends only connection metadata. Backend configuration restoration compares the current source's decoded metadata under the same target lock as restoration; a matching connection is restored even if the selected purchase changed. An ordinary source or another connection remains unchanged. Invalid Market selection data and external edits fail before deleting a grant or index.

The generic managed-config crate accepts a local ownership matcher and has no Market dependency. Existing exact-key restoration delegates to that operation. The source module owns decoding and identity comparison. Existing ordered grant/index cleanup, mutation barrier and retry behavior are retained. No storage schema, native history path or cloud revocation semantics change. The bundled frontend/native IPC must ship together; an older backend requires entitlementId and will reject the new call rather than provide this cleanup path. Rollback must retain existing grants/index/history; disconnecting a real grant requires authorization again to reconnect.

Architecture checks for this scoped change: compilation is verified below; no duplicate cleanup pipeline was added; connection ownership and purchase selection are separate; default/other-source branches preserve existing files; Market decoding stays in the application layer; wire arguments and both frontend consumers change together; startup uses the unchanged index reader; the same source parser is used for runtime resolution and cleanup ownership. No module-off or multi-process acceptance is inferred.

Initial checks: the composed frontend recovery/dialog suites passed 12 tests, `pnpm typecheck:fast` passed, and the managed-config file regression passed once. The file test covers mismatched ownership, malformed-owner error, external-edit refusal, restoration and repeated cleanup. The first Market Rust run passed 8 tests and strict library Clippy passed. An additional sweep then enabled local cleanup for saved Claude Desktop/ORG2 grants without requiring their unfinished launch adapter; ORG2 has no global CLI profile to restore. The two extra rendered target cases passed. Final verification repeated `cargo test --lib market_connection:: -- --test-threads=1` (8 passed, zero ignored), `cargo clippy --lib -- -D warnings` (passed), and the unsigned macOS acceptance bundle build (passed). Native computer use opened the missing-grant Claude fixture and clicked Disconnect; the dialog/Claude row disappeared. Reading the actual isolated connections index confirmed Claude was removed and the Codex fixture retained. Switching to Codex showed its management entry and Original setup, also visually inspected. This used the actual IPC/backend/file write; there was no real grant to delete, active managed profile to restore, provider request or charge. Ordinary/new-profile preservation and external-edit rejection remain file-backed Rust regression evidence, not a live production-account test.

Related UI finding addressed by the purchase-state follow-up below: the dialog currently derives “No active purchases” from an empty entries array once local config loading ends. Remote loading/failure also leaves that array empty, so the message can incorrectly imply an authoritative empty purchase list. This was visible in the earlier missing-grant native screenshot alongside its failure message. The subsequent section records the fix and its verification boundaries.

## Purchase-list state truthfulness and retry

The modal previously treated its initial empty entries array as a successful empty remote response as soon as local configuration finished loading. Pending and failed remote requests therefore produced a false “No active purchases” message. Purchase reads now own explicit loading/failed/ready states; only ready can render an empty purchase result. A failed read exposes a localized retry that reloads purchases only, retaining local configuration and disconnect access. Effect cleanup rejects responses for an old connection or superseded retry. No timer, automatic retry loop or extra mount request was added. Chinese/Traditional Chinese listing labels in this dialog are translated as 服务/服務.

Verification so far: `pnpm run test src/features/MarketConnect/ConnectionDialog.test.ts src/features/MarketConnect/ConnectionRecovery.test.ts` passed 14 tests across 2 files, and `pnpm typecheck:fast` passed. Rendered tests distinguish failed/pending/successfully empty, retain disconnect in all three, exercise failed→manual retry→pending→empty without another local-config read, and reject an old workspace's late purchase response. New messages are present in all 13 locale files. The updated unsigned macOS acceptance bundle built successfully. Native computer use opened the retained missing-grant Codex fixture: it showed the localized purchase-read failure and Retry, with Disconnect/Close enabled and Configure disabled. Clicking Retry returned to the same correct failure state; no false empty-purchases message appeared. The Chinese 服务 label and layout were visually inspected, then Escape closed the modal with the connection retained. This is actual failed-read/retry UI evidence, not successful live purchases, grant renewal or provider/payment acceptance. Successfully empty and delayed/stale responses remain rendered RPC-fixture coverage.

Performance scope: one demand-driven purchase effect per open/connection/retry, no polling or new cache; the existing cleanup guard discards late results. RPC cancellation and full hidden/visible/multi-instance CPU/RSS remain unmeasured and are not claimed as passing runtime performance acceptance.

## Purchased Skill access in normal sessions

Follow-up tracing found that opening a purchased model session did not attach the purchased Skill server. The former harness command handled this separately. The native dynamic-source contract now optionally supplies an MCP endpoint, and Market resolves its workspace endpoint from the validated source selection. Normal session execution merges this server through the existing MCP configuration and Agent policy owner. It preserves other servers, rejects a reserved-name conflict or policy exclusion, and uses the existing owner-only Claude/Codex configuration files or in-memory Codex app-server configuration. No additional shell command, downloaded package, or renderer-visible Market credential is introduced.

The local POST relay accepts only an active execution capability for the selected engine, rejects browser Origin requests, refreshes authorization in native code, and rechecks route ownership after refresh. It does not forward client cookies, upstream error bodies, redirects, or server-originated MCP requests. Request/response frames are bounded at 2 MiB and upstream requests have a 60-second timeout without automatic retries. Session teardown releases the local capability through the existing execution owner. A single shared HTTP client is retained; there is no background polling or per-session listener. In-flight work already dispatched before teardown is not claimed to be remotely canceled.

Current-source verification: `cargo test --manifest-path src-tauri/Cargo.toml --lib cli_managed_proxy:: -- --nocapture` passed 16 tests; `cargo test --manifest-path src-tauri/Cargo.toml --lib mcp_inject:: -- --nocapture` passed 14; `cargo test --manifest-path src-tauri/Cargo.toml --lib market_connection::` passed 11. The relay test uses actual HTTP listeners and a mock upstream, verifying changed upstream credentials, engine/capability isolation, rejected server requests, notifications and post-release rejection. Configuration tests cover all three native transports, policy conflicts, secret redaction and owner-only temporary-file cleanup. `cargo clippy --manifest-path src-tauri/Cargo.toml --lib -- -D warnings` also passed. These do not constitute actual provider or desktop Skill execution.

Remaining after the initial relay commit (terminal integration is addressed below): MCP prompt/tool availability does not prove that a client automatically applies purchased instructions. Real purchased Skill discovery/use, metered model work, receipt attribution, refresh and restart must be accepted together before opening the website's ORG2 button. The running unsigned acceptance app predates this relay change; signed main-app and Windows acceptance remain open. No schema or stored-grant change is introduced. Reverting this change removes Skill access from these sessions while preserving their histories and grants.

## ORG2 normal workspace session entry

The ORG2 authorization target now opens its own session dialog. App connections includes an ORG2 selector to reopen saved grants without displaying the external-client global profile editor. The dialog selects an authoritative purchased service and an engine/model pair, asks for a local folder, checks that the engine is installed, and uses the existing normal `sessionLaunch` plus exact-id hydration and ChatPanel tab navigation. It sends empty content, so the native CLI bridge creates a persisted session without starting a model turn. It does not ask the user to run a command, download login JSON, or change global client configuration. A hydration retry reuses the session already created in that dialog; unmount before native creation stops further launch work. A session created before unmount remains persisted, rather than deleting user history.

The new `market_connection_prepare_session` IPC returns only a public source selection after native validation of ORG2 target, exact entitlement, active status/expiry and the selected engine's model list. It does not trust a model's name/prefix or the unscoped models list. The server still enforces purchase authorization at request time; this preparatory read does not replace that enforcement. Older native binaries lack the new IPC and cannot run this new UI path. Module-off returns unavailable. No storage schema change is introduced; rollback should retain any newly created session sources and histories and requires a client version capable of resuming them.

ORG2 grants can mint both Claude and Codex credentials. The native source now accepts these two engines for that target and keys cached credentials by engine plus serialized identity/workspace/target/purchase selection. Both protocol entries count separately toward the existing 32-selection cap. Existing per-owner serialization and authorization mutation barriers remain. A failed refresh returns an error instead of an expired token; it neither invalidates nor replaces the other engine's credential. Codex retains `/v1` for both cached and freshly minted credentials.

Architecture review covered compilation, ownership/duplication, naming, selection semantics, unsupported defaults, module composition, UI entry discoverability, IPC compatibility, settings/deep-link parity, and engine-specific resolution. Generic session/config crates gain no Market dependency. Resource review: demand-driven reads only, no new timer/polling; component cleanup ignores late reads; launch guard prevents simultaneous starts; owner cache retains its bound/retirement path. Actual visible/hidden CPU/RSS and signed main-app lifecycle remain unmeasured, so there is no runtime performance claim. Controls use shared Modal, Button, Select and segmented selector; existing translated labels are reused, with ORG2/Claude Code/Codex as product names.

Verification for this follow-up: `cargo test --manifest-path src-tauri/Cargo.toml --lib market_connection:: -- --nocapture` passed 11 tests. The native tests cover engine-separated credential fetch/hits/refresh/failure, purchase capability rejection, and existing concurrency/cleanup cases; they do not contact a real provider. `pnpm run test src/features/MarketConnect/Org2SessionDialog.test.ts src/features/MarketConnect/ConnectionRecovery.test.ts src/features/MarketConnect/ConnectionSettings.test.ts src/modules/MainApp/Settings/sections/HarnessConnections/HarnessConnectionsSection.test.ts` passed 17 tests across four files after the empty-state follow-up. The new dialog's native RPC/session calls are mocked, including Claude/Codex model selection, empty normal-session launch, canceled picker, missing engine, authorization rejection, same-session hydration retry, unmount and offline disconnect. Typecheck, scoped ESLint and strict `cargo clippy --manifest-path src-tauri/Cargo.toml --lib -- -D warnings` passed. The unsigned macOS desktop bundle built. Native computer use selected ORG2 in App connections, opened its real dialog, inspected the Chinese fields and failure state, then disconnected a synthetic missing-grant ORG2 record. File readback confirmed that the ORG2 fixture was removed and the Codex fixture remained. This did not authorize a real grant or open a successful purchased session. Real authorization, requests, receipts, renewal and restart/resume remain open.

The native check exposed an empty ORG2 settings surface after disconnecting the last record. The UI now explains how to connect a workspace from Market, or explicitly states that the module is unavailable. Both messages exist in all 13 locales. Rendered settings tests cover enabled-empty and disabled-module states. The changed frontend was rebuilt successfully with the same unsigned acceptance command. A second native computer-use check navigated Settings → App connections → ORG2 and confirmed the Chinese empty-state guidance; its layout was visually inspected in a screenshot. Module-off text remains rendered mocked-status evidence, not a module-off native runtime check. Shared Modal still exposes an English accessibility close label; that shared i18n issue remains outside this follow-up and is retained for the wider i18n audit.

## Purchased Skill access from external terminals

The terminal launch owner now uses the same MCP resolver and serializers as normal sessions. The existing implementation moved from `session_runner/session/mcp_inject.rs` to `agent_sessions/cli/mcp_config.rs`; there is no second configuration parser or Agent-policy implementation. Market-enabled Claude Code receives a strict owner-only MCP file; Codex receives a non-secret profile name pointing at an owner-only configuration layer. Only paths and the profile name reach renderer-visible launch arguments. User MCP servers remain governed by the same merged workspace configuration and Agent restrictions.

Temporary-file guards attach to the existing bounded live-route registry. Terminal close, deletion or route release drops them, retaining native histories. A preparation failure removes only owned launch configuration; a race that loses the route drops unadopted MCP files. File cleanup occurs after releasing the route-registry mutex. No extra listener, polling task, persistent credential format or independent session registry is added. App crashes can leave temporary local-capability files; the old capability is unusable after process restart, but this is not a claim of crash-time disk cleanup.

Verification: the proxy scope passed 17 tests including the new real-file Claude/Codex ownership regression, and the moved MCP configuration scope passed 14 tests. The final current-source proxy run again passed all 17 tests, and strict library Clippy passed. The lifecycle regression checks 0600 permissions on Unix, no local credential in args/env, successful route attachment, route release, retained history and a failed late attachment. Actual installed Codex read a synthetic `<name>.config.toml` through `--profile` and listed `org2_market` as streamable HTTP with bearer authorization. Actual installed Claude Code started with `--mcp-config <file> --strict-mcp-config --no-session-persistence --model claude-sonnet-4-5 --max-turns 1 --print "Reply OK"` against isolated mock MCP/provider endpoints: observed initialize, initialized notification, tools/list and prompts/list, and the CLI exited 0 with OK. This test used only synthetic credentials and local endpoints, not a purchased grant or live billing. A preliminary `claude mcp list` attempt was unsuitable: command management does not inspect the per-run MCP set; it is not counted as acceptance.

Still open: actual normal-app browser handoff through terminal creation and Skill invocation; purchased instructions automatically taking effect; live model/Skill receipt attribution and refresh; Windows runtime; signed release/rollout. Configuration discovery and a mocked provider response do not satisfy these gates. The website ORG2 button remains gated. Rollback removes terminal Skill injection while preserving launch histories, grants and user configuration.

## Canonical send admission follow-up

The rebuilt unsigned desktop app exposed an additional gap after persisted source hydration: a valid Market Codex target reached ChatPanel, but `canonicalConversationTargetOrThrow` still required an ordinary `accountId`, producing “Select a model and source before continuing this conversation” before native credential validation. The authoritative persisted source was retained; the duplicate submission validator was stale.

Submission now uses the existing `isLocalConversationTarget` contract shared with durable queue restoration. Valid Claude/Codex dynamic sources pass without an account ID; empty/untrimmed sources, mixed account ownership, missing models and unsupported engines are rejected before queue admission. Normal submit, failed-turn retry and dispatch replacement preserve the exact source. This adds no alternate execution path, network call, timer, cache or credential fallback; cloud root identity binding remains unchanged.

Verification: 24 submit/domain tests and 147 Market UI, target selection, continuation and session hydration tests passed (171 total), plus frontend typecheck and scoped ESLint. The UI reproduction uses a synthetic local session and deliberately missing grant; it is not a real purchase, provider request or payment test. An initial fixture used a noncanonical session-ID prefix; that fixture was corrected before reproducing the account-ID validation failure and is not reported as a product defect.

## Native project catalog ownership follow-up

The unsigned native rebuild passed and computer-use submission reached the runner. It then failed at Codex `thread/start` with “project not found”. Tracing the real runner showed project registration still used the default native catalog, while the managed process used its session-owned CODEX_HOME/SQLite store. The new project therefore did not exist in the executing catalog. This is a product ownership mismatch, independent of the synthetic missing-grant fixture.

Project registration now shares the exact resolved native store path used to launch app-server. The ordinary account path remains the existing native catalog; managed Market sessions use their owned home for both operations. Resume registration remains unchanged. No database migration, deletion, background work or new cache is introduced. Architecture review covered the affected ownership, resolver symmetry and fresh/resume initialization paths; this is not a new audit of unrelated subsystems.

Native verification: rebuilt the unsigned macOS acceptance bundle, restarted its disposable profile, opened the persisted Market session and exercised retry/new submission with computer use. The new request passed project registration and reached the local Codex proxy, which rejected the deliberately missing grant with HTTP 412 `credential_store_read_failed`. This confirms the project-catalog mismatch no longer blocks this request and missing credentials do not fall back to an ordinary account. It does not prove a successful provider call. The failed-turn retry initially left the old error visible; a subsequent new submission reached the proxy, so standalone retry acceptance remains open. The resulting raw English proxy error still needs localized reauthorization guidance and sanitized presentation. No production release or real-money operation occurred.

## Market error recovery and proxy-capability redaction

The native missing-grant request exposed two remaining user-facing problems: Codex echoed its session-local proxy capability in the URL of its error, and the generic error card offered no Market recovery action. The producing parser now applies the shared native secret redactor before forming canonical error chunks/state; the terminal redactor recognizes the managed route capability, and retry logging uses the canonicalized message. A frontend redactor additionally protects historical error display without rewriting or deleting stored history. This does not claim removal of older secrets from historical records or Codex-owned transcripts. Released session capabilities are invalidated by the existing route owner.

The error card derives recovery only from validated, bounded, persisted Market selection metadata. Known native credential-store/reauthorization errors offer the existing browser authorization flow for that workspace and target. Other Market failures offer connection management, preserving the error and avoiding unnecessary authorization on rate limits or transport failures. A Market source never routes recovery to an ordinary Codex account. No URL or destination is taken from upstream error text. Existing translations and PageNotice's shared Button provide the UI; no new raw production controls or locale keys were added.

Verification so far: 90 focused frontend regression tests passed, including rendered action selection/destination, invalid source rejection and historical token redaction; frontend typecheck and scoped ESLint passed. New native coverage exercises a Codex error notification followed by failed-turn completion, requiring both emitted chunks and retained parser error state to omit the capability. Native and desktop results follow when complete.

Architecture/performance scope: shared error normalization is the producing boundary; display cleanup is defense in depth for older data. Source decoding is capped at 1024 characters and runs only on error cards. Regex compilation remains in the existing OnceLock. No streaming-delta processing, subscriptions, polling, network retries, credential storage, schema or configuration lifecycle is added. The broader release gates remain open.

Native focused results: the new Codex notification-to-error-state regression passed (1 test, none skipped); terminal redaction suite passed all 7 tests, including both Claude/Codex capability paths and preservation of protocol paths. These tests use synthetic capabilities and do not read user credentials.

Broader Codex parser regression: 33 passed, 3 ignored. The ignored opt-in installed-client tests are not counted as acceptance evidence; the new error/capability test ran and passed.

Final frontend regression after malformed-source hardening: 91 passed. An invalid persisted dynamic source does not fall back to ordinary Codex reauthentication even if an upstream error contains Codex login keywords.

Native computer use on the rebuilt bundle confirmed the Chinese Market recovery message and Reauthorize button on the existing failed session. A subsequent missing-grant request exposed a second path: provider-owned history replayed an older proxy failure as ordinary assistant content, bypassing the error-card presentation. The old capability was in the Codex-owned rollout; original native files are not rewritten by this work. The shared CLI history normalization boundary now redacts proxy-bearing string payloads before producing canonical events for paged reads/full exports. This preserves source history while preventing that capability from being re-exposed by ORG2 history projection. A producing-boundary regression covers replayed assistant error text. No history deletion or retrospective claim about provider-owned files is made.

History verification: the new replayed-assistant-error projection regression passed (1 test), and the existing 128-turn managed native preview/older-body retrieval regression passed (1 test), both with zero ignored. The latter covers both native providers and verifies retained history/window behavior after the redaction pass. The new history boundary has not yet been rechecked in the rebuilt desktop app at this point in the record.

Final native history acceptance: the final unsigned bundle rebuilt and restarted against the same disposable profile. Computer use reopened the existing session; the formerly raw assistant-message proxy URL now showed the shared redaction placeholder, and the Market failure card retained its Chinese guidance and Reauthorize action. The previous screenshot/UI state revealed the gap; this final state verifies the corrected native history path. No live authorization button was submitted for the synthetic workspace, and no real model/payment success is claimed. Repository commit checks passed TypeScript and scoped Clippy for org2 and terminal.

## Unavailable-module startup recovery follow-up

The host previously started the managed proxy for any active profile, even when its dynamic credential module was absent after an unclean exit. Startup now reuses the existing non-forcing restoration transaction before deciding whether a proxy is required. Source registration runs in bootstrap before the setup hook. Static selections and available modules remain selected; registry errors and external file edits retain the configuration for retry. This introduces one bounded blocking startup job, no timer or polling, and no Market dependency in the generic configuration crate. History, Keychain grants and connection indexes are not deleted.

Verification: `CARGO_TARGET_DIR=<temporary-target-dir> cargo test -p agent_cli --lib` from `src-tauri` passed all 89 tests. The new producing-boundary regression exercises unmatched selections, registry failure, externally edited configuration, successful retry, repeated restoration and preservation of a history file. `git diff --check` passed. The initial host check failed because this new worktree lacked the existing process-manager sidecar; the existing locally built sidecar was linked for the subsequent check, with no tracked binary changes.

This is a configuration recovery change, not proof of native module-off runtime acceptance or authorization revocation. Real crash/restart, OS Keychain failure, complete provider billing/renewal, signed application and Windows acceptance remain open. Rollback preserves the manifest format and restores the prior startup behavior; it must not delete native histories or user-edited files.

Host compilation: `cargo check --manifest-path src-tauri/Cargo.toml --lib` passed, and the same command with `--no-default-features` passed with three unused-code warnings in optional-module code. Both used the shared `CARGO_TARGET_DIR` shown above. No native module-off runtime claim follows from compilation.

| Area               | Verdict | Evidence                                                             | Change or reason kept                                                              | Verification                                                    |
| ------------------ | ------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Background work    | fix     | setup schedules one blocking job after source registration           | reuse fixed adapter registry and existing file transaction locks; no polling       | host compile; configuration regression                          |
| Memory             | keep    | only existing bounded adapter/source registries and a per-run report | no retained queue or cache introduced                                              | source inspection; runtime RSS not measured                     |
| Scope/isolation    | fix     | manifest selection namespace is compared with registered owners      | available/static sources retained; mismatch recovery does not force external edits | 89 configuration tests; registry regression recorded separately |
| Rendering/hot path | keep    | no renderer or request-path change                                   | startup only                                                                       | source inspection                                               |

Performance verdict: blocked — native module-off crash/restart timing, CPU/RSS and visible recovery have not yet been measured. This does not block continued implementation/testing; it blocks a performance acceptance claim.

Registry verification: `cargo test --manifest-path src-tauri/Cargo.toml --lib dynamic_credentials::startup_recovery_tests -- --nocapture` with the shared target directory passed 1 test. It checks static keys, absent selections, unavailable namespaces and an available registered source, without performing network or credential-store calls.

# Token Monitor vs ORGII: Quotas, Usage, Caches, and a NO-SPIKES Plan

Date: 2026-07-31

## Executive verdict

Coverage is not complete, but the boundaries are clear:

- Token Monitor supports 19 quota providers. After this pass, ORGII can refresh 12 directly, leaving 7.
- Token Monitor supports 21 usage clients (20 by default, MiMo opt-in). ORGII has real transcript importers for 11 of them and six additional sources absent from Token Monitor. Antigravity remains a hook/source identity in ORGII, not a history importer.
- ORGII has stronger persistence, paged snapshots, parser-version invalidation, last-good handling, and Cursor WAL awareness.
- Token Monitor's provider breadth, today-delta anchors, watch-root choices, and isolation of self-written sync caches are useful patterns.
- Its cold-start sequence of three subprocesses for today/month/all-time, recursive discovery, full message-cache loads, and global five-minute refresh timer would create CPU, RAM, and I/O spikes if copied directly.

This pass added quotas for DeepSeek, OpenRouter, MiniMax, ZAI Team, Qoder, and Kimi Code; added Pi, Qwen, and Kimi/Kimi Code importers; changed Cursor billing to streaming aggregation and bounded paging; and established fixed seam watermarks for JSONL importers. New paths are demand driven, without new intervals, permanent watchers, or background workers.

The work was split by responsibility:

- [PR #611: bounded external quota and usage sync](https://github.com/org2AI/ORG2/pull/611) (Ready, all CI green)
- [PR #614: bounded history sync and SQL pushdown](https://github.com/org2AI/ORG2/pull/614) (Ready, all CI green)
- [PR #615: bounded ZAI Team limits](https://github.com/org2AI/ORG2/pull/615) (Draft, stacked on #611, check passed)
- [PR #616: bounded Qoder credits](https://github.com/org2AI/ORG2/pull/616) (Draft, stacked on #615, check passed)
- [PR #618: stream and page Cursor billing usage](https://github.com/org2AI/ORG2/pull/618) (Draft, stacked on #611, check passed)
- [PR #619: resume JSONL from bounded seams](https://github.com/org2AI/ORG2/pull/619) (Draft, stacked on #614, check passed)
- [PR #620: incremental Pi history importer](https://github.com/org2AI/ORG2/pull/620) (Draft, stacked on #619, check passed)
- [PR #622: bounded Kimi Code quota](https://github.com/org2AI/ORG2/pull/622) (Draft, stacked on #616, check passed)
- [PR #623: incremental Qwen history importer](https://github.com/org2AI/ORG2/pull/623) (Draft, stacked on #620)
- [PR #625: incremental Kimi/Kimi Code history importer](https://github.com/org2AI/ORG2/pull/625) (Draft, stacked on #623, check passed)

## Coverage scorecard

### Quota and limits

| Status | Providers |
| --- | --- |
| Supported by ORGII (12/19) | Claude OAuth, Codex OAuth, OpenCode Go, Cursor, Copilot, ZAI/GLM, DeepSeek, OpenRouter, MiniMax, ZAI Team, Qoder, Kimi Code |
| Not yet supported (7/19) | Antigravity, Grok, MiMo, Kiro, Volcengine, Ollama Cloud, third-party/NewAPI |

### Usage and history

Token Monitor's 21 clients: `claude`, `codex`, `opencode`, `hermes`, `openclaw`, `cursor`, `antigravity`, `cline`, `kimi`, `qwen`, `grok`, `copilot`, `pi`, `zed`, `kilocode`, `micode`, `zcode`, `kiro`, `codebuddy`, `workbuddy`, `proma`.

ORGII's 18 importer sources: `claude_code`, `codex`, `cursor_cli`, `cursor_ide`, `opencode`, `cline`, `windsurf`, `warp`, `trae`, `zcode`, `qoder`, `qoder_cli`, `mimo_code`, `omp`, `pi`, `qwen_code`, `kimi`, `workbuddy`.

The counts alone are misleading. ORGII separates Cursor CLI and Cursor IDE, while Token Monitor has one Cursor client. Windsurf, Warp, Trae, Qoder, Qoder CLI, and OMP are additional ORGII coverage. ORGII's WorkBuddy path mixes in some CodeBuddy semantics but is not complete CodeBuddy support. Antigravity metadata is only a runtime/hook identity, not a usage importer.

## NO-SPIKES hard constraints

Every new source or provider must satisfy these constraints:

| Dimension | Constraint |
| --- | --- |
| Idle CPU | No interval scan, directory polling, or periodic subprocess; near-zero work without events. |
| Hidden window | Hidden state does not start network or scans; reset refresh runs only while visible. |
| Network fan-out | At most three process-wide provider refreshes; single-flight per account. |
| HTTP memory | Stream ordinary quota responses and reject before the body grows beyond 1 MiB. |
| Cache state | At most 256 quota account lanes; five-minute success TTL and 15-second failure cooldown. |
| Retry | At most one transient retry; wait at most five seconds for `Retry-After`. |
| History work | Single-flight per source; continuation pages do not rediscover or rescan. |
| SQLite | Push source/session/time conditions into SQL instead of loading lifetime rows into Rust for filtering. |
| File import | Stat/snapshot first, then increment by byte watermark; rebuild one file only on rotation/truncation. |
| Failure | Keep last-good; an old generation cannot overwrite new credentials or a new scan. |
| Self-sync data | Never include Cursor/Antigravity self-written caches in watcher roots. |
| Large export | Write HTTP chunks directly to a private staging file; do not retain an event Vec for aggregates; page at most 200 events at a time. |
| Local scans | Hard limits on directories, entries, files, parser state, and line length; deny symlink traversal by default. |

Cursor billing no longer holds three large objects at once: HTTP chunks go to a private staged CSV, summaries accumulate row by row, and RPC returns only aggregates. Details are read through snapshot-bound pages. Export remains explicit because a 64 MiB raw export is still substantial I/O and does not belong on a dashboard interval.

## Comparison of all 19 quota providers

| Provider | Token Monitor approach | ORGII status | NO-SPIKES decision |
| --- | --- | --- | --- |
| Claude | OAuth usage endpoint and runtime limits cache | Existing OAuth quota | Keep ORGII runtime; no five-minute timer. |
| Codex | OAuth usage/rate limits | Existing OAuth quota | Keep credential-revision generation guard. |
| OpenCode | Go subscription/cookie | Existing | Keep stored-account refresh. |
| Cursor | Dashboard/API quota | Existing; separate streaming billing CSV aggregate/page | Quota may auto-refresh; billing export remains explicit, global concurrency one. |
| Copilot | GitHub/Copilot entitlement | Existing | Demand driven within the global concurrency limit of three. |
| ZAI/GLM | API quota windows | Existing | Saved key determines region/base URL. |
| DeepSeek | One GET to `/user/balance` | Added in this pass | Show exact amount/currency, not a fabricated percentage. |
| OpenRouter | Two requests to `/api/v1/key` and `/credits` | Only `/api/v1/key` used in this pass | Compute a meter with a hard limit; otherwise show Pay-as-you-go and save the second request. |
| MiniMax | May try old/new routes and regions repeatedly | Added in this pass | Lock region from saved base URL; normally one request, at most two with narrow same-region compatibility fallback. |
| ZAI Team | One GET in China region; key, org, project required | Added in this pass | Fixed endpoint; org/project in credential revision; one steady-state request, no retry. |
| Kimi | Multiple Coding API and web membership paths | Kimi Code added in this pass | Accept only an explicitly saved API account fixed to `api.kimi.com/coding`; one steady-state GET, no cookie or web-membership probing. |
| Qoder | Usage endpoint, possibly followed by plan | Added in this pass | Fixed cookie/region; usage first, serial plan fallback only if label missing; at most two requests. |
| Ollama Cloud | Session cookie fetches settings HTML | Missing | Refresh only after explicit connection; do not scan browser cookies. |
| MiMo | Web cookie/API with multiple managed accounts | Missing | Start with one saved account; do not enumerate all managed accounts on launch. |
| third-party | NewAPI account/token/custom balance adapter | Missing | Valuable, but require scheme/host/path allowlists, a 1 MiB body limit, and redirect/SSRF denial. |
| Volcengine | AK/SK signed API with Ark probe fallback | Missing | Use only signed `GetCodingPlanUsage`; do not guess quota through chat-completion probes. |
| Grok | CLI JSON-RPC, then web gRPC fallback | Missing | Defer automatic refresh; subprocess plus fallback risks latency and CPU spikes. |
| Kiro | Runs `kiro-cli chat --no-interactive /usage` | Missing | Explicit user trigger only; a 20-second CLI timeout cannot be part of focus refresh. |
| Antigravity | Probe IDE process/port, then RPC | Missing | Separate explicit adapter with strict timeout, outside generic quota refresh. |

### Direct-quota optimizations in this pass

- Share one process-wide HTTP client with a 12-second total deadline, four-second connect deadline, at most one idle connection per host, and a 30-second idle timeout.
- Reject redirects so bearer credentials cannot be forwarded. Read via `response.chunk()` and enforce a 1 MiB hard cap before each growth.
- DeepSeek and OpenRouter need one steady-state request each; OpenRouter halves Token Monitor's key-plus-credits request count.
- MiniMax needs one steady-state request, at most two, without cross-region probing.
- New accounts need not already have `quota_info`: backend `can_refresh_quota` checks the provider route and required credentials, letting UI discover the first quota on focus/manual refresh without requesting incomplete accounts.
- The UI refresh pool has at most three workers; backend runtime imposes a separate process-wide limit of three.
- Focus and visibilitychange use a 50 ms one-shot coalescer; there is no mount-time network request or interval.

## The 21 usage clients: cache issues and recommendations

Token Monitor performs a full scan for today/month/all-time anchors, then uses a today-only warm watch tick and delta updates for month/all-time. It stores anchors in `collector-anchor.json`, invalidating them when the date or config fingerprint changes. It prefers native watches and switches permanently to two-second polling only by explicit configuration or after `ENOSPC`/`EMFILE`/`ENFILE`. Scans are single-flight and debounced; failures broaden to a full client refresh, with reconciliation at least hourly.

The shared cost is that tokscale usually discovers recursively and loads its entire message cache before filtering by date. Most changed JSONL files except Codex are reparsed in full. Cold start launches three serial today/month/all-time subprocesses, and subprocess stdout/stderr first accumulates in complete JS strings.

| Client | Token Monitor cache/scan | ORGII status | Recommended approach |
| --- | --- | --- | --- |
| Claude Code | Project/transcript JSONL; metadata cache and today anchor | Existing importer | Keep SQLite session cache; adapt today delta without a full subprocess. |
| Codex | JSONL; the most complete append-offset parser | Existing importer | Continue persistent incremental cache. |
| OpenCode | Shared SQLite | Existing, fixed in this pass | One grouped SQL query produces per-session signatures; unrelated writes no longer invalidate all sessions. |
| Hermes | Profile `state.db` | Missing | Manual/scheduled DB query; do not watch all of Hermes home. |
| OpenClaw | Current plus legacy JSONL roots, including archived/deleted | Missing | First version reads only current root; explicit migration for legacy. |
| Cursor | Remote sync writes CSV cache; does not watch cache root | Local CLI/IDE importers plus explicit streaming billing export | Do not add the two sources together; billing single-flight per account, five-minute TTL, failure cooldown, global concurrency one. |
| Antigravity | IDE RPC writes its own cache; CLI conversations | Hook identity only | Explicit IDE sync; do not watch self-written cache; CLI may be a separate importer. |
| Cline | VS Code globalStorage task leaves | Different Cline CLI/SQLite source in ORGII | If adding VS Code support, discover only exact `tasks/*/ui_messages.json` leaves. |
| Kimi | Legacy Kimi and Kimi Code JSONL roots; config in fingerprint | Dual-layout importer added | Share watermarks; accumulate official usage records incrementally rather than recounting `step.end`. |
| Qwen | Project JSONL; generic full-message cache | Importer added | Byte watermark and exact-depth snapshot; prefer `totalTokenCount`, then official candidates/thoughts fallback. |
| Grok | Updates JSONL dependent on signal/summary/event siblings | Missing | Stat the dependency set on session open/manual action; no permanent recursive watch. |
| Copilot | OTel JSONL, Desktop DB, VS Code chatSessions | Missing | Duplicate-count and root-count risks; explicitly import one path initially. |
| Pi | `.pi` plus `.omp` JSONL | Independent `.pi/agent/sessions` importer added; OMP stays separate | Use header ID as canonical identity and `piapp-` namespace to avoid OMP collision. |
| Zed | One `threads.db` plus WAL | Missing | Scheduled/manual SQLite scan; no parent watch. |
| Kilo Code | VS Code task leaves across platforms | Missing | Exact leaf scan, not all workspaceStorage. |
| MiMo Code | Shared DB; disabled by default to prevent Claude mirror double count | Existing provenance suppresses mirror, fixed in this pass | Per-session signature, retain provenance suppression. |
| ZCode | SQLite plus legacy JSONL | Existing SQLite, fixed in this pass | Explicit migration for legacy; unrelated writes do not invalidate cache. |
| Kiro | CLI/IDE/globalStorage/SQLite mix | Missing | High risk; explicit import only, no automatic whole-tree discovery. |
| CodeBuddy | CLI JSONL, extension, and Code logs | Some paths mixed into WorkBuddy | Split source; never permanently watch Code logs. |
| WorkBuddy | JSONL and legacy DB; suppress cumulative DB fallback when JSONL exists | JSONL only | Add session-level suppression before DB fallback. |
| Proma | JSONL, full read/split each time, maximum cumulative `message.id` | Missing | Byte watermark and bounded pricing cache; no warm full-file scan. |

### Never watch continuously

Hermes profile/home root; Copilot `workspaceStorage`; all CodeBuddy `Code/logs`; Kiro's mixed globalStorage/session tree; parent directories of shared SQLite for OpenCode, ZCode, MiMo, and Zed; Cursor/Antigravity self-written sync caches; WSL home, network drives, and removable volumes; and Proma root until watermark/rotation behavior is complete.

### Explicit trigger only

Cursor billing export sync; Antigravity IDE RPC sync; OpenClaw/ZCode legacy migration; initial import of Copilot/Kiro/CodeBuddy logs; full WSL scan; full graph/history rebuild; and Kiro/Grok/Antigravity subprocess/process-probe quota.

## Cache and query fixes in this pass

### 1. Usage dashboard: 1,003 rows reduced to two

The old path moved lifetime native rows from SQLite to Rust before filtering by source, session, and window. The new path uses a connection-local scoped-session temp table, joins scope in native/imported SQL, and pushes start/end filters into SQL. It adds the necessary composite index `(session_id, created_at, id)`. Native round IDs use stable DB row IDs; imported rounds use persistent `seq`, so a window change does not renumber them. In a regression example, only two window/source candidates out of 1,003 lifetime rows crossed into Rust. No cache, timer, worker, or background queue was added. Initial dashboard headline and default expanded trends now share one overview call; request rows remain collapsed and lazy.

### 2. OpenCode/ZCode/MiMo: unrelated sessions no longer invalidate the whole DB cache

The old signature included shared DB/WAL/SHM metadata in every session, so any write reparsed all sessions. One grouped SQL query now computes activity for all sessions from `MAX(session.time_updated, part.time_created)`, `MAX(part.rowid)`, `SUM(part.data bytes)`, and title/model/token/parent metadata. Complexity is one `O(session + part rows)` pass with `O(session)` memory, avoiding per-session queries that could degrade to `O(session × part rows)` without an index. Only activity in the target session invalidates its cache. An in-place JSON rewrite that changes no length, rowid, time, or token remains invisible; normal append/insert/provider timestamp updates are covered.

### 3. Cursor billing: streaming and pages instead of body + Vec + IPC JSON

- Write HTTP chunks directly to a private staged CSV instead of buffering a response body.
- Accumulate totals, data-quality metrics, and raw-byte counts row by row; do not materialize a full event Vec.
- Cap raw files at 64 MiB, with separate bounds for records and metadata. Reapply raw/metadata caps during archive copy so it cannot bypass download limits.
- Bind detail pages to snapshots, at most 200 events and at most 1,000 scanned rows or about 2 MiB per page.
- Alternate raw/archive slots. Apply per-account single-flight, TTL, cooldown, last-good, and credential fingerprinting.
- Reduce global export/validation concurrency from three to one.

### 4. JSONL watermarks and Pi: warm path reads only a fixed seam and delta

- A watermark stores file identity, parser version, offset, and the last 4 KiB seam. On growth of the same file, verify only the seam and continue from the offset, without rehashing historical prefix.
- Shrink, rotation, same-size mutation, parser bump, or seam mismatch cold-scans only the affected file. An unterminated tail line does not commit the offset; reject a line before it grows to 1 MiB.
- Pi discovery uses exactly two directory levels, at most 20k directories / 20k entries per directory / 20k files, and follows neither file nor directory symlinks.
- Pi parser state is bounded to 4 MiB JSON, 1,024 pending edits, and 4,096 touched files, with nonnegative token validation and saturating totals.

### 5. Qwen: exact two-level snapshot and official token semantics

- Discover only `~/.qwen/projects/<project>/chats/*.jsonl`; do not recursively scan other directories.
- Cold enumeration and warm snapshot reuse share a global 50,000-entry budget. Warm snapshots cannot evade it.
- Cap batches at 256 files / 64 MiB and a file at 64 MiB; rounds, tools, replay, and parser state each have separate hard bounds.
- On append, verify only the 4 KiB seam. Persist in order: rounds → watermark → cache signature, preventing success markers before data persistence.
- Prefer official Qwen `totalTokenCount`. If absent, use candidates when they exceed thoughts; otherwise use candidates + thoughts.
- Normalize tool responses of the form `{ "output": ... }` to text rather than presenting wrapper JSON as conversation content.

### 6. Kimi: two layouts, official usage stream, separate sync and replay

- Discover only legacy `~/.kimi/sessions/<group>/<session>/wire.jsonl` and Kimi Code `<home>/.kimi-code/sessions/<workspace>/<session>/agents/<agent>/wire.jsonl` layouts.
- Read `default_model` from current TOML and old JSON config, each capped at 64 KiB, without adding a parser dependency.
- Accumulate every nonzero `usage.record` incrementally, including turn, session, and no-scope records; do not recount duplicate `step.end`. Difference legacy cumulative status within a `message_id` only.
- Replay bounded `context.append_message` and step/content streams. Hide metadata-only rows and avoid duplicate top-level subagent sessions.
- Sync reads only the first user title rather than building replay bodies, avoiding large full-transcript strings during dashboard sync.
- Validate provider root and each parent under canonical external-history identity; reject symlink replacement of files, directories, or roots.
- Share Qwen's 50,000-entry global cold/warm snapshot budget, 256-file / 64 MiB batches, 64 MiB file limit, and bounded replay/parser state.
- ORGII deliberately does not copy Token Monitor's old turn-only rule. Current official Kimi Code folds all `usage.record`; scope only classifies turn versus session.

## Remaining hotspots

| Priority | Hotspot | Risk | Target |
| --- | --- | --- | --- |
| P0 | Member runtime repeats CPU sample and daily rollup/profile for each due org | `O(org count)` due at once can spike | One shared sample/rollup, fan out by org, stagger deadlines. |
| P0 | Key Vault refresh repeatedly reads/parses credentials JSON | Focus/manual refresh across accounts repeats file work | Store snapshot by mtime/revision, one parse shared across accounts. |
| P1 | Spotlight recent paths bypass history scan coordinator | May overlap a dashboard scan for the same source | Route all entry points through one per-source lane/generation. |
| P1 | External replay probe uses full `SUM(length(...))` | May scan accumulated data every five seconds | Maintain aggregate/version on writes for an O(1) probe. |
| P1 | Usage overview frontend in-flight map may evict an active promise when full | Duplicate backend work and more waiters | Do not evict active entries; bound/coalesce waiters. |
| P1 | First launch makes all 15 sources due immediately | Cold-start I/O burst | Demand priority, deterministic jitter, one scan worker. |
| P2 | CLI/provider detection repeated on several surfaces | Repeated stat/process work | Process-wide snapshot with event/TTL invalidation. |
| P2 | Kimi replay lacks tool result, undo/clear, and compaction semantics | Transcript is a bounded append-history view, not a complete interaction state machine | Design bounded event models separately; do not trade full materialization for fidelity. |

## Top 15 execution status

Ranked by peak reduction × coverage benefit ÷ implementation risk:

1. **Done:** Cursor billing uses streaming parse and aggregate/pages instead of large Vec and IPC payloads. To avoid a permanent DB/cache, pages stream from a bounded snapshot.
2. **Done:** JSONL directory snapshots, byte watermarks, and rotation/truncation pipeline; append verifies only a 4 KiB seam without rehashing old prefix.
3. **Partly done:** Quota runtime has credential fingerprint and generation guards; one credentials-store parse snapshot shared across accounts remains open.
4. **Open:** Member runtime shared sample/rollup/profile and staggered deadlines.
5. **Partly done:** Dashboard/history commands use the process-wide coordinator; Spotlight recent paths still need it.
6. **Open:** O(1) aggregate/version maintained when external replay is written.
7. **Open:** Prevent eviction of active usage-overview promises and bound waiters.
8. **Partly done:** Sources have single-flight and no-rescan continuation; global cold-start priority/jitter/single worker are not unified.
9. **Open:** Split WorkBuddy/CodeBuddy sources and suppress DB fallback where appropriate.
10. **Done:** ZAI Team quota with fixed endpoint, one request, and explicit org/project credentials.
11. **Done:** Kimi Code quota and Kimi/Kimi Code importer; quota has one fixed route/GET, history has two exact layouts and no whole-tree scan.
12. **Done:** Pi and Qwen importers share watermark behavior; Qwen cold/warm snapshots share a global entry budget.
13. **Deferred by user scope:** Proma importer is not designed, implemented, or scheduled in this pass.
14. **Partly done:** Qoder quota is done; Ollama quota is not connected.
15. **Open:** OpenClaw current-format and Hermes SQLite importers.

Grok, Kiro, Antigravity, mixed-source Copilot, and Volcengine probes are outside this automation batch because they entail subprocesses, process scans, multi-root discovery, multi-route fallbacks, or duplicate-count risks.

## Completed and outstanding work

### Completed

- Cursor precise billing CSV parser, data quality, account/credential isolation, atomic `0600` last-good, five-minute success/failure throttle, and up to three exports.
- Process-wide quota runtime: per-account single-flight, five-minute success TTL, 15-second failure cooldown, force, at most three concurrent requests, one transient retry, LRU 256, last-good/status, and credential generation guard.
- Direct quota wave 2 for DeepSeek, OpenRouter, and MiniMax.
- Exact monetary balance wire type/UI; unknown quota is not presented as 0%.
- Backend quota capability and first-quota discovery.
- UI refresh worker pool, focus/visibility coalescing, and visible reset-boundary one-shot.
- Process-wide history scan coordinator and generation guard.
- Unified initial usage overview.
- Usage round SQL source/session/time pushdown, stable IDs, and composite index.
- Per-session SQLite activity signatures for OpenCode, ZCode, and MiMo.
- ZAI Team single-request quota and complete org/project credential revision.
- Qoder fixed-region/cookie quota: one steady-state request and at most one serial fallback if the plan label is missing.
- Kimi Code fixed official coding-route quota: one steady-state GET, without cookie scans or web-membership fallback.
- Cursor billing streaming download, row aggregate, snapshot pages, raw/archive slots, and global concurrency one.
- Generic JSONL fixed-seam watermark, rotation/truncation/parser-version invalidation, and 1 MiB line cap.
- Pi exact two-level discovery, separate namespace, incremental cache, scan/parser hard limits, and symlink denial.
- Qwen exact two-level discovery, shared global cold/warm snapshot budget, official token fallback, and bounded replay/tool normalization.
- Dual legacy/Kimi Code layouts, official usage-record accumulation, separate sync/replay, canonical root/parent validation, and separate imported namespace.

### Outstanding

- Seven Token Monitor quota providers remain.
- Ten Token Monitor usage clients lack full importers; Proma is deferred under current user scope.
- Cursor billing is not integrated into the dashboard; even streamed, a 64 MiB raw export should remain explicit.
- Local Cursor transcripts still cannot reliably provide output/cache-read/cache-write/cost, and no safe session join key links billing to local context.
- Quota last-good/attempt freshness APIs exist, but UI does not yet show all stale/error states.
- Precise archive/invalidate behavior is not proven for every credential delete/update path.
- No live endpoint verification with real credentials.
- No WebView/runtime profile. Current performance evidence is request counts, query plans, candidate-row counts, boundary tests, and static lifecycle review.

## Verification

- Focused frontend tests: 16 passed. ESLint on #611/#614 and Cursor changes: passed.
- Complete TypeScript typecheck passed for #611/#614. #618 ran out of memory under a local 2 GiB limit; the repository's 6 GiB limit was not used, and GitHub `check` passed.
- Key Vault library: 317 passed on #611, 324 on the ZAI Team stack, and 331 on the Qoder stack. Focused direct-quota/provider/runtime/export tests passed.
- Usage dashboard: 23 passed. OpenCode/ZCode/MiMo cache invalidation: three passed. Targeted session-persistence schema/index test: passed.
- Cursor streaming/export: 13 focused tests passed; `cargo check -p org2` passed.
- JSONL watermark: nine passed. Pi: five focused tests passed. Full `orgtrack_core`: 460 passed, seven ignored.
- Qwen importer: 11 focused tests passed; snapshot nine passed, one ignored; router, desktop loader, identity, CLI contract, and 12 frontend tests passed.
- Kimi importer: 12 focused tests passed; snapshot nine passed, one ignored; router, desktop loader, identity, CLI contract, and 12 frontend tests passed.
- Focused Kimi quota/provider tests passed, covering fixed route, single request, base URL, and body/parser bounds.
- Final Cargo verification used `CARGO_BUILD_JOBS=1` throughout; compilation was not parallel.
- No full-workspace/typecheck, real-home scan, Windows-path test, or live-credential verification was run, to avoid CPU/RAM spikes; unverified paths remain in each PR's risks.
- #611/#614 were Ready with all CI passing; newer work stayed in small, single-responsibility stacked Draft PRs. GitHub checks passed for #622/#625; #623 had no published status context at the time.

## Main code locations

Token Monitor: `src/shared/clientTracking.js`, `src/shared/collector.js`, `src/shared/limitsRuntime.js`, `src/shared/limitCollector.js`, `src/shared/*Limits.js`, `tokscale@4.7.0`.

ORGII:

- `src-tauri/crates/key-vault/src/quota_runtime.rs`
- `src-tauri/crates/key-vault/src/providers/quota_http.rs`
- `src-tauri/crates/key-vault/src/providers/{deepseek,openrouter,minimax}.rs`
- `src-tauri/crates/key-vault/src/providers/{zai_team,qoder}.rs`
- `src-tauri/crates/key-vault/src/providers/kimi.rs`
- `src-tauri/crates/key-vault/src/providers/cursor/usage_export.rs`
- `src-tauri/crates/orgtrack-core/src/sources/imported_history/watermark.rs`
- `src-tauri/crates/orgtrack-core/src/sources/pi/`
- `src-tauri/crates/orgtrack-core/src/sources/qwen_code/`
- `src-tauri/crates/orgtrack-core/src/sources/kimi/`
- `src-tauri/crates/orgtrack-core/src/sources/imported_history/`
- `src-tauri/crates/orgtrack-core/src/usage_dashboard/rounds.rs`
- `src-tauri/src/orgtrack/history_scan_coordinator.rs`
- `src/engines/ChatPanel/StartPageQuotaGrid.tsx`
- `src/modules/shared/dataSource/SessionUsagePanel.tsx`

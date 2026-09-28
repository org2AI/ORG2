# Backend Architecture Audit — 2026-06-10

**Scope**: `src-tauri/src/`, `src-tauri/crates/` (43 sub-crates), `build.rs`, `proto/`, `model/`
**Constraints**: read-only; full `cargo check` not run (per `workspace_cargo_check_slow.md`, ~2m30s)
**Method**: 10-layer architecture-audit skill + anti-patterns #1–#54 sweep
**Entry-point trace starts at**: `src-tauri/src/lib.rs`, `src-tauri/src/commands/handler_list.inc` (1,159 lines / ~900 commands)

---

## Executive summary

> Top 5 (by severity):
>
> 1. **The entire `src-tauri/src/coding_agent/` tree is orphaned** — it is not declared in `lib.rs` and contains a broken `use crate::osagent::*`; reviving it would require a rewrite.
> 2. **10+ `#[tauri::command]` functions in `benchmark.rs` are unregistered in `handler_list.inc`** — the commands are unreachable from FE, although the module remains in `pub mod`.
> 3. **`ProviderConfig` has the same name but different meanings across crates** — `key-vault` and `agent-core` contain entirely different field sets.
> 4. **`extract_session_id` silently drops agent events** — in the IPC dispatch fallback path, events without a `session_id` field are dropped directly.
> 5. **One-line `unwrap_or_default` at `lib.rs:892` can delete all user file history** — one decode failure turns an empty Vec into the assumption that "all sessions are orphaned."

---

## Layer 1 — Compilation Correctness

Per memory guidance, the full `cargo check` was not run (estimated cost ~2m30s). Spot checks:

- Adding `pub mod coding_agent;` for `coding_agent/` would fail to compile (`use crate::osagent::*` and `crate::agent_core::compaction::CompactionState` paths do not exist).
- `benchmark.rs` compiles; only its commands are unregistered.

---

## Layer 2 — Dead Code / Duplication

### F-CRIT-2 Entire `src/coding_agent/` tree is orphaned

- Path: `src-tauri/src/coding_agent/{mod.rs, commands.rs, config.rs, context.rs, modes.rs, permission.rs, persistence.rs, processor.rs, question.rs, tools.rs}`
- `lib.rs:69-73` declares only `agent_sessions / api / benchmark / cursor_ide_watch / infrastructure`; it does not declare `coding_agent`.
- Contains 10+ `#[tauri::command]` functions (`coding_agent_create`, `coding_agent_send_message`, `coding_agent_permission_response`, etc.); none are referenced in `handler_list.inc`.
- Contains broken `use crate::agent_core::compaction::CompactionState;` (line 33) and `crate::osagent::providers::create_provider` (line 180); these paths do not exist in the current crate (`agent_core` has been extracted to a workspace crate; `osagent` has been renamed or removed).
- **Fix**: Check with `git log` whether it was replaced by `agent_core::state::commands::session::`; if so, remove the tree with `rm -rf`.

### F-HIGH-4 Unregistered commands in `benchmark.rs`

- Path: `src-tauri/src/benchmark.rs` (2,746 lines)
- Contains 10+ `#[tauri::command] pub async fn …` functions, including `benchmark_swe_create_session`, `benchmark_swe_run_session`, and `benchmark_terminal_create_session` (lines 331, 354, 362, 384, 402, 458, 470, 502, 642, 657, …)
- `rg "benchmark::" handler_list.inc` → 0 hits。
- **Fix**: Either a) register the commands, or b) use `git blame` to confirm they are deprecated and delete the module.

### F-HIGH-5 Five structs are defined twice in the `advanced-search` crate

- Paths: `crates/advanced-search/src/commands/stubs.rs` + `crates/advanced-search/src/tantivy_index.rs`
- `SearchHit`, `MatchingLine`, `IncrementalResult`, `TantivyIndexStats`, and `TantivyIndexInfo` are each defined in two places within the same crate.
- Directly matches anti-patterns #29 + #30.

### F-HIGH-6 Three `ApiError` definitions

- `git-api/src/types.rs` + `git-api/src/error.rs` — **conflict within the same crate**
- `api-search/src/error.rs` — third definition

### F-HIGH-7 `ProviderConfig` has different meanings across crates

- `key-vault/src/provider_config.rs:12` — `{ api_key_env_var, base_url_env_var, supports_base_url, default_base_url }`: describes "how to display provider env vars" in the FE settings UI
- `agent-core/src/core/providers/traits.rs:360` — `{ api_key, api_base, extra_headers, is_azure }`: runtime credential payload
- **Fix**: `key_vault::ProviderEnvDescriptor` + `agent_core::ProviderClientConfig`

### Info: cargo-machete allow-list covers only 3 macro-only crates

- `src-tauri/Cargo.toml:170-171` lists `agent_cli / cursor_bridge_app / db_clients`.
- In fact, ~15 crates are consumed by macros (`browser / git / lsp / perf_utils / system_services / db_browser / terminal / test_runner / mobile_remote / inbox / dev_record / key_vault / project_management / session_persistence / container / ui_indexer / file_ops / git_api / api_search`); the allow-list is incomplete, and enabling machete would produce a large amount of noise.

---

## Layer 3 — Naming Consistency

- `osagent` phantom: `coding_agent/mod.rs:180` references `crate::osagent::providers::create_provider`; the default EnvFilter at `lib.rs:476` is `app_lib::osagent=debug`.
- `AgentVariant::` has 0 hits in `src-tauri/src/`; the runtime-side rename is complete ✅.
- `agent_sessions/cli` ≠ `crates/agent-cli`: documented in memory file `workspace_agent_cli_crate_name_trap.md`.

---

## Layer 4 — Semantic Overloading (BE)

| Term        | Meanings | Main locations                                                                                                                                                                                                |
| ----------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `session`   | **8**  | CLI subprocess / Rust agent / IPC subscription / PTY / LSP / wingman / cursor-bridge / browser webview                                                                                                        |
| `agent`     | **8**  | `AgentDefinition` (config) / `ResolvedAgent` (runtime) / `AgentAppState` (Tauri singleton) / `AgentSession` (`session_runtime.rs:105`) / `AgentRunTarget` / "CLI agent" subprocess / `AgentKind` enum / `AgentOrg` |
| `gateway`   | 4      | `agent_core::integrations::gateway::commands::gateway_start` / Azure-OpenAI as gateway / `bin-gateway-chat-cli` / gateway in mobile-remote-relay                                                              |
| `provider`  | 4      | `LLMProvider` trait / `ProviderConfig` ×2 / `key_vault::provider_config` / `rustls::default_provider`（TLS）                                                                                                 |
| `runtime`   | 4      | `coding_agent::SessionRuntime` (dead) / `tokio::runtime::Runtime` / "CLI runtime" / `tauri::async_runtime`                                                                                                   |
| `config`    | 6+     | `CodingAgentConfig` (dead) / `CodingAgentSession` config / `IntegrationsConfig` (disk JSON) / `agent_core::config::*` / `ResolvedAgent` ("config") / `handler_list.inc` docs call it "command list config"    |
| `manager`   | 8      | `QuestionManager / PermissionManager / RepoWatchManager / LspManager / McpManager / IndexManager / BridgeSupervisor / SessionStoreManager`                                                                   |
| `handler`   | 6      | `websocket_handler.rs` (filename) / `handle_socket` (axum) / `handler_list.inc` (Tauri commands) / `mobile_remote_host` / `MemberShutdownHook` / `channel_handler/`                                            |
| `broadcast` | 4      | `websocket_handler::broadcast` (actually dispatches to channels) / `tokio::sync::broadcast::channel` / `git::hooks::register_websocket_broadcast` / `agent_core::bus::broadcast_event`                          |
| `bridge`    | 6      | `agent_core_bridge` ×3 / `git_api::lineage_bridge` / `session_bridge` / `cursor_bridge`                                                                                                                      |

---

## Layer 5 — Default Branches (Production)

There are ~90 `_ =>` matches in total. Most match `serde_json::Value` (safe — Value is sealed) or error strings (return Err). The following need review:

### F-HIGH-10 `extractors.rs:341` swallows new `EventDisplayVariant` variants

- Path: `agent_sessions/event_pipeline/extractors/extractors.rs:321-342`
- `match event.display_variant { Thinking|Message|Session|ToolCall|Error => …, _ => None }`
- After a new variant is added, FE receives `extracted: None` and renders raw JSON.
- **Fix**: Remove `_ =>` and let the compiler enforce exhaustive matching.
- **Sweep**: This file contains 6 `_ =>` branches (lines 72, 341, 929, 1143, 1491, 1558); make all of them exhaustive.

### Medium: `websocket_handler.rs:252 _ => /* Ignore */`

- The current `axum::extract::ws::Message` match is exhaustive and safe. The comment accurately describes it.

---

## Layer 6 — Cross-Domain Leakage

### Medium: Variant-specific literals referenced inside `agent-core`

- `crates/agent-core/src/core/definitions/prefix_lookup.rs:136, 169` — `sdeagent-` literal
- `crates/agent-core/src/core/session/session_id.rs:29` — session ID prefix
- `crates/agent-core/src/state/commands/channel_handler/slash.rs:168`
- `crates/agent-core/src/integrations/gateway/commands.rs:154`
- `crates/agent-core/src/core/providers/cursor_native/provider.rs:2009-2011` — provider-specific user agent
- `crates/agent-core/src/core/tools/impls/coding/manage_todo.rs:560`
- **Fix**: Lift these to `core-types::session` (memory says this has partly begun).
- **Sweep**: 11 literals.

---

## Layer 7 — New-Developer Confusion

1. `cli_agent_create` (`cli/commands.rs:42`) has signature `mut CreateCodeSessionParams → CodeSession`, but its body forks a subprocess, creates a worktree, and writes 3 tables. The `mut` hints at in-place mutation, which is difficult to infer from the signature.
2. `websocket_handler::broadcast` (`api/websocket_handler.rs:284`) — both the function and file names are "misleading"; its main role is per-session IPC channel dispatch. Consider renaming it to `dispatch_session_event` while retaining a backward-compatible `pub use`.
3. `app_lib::run()` (`lib.rs`) contains 712 lines of synchronous setup and 12 `register_*` IoC calls (lines 387–441). Ordering constraints are outside the type system and documented only in comments (lines 426–430 warn that `register_session_event_extractor` must run before the first event ingest).

---

## Layer 8 — Wire Protocol

- 17 schemars `derive(JsonSchema)` occurrences; no `SchemaSettings::openapi3()` (anti-pattern #7 avoided ✅).
- `extract_session_id` fallback: dispatch fails for events in `websocket_handler.rs` that lack a `session_id` field. Audit each event to determine whether the field is always present. **Needs deeper investigation**.

---

## Layer 9 — Initialization Parity

| Entry point                                    | Path                                                                       | Steps                                                                                     | Missing                                                                       |
| ---------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Production `SessionCreator`                    | FE `buildSessionLaunchPayload` → `session_launch_impl` → category dispatch | auto-name / key resolve / mode / IDE context / work-item / worktree / persist / broadcast | OK                                                                            |
| Tauri `cli_agent_create` (E2E only)            | `cli/commands.rs:42`                                                       | worktree, proxy allocation                                                                | No auto-name / IDE / work-item / agent-org (by design)                        |
| Resume `cli_agent_resume` (`commands.rs:592`)  | re-spawn runner                                                            | –                                                                                         | **Missing `ensure_cli_account_key_fresh`** — resume fails when Claude / Codex OAuth token expires |
| Gateway HTTP `/agent/test/*`                   | `api/agent/test/workspace.rs:205` → `session_launch_impl`                  | ✅ Shares the slow path                                                                   |
| Standalone bins                                | `bin-*`                                                                    | rustls installation and env consistency not audited                                      | **Needs deeper investigation**                                               |

### F-HIGH-1 `launch_cli_agent` silently drops fields

- `launch.rs:265-309` passes only CLI-relevant fields into `CliLaunchParams`, **dropping**: `agent_org_id`, `agent_org_member_overrides`, `apply_agent_org_member_overrides_for_future`, `work_item_id`, `agent_role`, `project_slug`, `agent_definition_id`.
- `launch_rust_agent` preserves all 7 fields → initialization parity is asymmetric.
- **Fix**: Either reject CLI + agent_org_id combinations with a typed error, or add the 7 fields to `CliLaunchParams`.

---

## Layer 10 — Resolver Symmetry

See the resolver fallback matrix in [cross-layer-audit.md](./cross-layer-audit.md). BE-specific findings:

### F-CRIT-7 Startup `unwrap_or_default` at `lib.rs:892`

- `let live = …unwrap_or_default();` — if any row in `SELECT session_id FROM agent_sessions` fails to decode, the Vec becomes empty and `prune_orphan_sessions(&[])` deletes every session as an orphan.
- **Fix**: Log and `return;` from the `Err` branch; do not run pruning.

### F-HIGH-9 Four `.expect("resolver initialized")` calls in `aggregation.rs`

- Four `.expect("agent metadata resolver initialized")` calls in `unified_stats/aggregation.rs` — anti-pattern #33. They panic if the IoC slot has not been populated.
- `.expect("WatchHandlesState mutex poisoned")` at `cursor_ide_watch.rs:82, 128, 146` — reachable poisoned-mutex paths.

---

## Sweep Table

| Pattern                                | Hits                      | Main locations                                                                                                                                                                                                                                     | Verdict                    |
| -------------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| Production `unwrap()`                  | **177**                   | Entire BE                                                                                                                                                                                                                                          | ❌ F-HIGH-8                |
| Production `expect("…must")`           | Multiple                  | `aggregation.rs`, `cursor_ide_watch.rs`, `session_runner/session.rs:1981`                                                                                                                                                                           | ❌ F-HIGH-9                |
| Production `unwrap_or_default()`        | ~95                       | Hotspots: `cli/session_runner/session.rs` (7), `extractors.rs` (~24), `git_artifacts.rs` (9), `benchmark.rs` (dead), `lib.rs:892`                                                                                                                 | ❌ F-CRIT-7 + many swallowed errors |
| `std::fs::*` in async                   | ~25                       | `agent_core_bridge.rs:168` (plan read) + `cli/session_runner/session.rs` (18)                                                                                                                                                                       | ⚠️                         |
| `.build().unwrap_or` HTTP TLS           | 0                         | TLS uses `ring` consistently (`lib.rs:450`)                                                                                                                                                                                                        | ✅                         |
| `Arc::clone(&x)` before move-closure   | 12 checked                | All justified (parent Arc reused)                                                                                                                                                                                                                   | ✅                         |
| Raw SQL concat                         | 30                        | All are error formatting via `format!("Failed to update …")`                                                                                                                                                                                       | ✅                         |
| Multi-step DB write                    | `cli/commands.rs:125-164` | Best-effort rollback exists; return value is not consumed                                                                                                                                                                                           | Low                        |
| `schemars::` / `JsonSchema`            | 17+ derives               | Default draft07                                                                                                                                                                                                                                      | ✅                         |
| `ALTER TABLE` / `legacy` / `migration` | Multiple                  | `cli/mod.rs`, `session_snapshots.rs`, `schema.rs`, `housekeeping.rs`                                                                                                                                                                                  | ❌ F-HIGH-12 (anti-pattern #43) |
| Same-named structs across crates       | 23                        | See [naming-collisions.md](./naming-collisions.md)                                                                                                                                                                                                    | ⚠️                         |
| TODO / FIXME / LEGACY / deprecated     | 37                        | Scattered; only `#[deprecated]` is at `cli/parsers/types.rs:57`                                                                                                                                                                                      | Low                        |
| Large files ≥ 1,500 lines              | **15+**                   | Largest: `cursor_native/provider.rs` 3,220, `e2e-test/agent_org.rs` 3,167, `cli/session_runner/session.rs` 2,838, `benchmark.rs` 2,746, `api/agent/test/agent_org.rs` 2,744, `inbox_drain/mod.rs` 2,330, `agent_org_runs.rs` 2,260, `prompt/sections.rs` 2,153 | ❌ F-MED-7 |
| Cancel API consistency (#50)            | 3 mechanisms              | `coding_agent::cancel_flags` (dead), `agent_session_cancel` (live), `cursor_ide_watch::CancellationToken`                                                                                                                                               | ⚠️                         |

---

## Memory File Verification (BE Perspective)

| Memory                                       | Verification                                                                                                 | Evidence |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---- |
| `workspace_cargo_check_slow.md`              | ✅ Accepted (not rerun)                                                                                       |
| `workspace_cargo_package_underscore_name.md` | ✅ ACCURATE                                                                                                  |
| `workspace_tauri_command_registration.md`    | ✅ ACCURATE — `build.rs:32-45`; confirmed Tauri is pinned to `=2.10.3`                                      |
| `workspace_agent_events_via_websocket.md`    | ✅ ACCURATE — `websocket_handler.rs:284-297` `broadcast()` calls `WS_BROADCASTER.send` + `dispatch_to_channels` |
| `workspace_two_agent_execution_paths.md`     | ✅ ACCURATE — category branch at `state/commands/session/launch.rs:118-122`                                  |
| `workspace_agent_cli_crate_name_trap.md`     | ✅ ACCURATE                                                                                                  |
| `workspace_ci_only_release.md`               | ✅ ACCURATE — `.github/workflows/` contains only `release.yaml`                                               |

---

## Major Outstanding Issues

- **Tauri command registration**: `handler_list.inc` has 1,159 lines and no structural duplicate-name check (only macro-time checking; full `cargo check -p app` is slow). Consider a build-script lint for diffing registrations.
- **Missing PR CI**: memory file `workspace_ci_only_release.md` says CI runs only on release tags. A basic CI matrix would catch 3 findings: the dead `coding_agent/` tree, unregistered `benchmark.rs`, and the `lib.rs:892` trap.
- **`infrastructure/housekeeping.rs:218-226`** drops 7 legacy KG tables with `IF EXISTS` on every startup — anti-pattern #43; record a migration version so this runs once.

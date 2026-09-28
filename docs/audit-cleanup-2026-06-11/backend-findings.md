# Backend Dead Code + Duplicate Implementations Findings (Rust / Tauri)

> Scope: `src-tauri/src/` + `src-tauri/crates/*`. The backend exploration subagent completed all 14 dimensions and delivered its findings. The version below was organized after cross-checking in the main context.

## TL;DR

- 3 genuine same-name conflicts (`ProviderConfig` / `ConflictResolution` enum / `TantivyIndexInfo` field width)
- 1 misuse of `ResolvedAgent::resolve()` on a production path (CLI session runner only reads `.skills`)
- 1 severe cross-domain config (`IntegrationsConfig` puts embedding + excluded_skills + Smithery key + channels + databases in one struct)
- 1 partially broken init parity (`channel_handler/dispatch.rs:253` only calls `register_session`, not `ensure_session_initialized`)
- **`.expect()` on fallback paths are actually handled well** (nearly all are in `#[cfg(test)]` or have no failure path for string serialization)
- **No wire-protocol bloat** (`schemars` is only used for LLM tool params, not across IPC)

## 1. Tauri command registration matrix

- `src-tauri/src/commands/handler_list.inc` has **~915** registrations (1149 lines minus comments/blank lines).
- A sample check found **>250** `#[tauri::command]` declarations in total.

**All sampled registration → implementation mappings were confirmed** (debug_seed_learning / debug_memory_prefetch_section / 8 session debug commands / 22 advanced_search commands / session_trigger_reflection).

**Functions exist but are not registered (potential dead commands) — follow-up verification needed**:

| Function location | Risk |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `agent-core/src/foundation/utils/shell_commands.rs:14, 25` | Registration path is `agent_core::utils::shell_commands::*`, while the module names differ (`utils` vs `foundation::utils`) — is there a re-export chain? |
| `agent-core/src/foundation/persistence/db_helpers/mod.rs:41` | The entire file does not appear in `handler_list.inc` — ⚠️ suspected dead command |
| 3 `#[tauri::command]`s at `src/api/agent/mod.rs:14, 21, 26` | `handler_list` only shows the `api::agent::test::core::debug*\*` series; no top-level `mod.rs` entries — ⚠️ suspected dead command |

**Declared retired (as expected)**: `start_kiro_sso_login` / `cancel_kiro_sso_login` are in `.archive/`; `builtin_simulator_app_map` / `cli_tool_alias_map` were replaced by `init_tool_registry`.

## 2. Same-name structs / enums across modules

| Name | Occurrences | Field sets | Severity |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **`ProviderConfig`** | `key-vault/src/provider_config.rs:12` (`api_key_env_var`/`base_url_env_var`/`supports_base_url`/`default_base_url` — frontend env-var descriptor) vs `agent-core/src/core/providers/traits.rs:360` (`api_key`/`api_base`/`extra_headers`/`is_azure` — runtime connection parameters) | No overlap at all | 🚩 Genuine conflict; both pass through Serde. Suggested names: `KeyVaultProviderConfig` + `LlmConnectionConfig` |
| **`ConflictResolution` enum** | `sync/adapter.rs:147` (`KeepLocal/UseRemote/Merge` — resolver decision) vs `sync/conflict_log.rs:125` (`UseLocal/UseRemote/Dismissed` — user UI choice) | Different variant sets; both use Serde `rename_all="snake_case"` | 🚩 Genuine conflict in the same crate; suggested names: `AdapterResolverVerdict` + `UserConflictChoice` |
| `TantivyIndexStats` / `TantivyIndexInfo` / `SearchHit` / `MatchingLine` / `IncrementalResult` | `advanced-search/src/commands/stubs.rs:21-72` vs `advanced-search/src/tantivy_index.rs:654-692` | Stub `TantivyIndexStats { files_indexed, total_bytes, duration_ms }` vs real `{ files_indexed, files_failed, total_files, languages }`; `TantivyIndexInfo.index_size_bytes` is `u64` (stub) vs `usize` (real) | ⚠️ Mutually exclusive under feature flag `semantic-search`, but wire shapes differ; frontend Zod schema differs between release/debug |
| `McpServerConfig` | `agent-core/src/specialization/mcp/config.rs:23` | A single definition is passed through `use` at ~10 sites | ✅ No conflict |

**`Manager` / `State` / `Handler` suffixes**: no genuine conflicts found in the sample (`McpManager`/`LspManager`/`RepoWatchManager`/`SessionStoreManager`/`PlanApprovalManager`/`ModeSwitchManager`/`QuestionManager`/`AgentPermissionManager`/`DebounceManager`/`IndexManager` are each unique).

## 3. Cross-domain config structures

| Config | File:line | Cross-domain assessment |
| ----------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`IntegrationsConfig`** | `agent-core/src/integrations/config.rs:75` | 🚩 Severe: `channels` + `databases` + `nodes` + `web_search` + `mcp(Smithery key)` + `embedding` (semantic index) + `excluded_skills` (skills denylist). Its own comment says (:108-109) that “globally excluded skills” are placed here “to keep existing files readable without migration” |
| `SmitheryConfig` | `integrations/config.rs:185` | Single field `smithery_api_key`, essentially a secret — suggested move to key-vault |
| `IntegrationConfig` (singular) | `terminal/src/pty_commands/shell_integration.rs:22` | Name is easy to confuse, but the meaning is unrelated (shell prompt integration) |
| `AgentLearningsConfig` | `core/definitions/schema.rs:541` | ✅ Single domain |
| `EmbeddingConfig` | `integrations/config.rs:222` | ✅ Single domain, but nested within `IntegrationsConfig` |

**`ChannelsConfig`** (`integrations/channels/config/mod.rs:93`) embeds 16 platform-specific configs (a pair of `*AccountConfig` + `*Config` for each of Slack/Email/Teams/Matrix/GoogleChat/Feishu/DingTalk/Zalo/WeCom/Weixin/Line/Telegram/Discord/WhatsApp/Signal/iMessage) — type explosion; should use a trait + Vec or an untagged enum.

## 4. Background subsystem misuses `ResolvedAgent::resolve()`

There are ~40 calls to `ResolvedAgent::resolve`. Analysis of production background paths:

| Location | Assessment |
| ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `memory/reflection/mod.rs:92, 94` | ✅ Fixed: comments explicitly say to use `resolve_learnings_for` instead; it actually calls `learnings_lookup::resolve_learnings_for(def_id)` (:101) |
| `memory/reflection/active_learning/mod.rs:78, 80` | ✅ Fixed: same pattern (:83) |
| `state/session_runtime.rs:65` | ✅ Compliant: once during launch |
| `init/{mod.rs:92, 165}`, `launch_spec.rs:245`, `runtime_assemble.rs:63`, `agent_definition_loader.rs:9` | ✅ Main launch path |
| **`src/agent_sessions/cli/session_runner/session.rs:1680` `resolve_sde_skills()`** | 🚩 anti-pattern #27: resolves the entire sde definition just to read `resolved.skills`. Same shape as the already-fixed reflection case. Should add a `resolve_skills_for(agent_id) -> SkillsParams` lookup helper |
| `src/api/agent/dto.rs:89, 342` / `public.rs:75, 93, 97` | ✅ `AgentRuntimeView::from_definition` fallback path already exists |

## 5. Zombie types (Layer 2 call-chain trace)

| Type | Assessment |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AgentLearningsView` / `EmbeddingView` / `CompactionView` / `ToolSelectionView` / `SkillsView` / `IntegrationsView` (`api/agent/dto.rs:190-299`) | ⚠️ Semi-zombie: business paths only use these through the outer `AgentRuntimeView`; `dto_extended_tests.rs` constructs them repeatedly (about 40 `agent_runtime_view` instances come from `_tests`). Suggested: merge as `pub(super)` to reduce redundant `From` impls |
| `UnifiedSession` (`crud/record.rs:37`) | ✅ 30+ production locations |
| `SessionFilter` (`unified_stats/types.rs:204`) | ⚠️ Called from 7 locations, 1-2 in production — semi-zombie |

## 6. Relay structs (anti-pattern #25)

| Relay struct | Evidence | Suggested fix |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------- |
| 11 `Benchmark*Request`s in `benchmark.rs:71-200` | Fields of `BenchmarkGetRunStatusRequest:120` + `BenchmarkCancelRunRequest:126` are almost identical | Merge into `BenchmarkRunIdRequest` |
| `LinearProjectCreateRequest:172` / `*UpdateRequest:187` | Create/Update fields overlap | builder / partial-update |
| `LinearWorkflowStateCreateRequest:201` / `*UpdateRequest:215` | Same | Same |
| `LinearIssueCreateRequest:229` / `*UpdateRequest:244` | Same | Same |
| `spreadsheet_xlsx.rs:11, 31, 61` each `*Request` | All start with `path: String` | Repeated path across commands |
| `spreadsheet_csv.rs:12, 37` | Same | Same |

## 7. `.expect()` on fallback paths (anti-pattern #33)

**The vast majority of matches are in `#[cfg(test)]`**:

| Location | Nature |
| --------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `webhook_secrets.rs:163-245` (19 occurrences) | All in `mod tests` (:158) |
| `webhook_listener.rs:426-610` (21 occurrences) | All in tests (:420) |
| `org_tasks.rs:1051-1165` (7 occurrences) | Test fixtures (:1136) |
| `desktop.rs:254-277` (4 occurrences) | Tests (:248) |
| `inbox_drain/mod.rs:55-65` (4 occurrences) | Tests (:54) |
| **`cursor-bridge/src/routing.rs:61`** `serde_json::to_string(agent_id).expect("string serializes")` | Production code; string serialization has no failure path — effectively low risk |
| `cursor-bridge/src/models.rs:257, 258` | ⚠️ Needs further sample verification |

**No chained fallback misuse of `unwrap_or_else(...).expect(...)` found** (grep returned 0 matches).

## 8. Wire protocol bloat (Layer 8)

Locations of `schemars` / `SchemaSettings` / `into_root_schema`:

- `agent-core/src/core/tools/params.rs:69-86`: constructs JSON Schema **only for LLM tool params** (function-calling signatures)
- All other `schemars` occurrences are tool-param derives (`#[derive(JsonSchema)]`)

**No wire payloads found deriving via `schemars`** — IPC commands use ordinary serde. **No wire-protocol bloat**.

## 9. Init parity (Layer 9)

Call matrix for `ensure_session_initialized` / `register_session`:

| Entry point | `register_session` | `ensure_session_initialized` |
| ------------------------------------- | ------------------------- | -------------------------------------- |
| Tauri `session_launch` | ✅ via `lifecycle.rs:435` | ✅ via `init/mod.rs:98, 188, 205, 286` |
| Tauri `agent_send_message` | (later) | ✅ `:159` |
| Tauri `agent_question_response` | ✅ `:313` | ✅ `:221, 308` |
| HTTP `api::agent::public.rs:48` | (not called) | ✅ `:48` |
| HTTP/test `test/sde.rs:267, 692, 915` | ✅ | ❌ (acceptable white-box test) |
| HTTP/test `test/core.rs:121, 756` | ✅ | ❌ |
| **`channel_handler/dispatch.rs:253`** | ✅ | ❌ |

🚩 `channel_handler/dispatch.rs:253`: the channel webhook entry point only calls `register_session`, not `ensure_session_initialized`. Whether this is a real missed init depends on whether `register_session` self-chains — verify by reading `lifecycle.rs:435`.

## 10. Resolver asymmetry (Layer 10)

**[partial]** Field-level fallback symmetry for the multi-field resolver in `state/commands/session/identity.rs:62` was not examined in depth; `core/definitions/resolved.rs:226-617` has already been explicitly split out into `resolve_learnings_for` / `from_definition`. Follow-up: read all of `identity.rs`.

## 11. DEPRECATED items

About 30 matches were sampled; **the vast majority are false positives**:

- `memory/learnings/lifecycle.rs:99-266` (13 occurrences) — `"deprecated"` is an enum value for the learnings DB column `status`
- `memory/consolidation/events.rs:33, 197` — mem0 state-machine terminology
- The remaining ~10 occurrences are all comments

🚩 **No `#[deprecated]` attributes anywhere in the repository** (grep returned 0 matches) — low ROI.

## 12. Backward-compat shim

| Location | Nature |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `integrations/config.rs:29-35, 108-110, 180` "Violent migration" + `disabled_skills` rename | ✅ Shim already cleared (comment explicitly says "No migration function"), but the `disabled_skills` JSON key remains |
| `integrations/patch.rs:35, 84` "compat" "legacy" | Needs sample verification |
| `state/commands/session/debug/{prompt.rs:160, general.rs:74, 140}` "legacy" | Debug command |
| `memory/consolidation/decision.rs:20` "compat" | Compatibility with the external mem0 protocol (reasonable to retain) |
| `foundation/persistence/session_snapshots.rs:31, 129-242` | DB schema migration sequence (cannot be violently migrated) |

Production shims have nearly all been cleared.

## 13. Naming semantic overlap (same-name enum variants with different meanings)

- **`ConflictResolution`** — see §2, the largest risk
- **`Local` / `Remote`** — `AppliedSide` (`conflict_log.rs:116`) uses `Local/Remote`; the two `ConflictResolution`s use `KeepLocal` and `UseLocal`, and both use `UseRemote` — ⚠️ readability risk within the same `sync/` crate module
- **`Gateway`** / **`State`** / **`Provider`** / **`Context`** / **`Manager`** — definitions are unique in the sample

## 14. Other incidental findings

- **18** occurrences of `#[allow(dead_code)]`, mainly in `key-vault/src/providers/{kiro,copilot,cursor/quota}/`, `advanced-search/src/embedders/`, `project-management/src/sync/oauth/linear.rs:416, 419`, and `ui-indexer/src/parser/mod.rs:46, 51` — largest window hiding dead code
- `AgentRuntimeView::from_definition` (`dto.rs:96`) — explicit fallback pattern; a candidate fix for anti-pattern #33 that could be promoted
- The contexts of 2 `.expect(` calls in `cursor-bridge/src/models.rs:257, 258` have not been confirmed
- Whether `integrations/patch.rs:35, 84` "compat" / "legacy" entries are active shims has not been examined in depth

## OPEN questions

1. **`ProviderConfig` conflict**: rename (`KeyVaultProviderConfig` + `LlmConnectionConfig`) or merge into one crate? The field sets have no overlap — renaming is preferred.
2. **Two `ConflictResolution` enums**: domains differ (resolver decision vs user UI choice); merge into a superset or explicitly distinguish `ResolverVerdict` + `UserConflictChoice`?
3. **Split `IntegrationsConfig`**: code comments imply a commitment “to keep existing files readable without migration”; splitting requires a migration. Accept the short-term migration cost?
4. **Are the three `#[tauri::command]`s at `api/agent/mod.rs:14, 21, 26` truly dead commands**? Follow-up: inspect all 1149 lines of `handler_list.inc` in depth.
5. **Should `session.rs:1680 resolve_sde_skills` add `skills_lookup::resolve_skills_for(agent_id)` following the `learnings_lookup.rs` pattern**?
6. **Is init parity truly missing at `channel_handler/dispatch.rs:253`**? Read the `register_session` implementation at `lifecycle.rs:435` to confirm whether it self-chains.
7. **Should the 18 `#[allow(dead_code)]` sites be reviewed one by one in a follow-up**?
8. **Should `stubs` vs real `TantivyIndexInfo.index_size_bytes: u64` vs `usize` be strictly aligned**? No difference on 64-bit platforms, but the wire schema differs.
9. **Should the confusing `Local` / `Remote` names in the `sync` module be unified with prefixes (`Keep*` / `Use*`)**?
10. **Is it worth changing the 16 inline platform configs in `ChannelsConfig` to a polymorphic structure such as `Vec<Box<dyn ChannelAdapter>>` or `HashMap<ChannelKind, serde_json::Value>`**?

---

**Audit scope statement**: covered `src-tauri/src/` + `src-tauri/crates/*/src/`, skipped `target/` + `gen/`. Grep patterns run: `#\[tauri::command\]` / `^pub struct \w+` / `^pub enum \w+` / `ResolvedAgent::resolve` / `unwrap_or_else.*expect` / `\.expect\(` / `schemars` / `SchemaSettings` / `ensure_session_initialized` / `register_session` / `compat|legacy|backward|migration|shim` / `DEPRECATED|deprecated` / `ALTER TABLE` / `#\[allow\(dead_code\)\]` etc. **Not run**: `cargo check` / `cargo clippy` (as planned).

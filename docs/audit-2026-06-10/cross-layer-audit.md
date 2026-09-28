# Cross-Layer Architecture Audit — 2026-06-10

**Scope**: Tauri IPC, per-session `Channel<String>` event streams, WebSocket bridge, external CLI fork/parse (`src/agent_sessions/cli/`), SQLite schema, skills/agents config, mobile-pwa relay
**Constraint**: read-only
**Method**: Focus on layers 8 / 9 / 10 of the architecture-audit skill

---

## Executive summary

> Top 5 cross-layer issues:
>
> 1. **F-CRIT-5** — `SPAWNED_SESSION_RE` does not match Rust `SUBAGENT_SESSION_PREFIX = "agent-"` at all; subagent UI nesting may silently break.
> 2. **F-CRIT-4** — Four `SessionStatus` sets coexist (FE 16 + Rust 12/6/5).
> 3. **F-HIGH-1** — `launch_cli_agent` silently drops 7 fields (init parity is asymmetric).
> 4. **F-HIGH-12** — Extensive `ALTER TABLE` residue (4 schema files).
> 5. **F-MED-4** — Status literals are duplicated in 5 FE locations; there is no single-source Rust → TS generation.

---

## Tauri Command Matrix (Top 20 by frequency)

| #   | Command                        | FE call site                                              | BE signature                                                               | args drift                                                  | return drift    | Error                                        | Verdict     |
| --- | ------------------------------ | --------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------- | --------------- | -------------------------------------------- | ----------- |
| 1   | `session_launch`               | `useSessionCreator/useSessionLaunch/launchPayload.ts:154` | `state/commands/session/mod.rs:205` → `launch.rs:31` `SessionLaunchParams` | –                                                           | –               | `Result<_, String>`                          | ✅ OK       |
| 2   | `agent_send_message`           | `useAgentControlPalette.ts:115` (direct invokeTauri!)     | agent-core                                                                 | Full signature not deeply checked                          | –               | `Result<_, String>`                          | ⚠️ Not deeply checked |
| 3   | `cli_agent_create`             | E2E only                                                  | `cli/commands.rs:42`                                                       | wrapper key `params:`                                       | –               | `Result<CodeSession, String>`                | ✅ OK       |
| 4   | `cli_agent_run`                | internal                                                  | `cli/commands.rs:196`                                                      | –                                                           | –               | –                                            | ✅ Internal |
| 5   | `cli_agent_message`            | `cliAdapter.ts:941`                                       | `cli/commands.rs:301`                                                      | –                                                           | –               | `Result<(), String>`                         | ✅ OK       |
| 6   | `cli_agent_cancel`             | `cliAdapter.ts:998`                                       | `cli/commands.rs:498` `sessionId, reason?: CancelReason`                   | FE sends `"user_stop"`; BE silently maps unknown reason to `None` (line 500) | – | `Result<_, String>` | ⚠️ F-HIGH-3 |
| 7   | `cli_agent_status`             | `cliAdapter.ts:151`                                       | `cli/commands.rs:476`                                                      | –                                                           | –               | –                                            | ✅ OK       |
| 8   | `cli_agent_chunks`             | `cliAdapter.ts:336`                                       | `cli/commands.rs:517`                                                      | –                                                           | –               | –                                            | ✅ OK       |
| 9   | `cli_agent_approval_response`  | adapter                                                   | `cli/commands.rs:461`                                                      | –                                                           | –               | –                                            | ⚠️ Sampled  |
| 10  | `subscribe_session_events`     | `useSessionChannel.ts:215`、`useOSAgentIDEActions.ts:164` | `api/websocket_handler.rs:377` `sessionId, onEvent: Channel<String>`       | –                                                           | `u64` channelId | –                                            | ✅ OK       |
| 11  | `unsubscribe_session_events`   | `useSessionChannel.ts:220`                                | `websocket_handler.rs:386`                                                 | –                                                           | –               | –                                            | ✅ OK       |
| 12  | `agent_load_messages`          | `rpc/procedures/agentSession.ts:24`                       | agent-core                                                                 | zod validation                                              | –               | –                                            | ✅ OK       |
| 13  | `agent_get_session`            | `agentSession.ts:28`                                      | agent-core                                                                 | –                                                           | –               | –                                            | ✅ OK       |
| 14  | `agent_list_all_sessions`      | `agentSession.ts:32`                                      | agent-core                                                                 | –                                                           | –               | –                                            | ✅ OK       |
| 15  | `agent_question_response`      | `agentSession.ts:61`                                      | agent-core                                                                 | –                                                           | –               | –                                            | ✅ OK       |
| 16  | `agent_permission_response`    | `agentSession.ts:79`                                      | agent-core                                                                 | –                                                           | –               | –                                            | ✅ OK       |
| 17  | `agent_plan_approval_response` | `agentSession.ts:93`                                      | agent-core                                                                 | –                                                           | –               | –                                            | ✅ OK       |
| 18  | `agent_session_cancel`         | `agentSession.ts:14`                                      | agent-core                                                                 | –                                                           | –               | –                                            | ✅ OK       |
| 19  | `mobile_remote_pair_init`      | `mobileRemote/index.ts:71`                                | `mobile_remote::pairing::commands::mobile_remote_pair_init`                | –                                                           | –               | `Result<_, MobileRemoteError>` (**typed!**)  | ✅ Gold standard |
| 20  | `cli_agent_history_mutation`   | E2E only                                                  | `cli/commands.rs`                                                          | –                                                           | –               | –                                            | ✅ OK       |

**Conclusion**: Production commands pass through the zod RPC layer, so shape drift is caught early by the FE. E2E helpers bypassing zod is not considered a risk. `mobile_remote_pair_init` is the only command using a typed error; the other ~900 all use `Result<T, String>` — anti-pattern #11 ("frontend has to string-match error messages").

---

## Event / Status Enum Alignment

### `SessionStatus` — F-CRIT-4

| Variant           | FE `src/types/session/session.ts:28` | Rust `agent-core::session::SessionStatus` (`enums.rs:27`) | Rust `agent_sessions::cli::SessionStatus` (`cli/types.rs:18`) | Rust DB `AgentSessionStatus` | Drift                              |
| ----------------- | ------------------------------------ | ---------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------- | ---------------------------------- |
| pending           | ✅                                   | ✅                                                         | ✅                                                             | ❌                           | Collapsed in DB                    |
| idle              | ✅                                   | ✅                                                         | ✅                                                             | ✅                           | OK                                 |
| running           | ✅                                   | ✅                                                         | ✅                                                             | ✅                           | OK                                 |
| waiting_for_user  | ✅                                   | ✅                                                         | ❌                                                             | ❌                           | Missing in CLI/DB                  |
| waiting_for_funds | ✅                                   | ✅                                                         | ❌                                                             | ❌                           | Missing in CLI/DB                  |
| paused            | ✅                                   | ✅                                                         | ❌                                                             | ❌                           | Missing in CLI                     |
| **queued**        | ✅                                   | ❌                                                         | ❌                                                             | ❌                           | **FE-only (cloud)**                |
| **in_progress**   | ✅                                   | ❌                                                         | ❌                                                             | ❌                           | **FE-only (cloud)**                |
| completed         | ✅                                   | ✅                                                         | ✅                                                             | ✅                           | OK                                 |
| failed            | ✅                                   | ✅                                                         | ✅                                                             | ✅                           | OK                                 |
| **error**         | ✅                                   | ❌                                                         | ❌                                                             | ❌                           | **FE-only (duplicate synonym for `failed`)** |
| cancelled         | ✅                                   | ✅                                                         | ✅                                                             | ✅                           | OK                                 |
| abandoned         | ✅                                   | ✅                                                         | ❌                                                             | ❌                           | Missing in CLI                     |
| timeout           | ✅                                   | ✅                                                         | ❌                                                             | ❌                           | Missing in CLI                     |
| **killed**        | ✅                                   | ❌                                                         | ❌                                                             | ❌                           | **FE-only (cloud)**                |
| archived          | ✅                                   | ✅                                                         | ❌                                                             | ❌                           | Missing in CLI                     |

**Risk**: When Rust `Abandoned/Timeout/Paused/WaitingForUser` values pass through the CLI adapter to the FE, `cli/types.rs::SessionStatus::parse` (line 32) does not recognize them → they are silently dropped from the wire. `cliAdapter.ts` maintains a separate superset, `CliSessionStatus` (`src/types/session/session.ts:67`), to fill the gap. **There should be 1 source of truth instead of 3.**

### `AgentExecMode`

| Variant                  | FE picker `AGENT_EXEC_MODES` | FE wire `ALL_AGENT_EXEC_MODES` | Rust `AgentExecMode` (`enums.rs:153`) | Drift                                                                             |
| ------------------------ | ---------------------------- | ------------------------------ | -------------------------------------- | --------------------------------------------------------------------------------- |
| build / ask / plan       | ✅ ✅ ✅                     | ✅                             | ✅                                     | OK                                                                                |
| debug / review / wingman | ❌ Hidden                    | ✅                             | ✅                                     | **Intentional split** (memory `workspace_agent_exec_mode_display_wire_split.md`) |

`sessionCreatorConfig.ts:60-68` has an explicit guard comment, and the code validates the wire payload with `ALL_AGENT_EXEC_MODES` — it will not collapse `wingman/review` to `build`. Memory check ✅.

### Event Names (`agent:*`, `code_session.*`)

| Event                                                                         | Rust emit            | FE consume                       | Aligned |
| ----------------------------------------------------------------------------- | -------------------- | -------------------------------- | ---- |
| `code_session.activity`                                                       | `cli/session_runner` | `cliAdapter.ts:858`              | ✅   |
| `code_session.status_changed`                                                 | `commands.rs:283`    | `cliAdapter.ts:862`              | ✅   |
| `code_session.worktree_created`                                               | `commands.rs:168`    | `cliAdapter.ts:872`              | ✅   |
| `code_session.merge_result`                                                   | session_runner       | `cliAdapter.ts:884`              | ✅   |
| `code_session.token_usage_updated`                                            | session_runner       | `cliAdapter.ts:867`              | ✅   |
| `agent:message_delta / tool_call / tool_result / complete / error`            | agent-core emitter   | `subagentHandlers.ts:31-46`      | ✅   |
| `agent:streaming_complete`                                                    | agent-core           | `cliAdapter.ts:860`              | ✅   |
| `agent:plan_ready_for_approval` / `exit_plan_mode` / `plan_approval_archived` | agent-core           | `cliAdapter.ts:852-857`          | ✅   |
| `agent:interaction_finalized`                                                 | agent-core           | `cliAdapter.ts:850`              | ✅   |
| `agent:setup_repo_update`                                                     | agent-core           | `fileChangeHandlers.test.ts:144` | ✅   |
| `agent:heartbeat / turn_summary / context_usage`                              | agent-core           | sessionHandlers tests            | ✅   |

No literal drift ✅.

---

## Initialization Parity Matrix

| Entry                                      | Path                                                                  | Key steps                                                                                                                                                                  | Missing                                                                         |
| ------------------------------------------ | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Production `SessionCreator`                | FE `buildSessionLaunchPayload` → `session_launch` → category dispatch | auto-name / key/account resolution / mode persistence / IDE context / work-item / worktree (RUST only via `WorkspaceLaunchTarget`) / CLI key freshness check / persist / broadcast | None |
| Direct `cli_agent_create` (E2E)            | `e2e/helpers/sessionConfig.ts:367`                                    | worktree, proxy allocation | No auto-name / IDE / work-item / agent-org — by design |
| WorkStation new tab                        | mount empty → first input `session_launch`                            | Same as production | OK |
| `cli_agent_resume` (`commands.rs:592`)     | re-spawn runner, reuse `cli_session_id`                               | – | **Missing `ensure_cli_account_key_fresh`** — resume fails when OAuth token expires ⚠️ F-MED-5 |
| Test helper `e2e/helpers/sessionConfig.ts` | Direct `cli_agent_create` | Subset | by design |
| Gateway HTTP `/agent/test/*`               | `api/agent/test/workspace.rs:205` → reuses `session_launch_impl`      | ✅ Uses slow path                                                                                                                                                          |
| Standalone bins (`bin-gateway-chat-cli`)  | Not in the Tauri command set | – | rustls installation / env consistency not reviewed ⚠️ |

### F-HIGH-1 `launch_cli_agent` drops fields

`launch.rs:265-309` passes only CLI-relevant fields into `CliLaunchParams`, **dropping** 7 fields: `agent_org_id`, `agent_org_member_overrides`, `apply_agent_org_member_overrides_for_future`, `work_item_id`, `agent_role`, `project_slug`, and `agent_definition_id`. `launch_rust_agent` preserves all 7 fields.

**Fix**: Either reject the `AgentOrg + CLI` combination (typed error), or add the 7 fields to `CliLaunchParams`.

---

## Resolver Fallback Matrix

| Field               | FE chain                                             | BE chain                                                            | Symmetric?       |
| ------------------- | ---------------------------------------------------- | ------------------------------------------------------------------- | ---------------- |
| model               | `advancedConfig.model → none`                        | `params.model → AgentDef default → none`                            | ⚠️ FE missing default |
| account_id          | `advancedConfig.selectedAccountId → none`            | `params.account_id → cli resume table → previous`                   | OK               |
| workspace_path      | `effectiveSource.repoPath → none`                    | `params.workspace_path → unwrap_or_default("")`                     | ⚠️ BE defaults to `""` |
| branch              | `resolvedKeys.branch ?? effectiveSource.branch`      | `params.branch → git symbolic-ref HEAD`                             | OK               |
| agent_definition_id | `selectedAgentDefId` if not AgentOrg                 | passed through                                                      | OK               |
| **agent_org_id**    | `selectedAgentOrgId` if AgentOrg picker              | **Dropped by CLI; preserved by RUST**                               | ❌ F-HIGH-1      |
| native_harness_type | `advancedConfig.nativeHarnessType` (only isRustAgent) | `params.native_harness_type` (Rust path only)                      | OK               |
| key_source          | `resolvedKeys.keySource`                             | `params.key_source → reject unknown`                                | OK               |
| hosted_token        | `getOrRefreshHostedToken()`                          | `params.hosted_token → proxy alloc`                                 | OK               |
| mode                | `agentExecMode`                                      | `params.mode → DB persist → effective_mode lookup next turn`        | OK               |
| ide_context         | `WorkspaceSnapshot` from React                       | `params.ide_context → injected into prompt`（`cli/commands.rs:18`） | OK               |

**Two worktree entry points**: Rust path `WorkspaceLaunchTarget::Worktree` (`launch.rs:162`) + CLI path `isolate` flag (`cli/commands.rs:97`) — both call `worktree::create_session_worktree`, creating a risk that their rules diverge.

---

## SQLite Schema vs. FE Assumptions

### Anti-pattern #43 — Extensive `ALTER TABLE` residue (F-HIGH-12)

| Table                      | DDL location                                                            | Remaining migrations                                                                    | Notes                                                                                      |
| -------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `code_sessions`            | `cli/mod.rs:30`                                                        | 15+ `ALTER ADD COLUMN`, 1 destructive `DROP COLUMN` on `code_session_chunks.stage_name` | doc comment (`mod.rs:5`) **is wrong**: it says `cli_agent_sessions`, actual table is `code_sessions` |
| `agent_sessions`           | `crates/agent-core/src/foundation/persistence/session_snapshots.rs:71` | 17+ `try_migrate(ALTER TABLE … ADD COLUMN)`                                             | Test fixtures (`lifecycle.rs:583`, `messages/insert_tests.rs:30`) define different column sets — schema fragmentation |
| `events`                   | `crates/session-persistence/src/schema.rs:23`                          | 3 trailing migrations + destructive `DROP COLUMN stage_name`                            | Can be cleaned up before user-stage                                                         |
| `session_turn_index_state` | `schema.rs:104`                                                        | `ADD COLUMN index_version` (line 114)                                                   | Should be included in CREATE                                                               |
| `agent_messages`           | `session_snapshots.rs:82`                                              | `ADD COLUMN images` (line 129)                                                          | Should be included in CREATE                                                               |
| Legacy KG                  | `infrastructure/housekeeping.rs:218-226`                               | Drops 7 tables at every startup (`IF EXISTS`)                                           | Should be a one-time migration version                                                     |

### FE Column Name Assumptions (Sampled)

| Table                 | FE read path                                                              | Risk                                      |
| --------------------- | ------------------------------------------------------------------------- | ----------------------------------------- |
| `code_sessions`       | `cli_agent_status / list` → `CodeSession` struct                          | Low — through serde                       |
| `agent_sessions`      | `agent_get_session / agent_list_all_sessions` → `SessionMeta/SessionInfo` | Low — through serde                       |
| `session_turns`       | `es_load_initial_turn_window`, `cache_load_session_turn_body`             | OK — wire DTO                             |
| `events`              | `es_get_events`、`cache_load_event_payload`                               | OK                                        |
| `agent_messages`      | `agent_load_messages` → `SessionMessage[]`                                | OK                                        |
| `agent_snapshots`     | `agent_get_snapshots` → `SnapshotRecord[]`                                | OK; column `hash` actually stores a UUID — schema is wrong |
| `code_session_chunks` | `cli_agent_chunks` → `ActivityChunk[]`                                    | OK                                        |

**The FE never constructs SQL directly** ✅ — this is sound architecture that isolates BE schema drift. All risk is at the DTO layer.

See [cross-layer-audit-part2.md](./cross-layer-audit-part2.md) for the detailed cross-cutting sweep (magic strings, kebab/snake, localStorage overlap, DEFAULT_PINNED).

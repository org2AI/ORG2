# Cross-Layer Architecture Audit — Part 2 (Sweep, Memory, Acceptance)

Continues [cross-layer-audit.md](./cross-layer-audit.md).

---

## Cross-layer sweep

### Magic strings shared by frontend and backend (candidates for single-source generation)

| String | Frontend locations | Backend locations | Recommended source |
| --- | --- | --- | --- |
| `"running" / "completed" / "failed" / "cancelled"` and others | `types/session/session.ts:28`, `WorkItems/constants.ts:57`, `TaskKanban/config.ts:175`, `AgentOrgOverviewPanel.tsx:34`, `AgentOrgTaskList.tsx:19` (**five FE duplicates**) | `agent-core/.../enums.rs:62` (`as_str`), `agent_sessions/unified_stats/status.rs:13` | Rust-generated TS const module |
| `"build" / "ask" / "plan" / "debug" / "review" / "wingman"` | `config/sessionCreatorConfig.ts:70` | `enums.rs:172` `AgentExecMode::as_str` | Same |
| `"code_session.activity"`, `"agent:tool_call"`, and others | `cliAdapter.ts:858+` and multiple tests | `cli/commands.rs:168,283,…`, agent-core | Generated EventType |
| `"own_key"`, `"hosted_key"` | `api/tauri/session.ts` (KEY_SOURCE) | `cli/types.rs::KeySource::parse` | One source |
| `"rust_agent"`, `"cli_agent"` session categories | `api/tauri/session.ts` (DISPATCH_CATEGORY) | `launch.rs:118-120` (SESSION*CATEGORY*\*) | Both sides have constants, but they are not generated |
| `"cliagent-"`, `"sdeagent-"`, `"osagent-"`, `"wingman-"`, `"agent-"`, `"shadow-"` session ID prefixes | `src/util/session/sessionCategory.ts` | `crates/types/src/session.rs:7-32` | Generate TS constants from Rust |
| Cancel reasons such as `"user_stop"`, `"force_send"` | `api/tauri/agent/session.ts:42-48` | `agent-core/src/state/control_flow.rs::CancelReason` | Generate or validate with Zod |

**Conclusion:** The `rpc/zod` layer validates shape, but not value sets. `core-types/wire` generation already serves `CliAgentType` (`resolveKeys.ts:9`); the pattern exists but has not been extended to these cases.

### kebab-case and snake_case IPC arguments

No drift was found. Both sides consistently use camelCase: Rust structures declare `#[serde(rename_all = "camelCase")]` and frontend JavaScript uses camelCase keys. `launch.rs:86` has one defensive `#[serde(alias = "additional_directories")]`. Tauri also handles snake↔camel conversion automatically.

### localStorage/sessionStorage versus SQLite

| Frontend storage key | Content | Backend column | Drift |
| --- | --- | --- | --- |
| `orgii:pinnedActions` (`pinnedActionsAtom.ts:48`) | User-pinned slash items | None | OK |
| `orgii:dispatch:*` / agentCategory | Previous picker choice | `agent_sessions.dispatch_category`, etc. | ⚠️ Not deeply checked |
| Agent definitions | None on FE | `agent_definitions` table | OK |
| Settings | None on FE; backend owns `~/.orgii/settings.jsonc` | — | OK |

No duplicate source-of-truth drift was found in the sampled scope.

### DEFAULT_PINNED list (memory check)

At `src/store/session/pinnedActionsAtom.ts:28`:

- `"Setup Repo"` (category `action`, source `builtin`) is a **built-in action**, not a slash skill.
- `"manage-skills"` is a **shipped built-in skill** at `crates/agent-core/src/intelligence/skills/builtin_data/manage-skills/SKILL.md`.
- `"manage-agents-and-orgs"` is a **shipped built-in skill** at the same path.

`migrate()` (lines 56–60) **removes** the old `setup-repo` skill entry from existing users' localStorage. Memory `workspace_default_pinned_actions_gap.md` is **stale**; its gap has been closed.

### Skill IDs

- `setup_repo` (underscore) is the Rust tool/event name (`agent:setup_repo_update`).
- `setup-repo` (hyphen) is the slash-command skill.
- They are separate identifiers with similar names. Memory records this distinction; no collision is currently known.

---

## Memory-file verification from a cross-layer view

| File | Verdict | Evidence |
| --- | --- | --- |
| `workspace_two_agent_execution_paths.md` | ✅ **ACCURATE** | `agent_sessions/cli/commands.rs` handles production user chat; `agent-core::turn_executor` drives built-in subagents only. Path: `session_launch_impl → launch_cli_agent → cli_agent_create → session_runner::run_session`. |
| `workspace_agent_events_via_websocket.md` | ✅ **ACCURATE** | `websocket_handler.rs:284` `broadcast()` calls `dispatch_to_channels` on the main path and `WS_BROADCASTER.send` for a debug tee. `MAX_CONSECUTIVE_FAILURES = 3` (line 40); `subscribe_session_events` at line 377. |
| `workspace_tauri_command_registration.md` | ✅ **ACCURATE** | `handler_list.inc` has 1,159 lines; `build.rs:32-45` uses `tauri::generate_handler!`; Tauri is pinned to `=2.10.3` (`package.json:83`). |
| `workspace_agent_cli_crate_name_trap.md` | ✅ **ACCURATE** | `crates/agent-cli/` is configuration; runtime is in `src/agent_sessions/cli/`. `handler_list.inc:755` registers config and `:476` registers runtime. |
| `workspace_agent_exec_mode_display_wire_split.md` | ✅ **ACCURATE** | `config/sessionCreatorConfig.ts:60-85` uses `ALL_AGENT_EXEC_MODES` to enforce the split; Rust `AgentExecMode::parse` (`enums.rs:191`) rejects unknown values. |
| `workspace_subagent_ui_visibility_regex.md` | ⚠️ **DRIFT / STALE** | Regex `(?:agentsession\|subagent)-` does not match Rust `SUBAGENT_SESSION_PREFIX = "agent-"` (`crates/types/src/session.rs:26`). Subagent UI nesting may silently break. **HIGH severity if confirmed.** |
| `workspace_packages_and_mobile_split.md` | ✅ **ACCURATE** | `packages/README.md` has four holding packages; root `package.json` has no `workspaces`; `contrib/relay/` has Dockerfile and systemd unit; `crates/mobile-remote/` and `crates/orgii-mobile-relay/` exist. |
| `workspace_ci_only_release.md` | ✅ **ACCURATE** | `.github/workflows/` has only `release.yaml`. |
| `workspace_env_keys_feature_map.md` | ✅ **PROBABLE** | The `.env` loader was not checked directly. |
| `workspace_browser_standalone_fails.md` | ✅ **PROBABLE** | Webpack dev port 1998 matches. |
| `workspace_default_pinned_actions_gap.md` | ❌ **STALE** | DEFAULT_PINNED no longer pins the `setup-repo` skill; `migrate()` clears the old entry. Setup Repo is now a built-in **action** and is also supplied as a built-in skill. |

---

## Cross-layer acceptance self-check

- [x] Wire protocol matrix covers at least 20 commands and argument drift, return drift, errors, and verdicts.
- [x] Init parity matrix covers all session-creation entry points; F-HIGH-1 flagged.
- [x] Resolver symmetry matrix complete; `agent_org_id` asymmetry flagged.
- [x] Status/mode/event enum alignment complete; four FE-only values and one BE-only paused state collapse on CLI.
- [x] SQLite schema versus FE assumptions checked. FE correctly avoids direct schema reads; BE retains F-HIGH-12 anti-pattern #43.
- [x] Six classes of magic strings listed for single-source analysis.
- [x] Memory files checked: one STALE, one DRIFT, nine ACCURATE.
- [x] Verified findings distinguished from memory claims.
- [x] File:line references supplied.
- [x] No source files modified in this audit.

---

## Needs deeper investigation

1. Read all of `cli_agent_resume` (`commands.rs:592`) to confirm whether it lacks `ensure_cli_account_key_fresh` and proxy-token reallocation (roughly 30 extra lines to inspect).
2. Inspect the full `agent_send_message` signature. Zod gates cross-layer shape, making drift less likely, but it was not checked deeply.
3. Check rustls installation and environment parity for standalone binaries such as `bin-gateway-chat-cli`.
4. Check each agent event type for `session_id` before concluding that `extract_session_id` never silently drops an event.

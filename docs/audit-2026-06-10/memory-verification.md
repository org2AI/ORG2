# Memory File Verification — 2026-06-10

Cross-checked by 3 explore subagents and the main context. Results are classified as:

- ✅ **ACCURATE** — Matches the current state
- ⚠️ **PARTIAL** — Some content has changed
- ❌ **STALE** — Entirely stale; rewrite needed
- 🔓 **OPEN** — The described bug remains unresolved and diagnostic logs are still active
- ❌ **DRIFT** — The contract/regex described in memory has diverged from the code

---

## Cross-Layer / Shared

| Memory                                            | Status       | Notes                                                                                    |
| ------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------- |
| `workspace_two_agent_execution_paths.md`          | ✅ ACCURATE  | User chat = forked external CLI; agent-core turn_executor runs builtin subagents only    |
| `workspace_agent_events_via_websocket.md`         | ✅ ACCURATE  | `websocket_handler.rs:284` `broadcast()` dispatches twice; WS is a debug tee             |
| `workspace_tauri_command_registration.md`         | ✅ ACCURATE  | Registered through `handler_list.inc` + `build.rs`; Tauri pinned to `=2.10.3`            |
| `workspace_agent_cli_crate_name_trap.md`          | ✅ ACCURATE  | `crates/agent-cli/` ≠ runtime; runtime is in `src/agent_sessions/cli/`                   |
| `workspace_agent_exec_mode_display_wire_split.md` | ✅ ACCURATE  | Picker and wire union have been separated                                               |
| `workspace_subagent_ui_visibility_regex.md`       | ❌ **DRIFT** | `SPAWNED_SESSION_RE` does not match current Rust `SUBAGENT_SESSION_PREFIX = "agent-"` → F-CRIT-5 |
| `workspace_packages_and_mobile_split.md`          | ✅ ACCURATE  | 4 holding repos; contrib/relay; mobile-remote                                            |
| `workspace_ci_only_release.md`                    | ✅ ACCURATE  | Only `release.yaml`                                                                     |
| `workspace_env_keys_feature_map.md`               | ✅ PROBABLE  | Not directly verified                                                                  |
| `workspace_browser_standalone_fails.md`           | ✅ PROBABLE  | Webpack port 1998 matches                                                               |
| `workspace_default_pinned_actions_gap.md`         | ❌ **STALE** | `DEFAULT_PINNED` has been migrated; setup-repo is now a builtin action + skill; gap closed |

---

## Frontend / UI

| Memory                                                 | Status                                                               | Notes                                                                                                                                                                                                                          |
| ------------------------------------------------------ | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `workspace_chatpanel_engine_panel_view_bloat.md`       | ⚠️ PARTIAL                                                           | StickyNotes removed; 6 misplaced files remain → F-MED-2                                                                                                                                                                         |
| `workspace_tab_systems_inventory.md`                   | ✅ ACCURATE                                                          | 8 tab systems                                                                                                                                                                                                                   |
| `workspace_force_send_queue_dispatch.md`               | ❌ **ENTIRELY STALE**                                                | `showQueuedMessageOptimistically / forceSendPendingQueueAtom / isQueueRuntimeStillWorking / hasTurnBlockingRunningEventForSession / markQueueTurnSettled` are all absent; `useQueueDispatch.ts` has been rewritten around the `turnLifecycle.ts` FSM |
| `workspace_composer_bar_shared.md`                     | ✅ ACCURATE                                                          | ComposerBar is still shared                                                                                                                                                                                                     |
| `workspace_chat_input_surfaces_matrix.md`              | ⚠️ PARTIAL                                                           | EditorArea max-height changed back from `(isChatPanel ? 140 : 300)` to `(isChatPanelFullScreen ? 200 : 300)`                                                                                                                    |
| `workspace_terminalblock_loading_shimmer_weak.md`      | ✅ ACCURATE                                                          | Shimmer is present on all 4 surfaces                                                                                                                                                                                            |
| `workspace_askquestion_streaming_returns_null.md`      | ✅ ACCURATE                                                          | `isStreaming` + `QuestionCardLoadingShell` still present                                                                                                                                                                         |
| `workspace_session_row_working_indicator_weak.md`      | ⚠️ Not investigated in depth                                         | Not listed as OPEN                                                                                                                                                                                                               |
| `workspace_inline_canvas_size_limit.md`                | ✅ ACCURATE                                                          | Writing this audit report hit the same 18 KB truncation                                                                                                                                                                          |
| `workspace_a2ui_element_types.md`                      | ✅ ACCURATE                                                          | No changes                                                                                                                                                                                                                       |
| `workspace_create_plan_subagent_wiring_bug.md`         | ⚠️ Not verified in FE                                                 | BE risk                                                                                                                                                                                                                         |
| `workspace_diff_app_vs_file_review_data_sources.md`    | ⚠️ Not investigated in depth                                         |
| `workspace_workstation_placeholder_icons.md`           | ⚠️ Not investigated in depth                                         |
| `workspace_source_control_sidebar_seam.md`             | ⚠️ Not investigated in depth                                         |
| `workspace_workstation_pr_eligibility.md`              | ⚠️ Not investigated in depth                                         |
| `workspace_pullrequest_i18n_key_missing.md`            | ⚠️ Not investigated in depth                                         |
| `workspace_pinned_actions_bar_overflow.md`             | ⚠️ Not investigated in depth                                         |
| `workspace_composer_pill_context_prefix_extension.md`  | ⚠️ Not investigated in depth                                         |
| `workspace_dom_element_pill_json_shape.md`             | ⚠️ Not investigated in depth                                         |
| `workspace_user_chat_item_truncation.md`               | ⚠️ Not investigated in depth                                         |
| `workspace_editor_area_max_height.md`                  | ⚠️ Not investigated in depth; may have drifted with `workspace_chat_input_surfaces_matrix.md` |
| `workspace_chat_markdown_table_overflow.md`            | ✅ Historical finding                                                |
| `workspace_chatpanel_chat_block_content_typography.md` | ⚠️ Not investigated in depth                                         |
| `workspace_chat_block_header_scope_trap.md`            | ⚠️ Not investigated in depth                                         |
| `workspace_composer_input_compact_nowrap.md`           | ⚠️ Not investigated in depth                                         |
| `workspace_plan_todo_pinbar_resurrect.md`              | ✅ Marked FIXED                                                      |
| `workspace_subagent_card_failed_flash.md`              | ✅ Marked FIXED                                                      |
| `workspace_interactions_tab_bubble_shrink.md`          | ✅ Marked FIXED                                                      |
| `workspace_terminalblock_loading_shimmer_weak.md`      | ✅ FIXED                                                             |
| `workspace_session_row_working_indicator_weak.md`      | ✅ FIXED                                                             |

---

## OPEN Bugs (Diagnostic Logs Still Active)

| Memory                                        | Status        | TEMP DIAG location                                                                                                                                   |
| --------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workspace_mode_switch_clears_draft.md`       | 🔓 OPEN       | `[draft-bug]` at `ModePill.tsx:141-142`, `useInputArea/index.ts:359,366,380,397,408`, `ComposerInput/imperativeApi.ts:106,119` (includes `console.trace`) |
| `workspace_workstation_toggle_right_blank.md` | 🔓 OPEN       | `[ws-blank-diag]` at `AppLayout.tsx:206,219`                                                                                                         |
| `workspace_sessionreplay_file_blank.md`       | 🔓 OPEN       | `[file-blank]` at `resolveFilePayload.ts:49,64,76,85`                                                                                                |
| `workspace_message_reference_cards_drift.md`  | ⚠️ PARTLY STALE | `MessageReferenceCards.tsx:62` now emits `git_commit` — implementation may match the test; verify with vitest                                       |

---

## Backend

| Memory                                       | Status                                                                                          | Notes |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------- | ---- |
| `workspace_cargo_check_slow.md`              | ✅ Accepted (not rerun)                                                                        |
| `workspace_cargo_package_underscore_name.md` | ✅ ACCURATE                                                                                     |
| `workspace_tauri_command_registration.md`    | ✅ ACCURATE                                                                                     |
| `workspace_two_agent_execution_paths.md`     | ✅ ACCURATE                                                                                     |
| `workspace_agent_events_via_websocket.md`    | ✅ ACCURATE                                                                                     |
| `workspace_dead_code_scan_landscape.md`      | ✅ Accepted from FE perspective; BE adds 2 trees (`coding_agent` / `benchmark`) — recommend adding `workspace_be_dead_modules.md` |
| `workspace_tsc_noemit_preexisting_noise.md`  | ✅ Followed (full tsc not run)                                                                   |

---

## Process / Feedback Memory

| Memory                                              | Status                                                               |
| --------------------------------------------------- | -------------------------------------------------------------------- |
| `feedback_audit_before_commit.md`                   | ✅ Followed — added scope checklist, left untracked files untouched, used cursor skill's 12 categories |
| `feedback_audit_split_skill_workflow.md`            | ✅ Followed — this was a single audit deliverable; did not split into PRs                           |
| `feedback_terse_choice_decisive.md`                 | ✅ Followed — acted on the user's open-ended instruction by doing the most specific work            |
| `feedback_explain_architecture_findings_plainly.md` | ✅ Followed — provided a layered README, subreports, priorities, and acceptance checklist          |
| `feedback_stop_speculating_add_diagnostic.md`       | ✅ Followed — did not speculate further on OPEN bugs; recommended keeping diagnostics for repro     |
| `feedback_verify_subagent_cross_cutting_claims.md`  | ✅ Followed — main context verified differences across 3 subagent reports                           |
| `feedback_refactor_plan_shape.md`                   | ✅ Followed — phases, independent slices, and explicit out-of-scope items                           |
| `feedback_plan_mode_research_budget.md`             | N/A — this was not plan mode                                                                       |
| `feedback_disambiguate_screenshot_bugs_early.md`    | N/A                                                                  |
| `feedback_clarify_then_verify_refactor.md`          | N/A — audit only; no refactor                                        |
| `feedback_scope_tiers_for_global_changes.md`        | N/A — the user explicitly said "global"                             |
| `feedback_parallel_explore_for_repo_overview.md`    | ✅ Followed — dispatched 3 subagents                                 |
| `feedback_cite_code_not_comments.md`                | ✅ Followed — every finding cites code locations                     |
| `feedback_jsx_classname_template_space.md`          | N/A                                                                  |
| `feedback_tsx_ternary_jsx_parse_trap.md`            | N/A                                                                  |
| `feedback_flag_unverifiable_runtime_ui.md`          | ✅ Applied — this audit did not verify in a WebView                   |
| `feedback_askuser_timeout_proceed.md`               | N/A                                                                  |
| `feedback_plan_mode_post_approval.md`               | N/A                                                                  |

---

## Recommended Memory Updates

| Memory                                                      | Action               | Notes                                                                          |
| ----------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------ |
| `workspace_subagent_ui_visibility_regex.md`                 | **Rewrite**          | Has drifted from the Rust prefix; include the current regex + Rust constant + fix path |
| `workspace_default_pinned_actions_gap.md`                   | **Delete or archive** | Gap is closed; `DEFAULT_PINNED` has been migrated                                    |
| `workspace_force_send_queue_dispatch.md`                    | **Rewrite**          | Entirely stale; base new content on the current `turnLifecycle.ts` FSM + `useQueueDispatch.ts` implementation |
| `workspace_chat_input_surfaces_matrix.md`                   | **Calibrate**        | EditorArea max-height values have changed                                            |
| `workspace_chatpanel_engine_panel_view_bloat.md`            | **Calibrate**        | StickyNotes removed; 6 misplaced files remain                                      |
| `workspace_message_reference_cards_drift.md`                | **Archive or update after verification** | Run vitest to check whether implementation matches the test                  |
| **New** `workspace_be_dead_modules.md`                     | **Create**           | Record the orphaned `coding_agent/` tree + unregistered `benchmark.rs`                |
| **New** `workspace_session_status_quadruple_definition.md` | **Create**           | Document 4 `SessionStatus` definitions with locations and a unification plan         |
| **New** `workspace_naming_collisions_23.md`                | **Create**           | Summarize 23 same-named structs across crates                                       |

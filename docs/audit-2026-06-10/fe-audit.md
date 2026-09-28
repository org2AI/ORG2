# Frontend Architecture Audit — 2026-06-10

**Scope**: `src/`, `types/` (including `tests/` for coverage reference only)
**Constraint**: read-only; do not run full `tsc --noEmit` (per `workspace_tsc_noemit_preexisting_noise.md`)
**Method**: 10 layers of the architecture-audit skill + anti-pattern #1–#54 sweep
**Entry-point tracing starts at**: `src/index.tsx`, `src/App.tsx`, `src/router/`, `src/windows/`

---

## Executive summary

> Top 5 (by severity):
>
> 1. **`engines/ChatPanel/` boundary leakage** — 6 misplaced PanelViews in the root directory + cross-engine import (`ChatPanel` imports from `modules/MainApp/AgentOrgs/store`) — layer 6 violation.
> 2. **Multiple dispatch paths + UI calls transport directly** — 8 calls to `dispatchMessageBySessionType` within the `useWorkspaceChat.ts` hook; `useAgentControlPalette.ts:115` and `AgentErrorChatItem.tsx:114` bypass the FSM entirely.
> 3. **Multi-concern atoms remain** — `userInitiatedCancelAtom` both "signals user Stop" and "triggers draft restore"; `holdSessionQueueForStopAtom` coexists as a shadow of the FSM's `stopping` state.
> 4. **TEMP DIAG residue: 25 lines across 5 files** — includes `console.trace` in `imperativeApi.ts` (fires on every setContent / clear).
> 5. **3 OPEN bugs still have live diagnostic logs** — ModePill draft wipe, Workstation right-side blank strip, and SessionReplay file viewer blank.

---

## Layer 1 — Compilation Correctness

Did not run full tsc (baseline ~240s). Spot-checked key files with LSP. All audit targets were read-only.

- **Path-filtered command template**: `pnpm exec tsc --noEmit 2>&1 | grep -E "(FileA|FileB)" | head -40`

---

## Layer 2 — Dead Code / Duplication

**Entry-point trace**: `src/index.tsx` → `App.tsx` → `router/`, `scaffold/`, `engines/`, `modules/`, `features/`.

### Finding F-MED-2: 6 misplaced PanelViews in the `engines/ChatPanel/` root

- **Location**: `engines/ChatPanel/ProjectPanelView.tsx`, `WorkItemPanelView.tsx`, `WorkspaceDashboardPanelView.tsx`, `WorkspaceExplorePanelView.tsx`, `WorkspaceOverviewPanelView.tsx`, `BenchmarkRunBuilder.tsx`, `LinkSessionToWorkItemModal.tsx`, `useBenchmarkSessionCreatorSlots.tsx`
- **Issue**: Already recorded in memory `workspace_chatpanel_engine_panel_view_bloat.md`, but not yet cleaned up. `ChatPanelContent.tsx` still imports 5; StickyNotes has been deleted (memory is partly stale).
- **Fix**: Move to `features/` or `modules/`; no behavior changes.
- **Sweep**: Grepped all `*PanelView.tsx` files under ChatPanel; all 6 are in the root, with no misplaced files in deeper modules.

### Finding: `engines/ChatPanel/index.tsx:18` imports from `modules/MainApp/AgentOrgs/store`

- **Location**: `src/engines/ChatPanel/index.tsx:18`
- **Issue**: The engine layer should not depend on the modules layer in reverse (layer 6 cross-domain leakage).
- **Fix**: Move the required atom to `store/`.
- **Sweep status**: Grepped for `from "@src/modules` in `engines/`; found 2 occurrences.

### Finding: `MessageReferenceCards.tsx:62` cross-engine import of Simulator types

- **Location**: `src/engines/ChatPanel/blocks/MessageReferenceCards.tsx:62`
- **Issue**: Harry's in-flight file (already recorded in memory `workspace_message_reference_cards_drift.md`).
- **Sweep**: Run vitest to confirm whether it still drifts (2 of 3 tests fail).

### Dead-code candidates (consistent with `workspace_dead_code_scan_landscape.md`)

- `localStorage.ts`, `apiTracker.ts`, `gitBundle.ts`, `deferredInit.ts`, and several `*ActionDialog` files.
- The entire `AskUserChatItem/` directory can be deleted (memory `workspace_askquestion_streaming_returns_null.md` records `ChatItems/AskUserChatItem/` as dead).

---

## Layer 3 — Naming Consistency

- `SecondaryPanelHeader → PanelTabBar` rename is complete.
- `getTerminalPillTexts` still says terminal, but is now reused for several pill types — the name is no longer precise.
- The `terminal-pill-click` event name is reused in non-terminal contexts.

---

## Layer 4 — Semantic Overloading (FE Perspective)

| Term      | Usage 1                                      | Usage 2                                      | Usage 3                                           | Assessment           |
| --------- | -------------------------------------------- | -------------------------------------------- | ------------------------------------------------- | -------------------- |
| `session` | `activeSessionIdAtom` (pipeline subscription) | `workstationActiveSessionIdAtom` (UI memory) | `sessionCreatorDraftListAtom` (pre-launch draft) | 3 concepts, 1 term   |
| `agent`   | `api/tauri/agent/` (Rust IPC)                | `modules/MainApp/AgentOrgs/` (multi-agent org) | `osagent/useBrowserAutomation` (OS browser driver) | Severe overloading |
| `tab`     | `WorkStation/shared/TabBar` (#1)             | `EditorBottomPanel/tabs/` (#3)               | `SessionReplay/ReplayTabBar` (#5)                 | 8 tab systems total |
| `pill`    | `ModePill` (agent exec mode)                 | `SidebarTabButton` (segmented control)        | `ComposerPill` (@ context)                       | 3 separate UI primitives |
| `block`   | `engines/ChatPanel/blocks/` (chat content)   | "turn-blocking event" (sync layer)           | `collapseStateAtom` (collapse per block)          | Mostly OK           |
| `mode`    | `agentExecMode`                              | `stationMode`                                 | `chatPanelContentModeAtom`                        | 3 separate state machines |
| `panel`   | `PermissionCard/` (left-edge card)           | `*PanelView.tsx` (workspace overview)        | `PanelTabBar/` (panel chrome)                     | "PanelView" is misleading |
| `creator` | `features/SessionCreator/` (launch new session) | `creatorDraftAtom` (saved draft)           | `creatorStateAtom` (current selection)            | Same concept         |

---

## Layer 5 — Default Branches

- The StationMode ternary chain `mode === "agent-station" ? … : mode === "my-station" ? … : null` appears in several places; a new mode silently falls through to `null` — anti-pattern #1.
- The AgentExecMode ternary in `useSessionExecModeField`: ✅ guarded with `ALL_AGENT_EXEC_MODES`.
- `cliSessionStatusAtom.ts:225-230` checks `status === "running" || "installing" || "waiting_for_user" || "waiting_for_funds"` — a new status will not be recognized as active; however, none of the current FE-only statuses (`queued`/`in_progress`) enter this branch, which may be by design.

---

## Layer 6 — Cross-Domain Leakage

| Location                                                         | Leaked dependency                            | Risk                      |
| ---------------------------------------------------------------- | --------------------------------------------- | ------------------------- |
| `engines/ChatPanel/index.tsx:18`                                 | import from `modules/MainApp/AgentOrgs/store` | reverse engine → modules dependency |
| `engines/ChatPanel/blocks/MessageReferenceCards.tsx:62`          | import Simulator types                       | horizontal engine ↔ engine coupling |
| 6 misplaced files in `engines/ChatPanel/` root                   | feature-layer files misplaced in engine layer | See F-MED-2               |
| `engines/SessionCore/rendering/registry/initToolRegistry.ts:311` | `as any` cross-engine cast                    | anti-pattern #15          |

---

## Layer 7 — New-Developer Confusion

- `ChatPanel` vs `ChatHistory` vs `ChatView` vs `ChatItems` — 4 neighboring names with different responsibilities.
- `engines/ChatPanel/InputArea/PermissionCard/` vs `engines/ChatPanel/InputArea/AskQuestionCard/` vs `engines/ChatPanel/InputArea/ModeSwitchCard/` — all 3 "Cards" are inline cards at the top of the input bar; `InputBarOverlayCard` would be a clearer shared name.
- `useWorkspaceChat` suggests a workspace-specific hook, but it is actually a unified chat hook (multiple session categories).

---

## Layer 8 — Wire Protocol (FE Side)

| Item                                         | Status                                                  |
| -------------------------------------------- | ------------------------------------------------------- |
| 23 bare command names in `invokeTauri("name", …)` | ⚠️ Untyped (rpc layer covers only some)                  |
| zod RPC layer `src/api/tauri/rpc/`           | ✅ zod validates shape, but not values (such as status literals) |
| Single-source FE Status enum                 | ❌ Duplicated in 5 FE locations (see cross-layer report) |

---

## Layer 9 — Initialization Parity (FE Entry Points)

| Entry                             | Path                                                                   | Notes                                |
| --------------------------------- | ---------------------------------------------------------------------- | ------------------------------------ |
| SessionCreator → `session_launch` | `useSessionLaunch/launchPayload.ts`                                    | Production path, aligns 7 fields     |
| WorkStation new tab               | mount empty session → first message triggers `session_launch`          | OK                                   |
| Resume from `.jsonl`              | `cli_agent_resume`                                                     | Missing `ensure_cli_account_key_fresh` ⚠️ |
| E2E helper                        | Direct `cli_agent_create`                                              | Subset of fields, by design          |
| Spotlight AgentControl            | Direct `invokeTauri("agent_send_message")` in `useAgentControlPalette.ts:115` | **Bypasses FSM** ❌             |
| AgentErrorChatItem resume         | Direct call to `SessionService.sendMessage`                            | **Bypasses FSM** ❌                  |

---

## Layer 10 — Resolver Symmetry

| Field          | FE chain                                  | BE chain                                          | Symmetric?      |
| -------------- | ----------------------------------------- | ------------------------------------------------- | --------------- |
| model          | `advancedConfig.model → none`             | `params.model → AgentDef default → none`          | FE missing default |
| account_id     | `advancedConfig.selectedAccountId → none` | `params.account_id → cli resume table → previous` | OK              |
| workspace_path | `effectiveSource.repoPath → none`         | `params.workspace_path → unwrap_or_default("")`   | ⚠️ BE defaults to `""` |
| agent_org_id   | `selectedAgentOrgId`                      | RUST preserves; **CLI drops**                     | ❌ F-HIGH-1     |
| key_source     | `resolvedKeys.keySource`                  | `params.key_source → reject unknown`              | OK              |

---

## Sweep Table (Entire FE Codebase)

| Pattern                                 | Hits                                                                    | Main files                                                                                                                                                                                               | Assessment                                 |
| --------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `dispatchMessage`, `sendMessage` call sites | ~16                                                                  | `useWorkspaceChat.ts` (8), `useMessageDispatch.ts`, `SessionService.ts`, `useQueueDispatch.ts`, `useModeSwitchActions.ts`, `InputActions.tsx`, `AgentErrorChatItem.tsx`, `useAgentControlPalette.ts` | **Anti-pattern #21 / #53**, F-HIGH-11 / F-CRIT-1 |
| `runtimeStatus`, `isRunning` write sites | ~70                                                                     | Multiple sources; `setSessionRuntimeStatusAtom` has 10 source field values                                                                                                                               | ⚠️ F-MED-1                                 |
| Multi-concern atom name                 | `userInitiatedCancelAtom`                                               | `cliSessionStatusAtom.ts:174-175`                                                                                                                                                                        | ❌ F-HIGH-2                                |
| TODO / FIXME / HACK / LEGACY            | 30                                                                      | Scattered                                                                                                                                                                                                | Mostly intent markers                      |
| Duplicate cross-module types            | `SessionInfo` (store + service), `AgentMessage`, `ChatItem*` (multiple versions) | See [naming-collisions.md](./naming-collisions.md)                                                                                                                                                  | ⚠️                                         |
| Bare `localStorage.*Item` keys           | 7                                                                       | `themeInit`, `timezone`, `serviceAuth oauthRedirect_*`, `SetupWalkthrough`, `AuthCallback`, `headers.ts`, `AppearanceState`                                                                            | ⚠️ Some OK                                 |
| `@ts-ignore`, `@ts-expect-error`         | 3                                                                       | `eventPayload.ts:63,259,355`                                                                                                                                                                             | ✅ Local                                   |
| `as any` / `as unknown as`              | ~80                                                                     | Hotspots: `HoverAnimatedIcon.tsx` (7), `BrowserCore/index.tsx` (4), `RulesMemoryEvolution/useAutomationRules.ts` (3), many in e2e helpers                                                                 | ⚠️ 30+ in production `src/`                |
| Production `console.log`                | 3                                                                       | `CanvasPreview` (DevTools), `ModePill` (TEMP DIAG), `useEmbeddedWebview:84` (actual leak)                                                                                                               | ⚠️ 1 actual leak                           |
| TEMP DIAG                               | 25 lines / 5 files                                                      | `ComposerInput/imperativeApi.ts:106-120` (`console.trace`!), `useInputArea/index.ts` (5), `AppLayout.tsx` (`[ws-blank-diag]`), `ModePill.tsx`, `resolveFilePayload.ts` (3)                              | ❌ F-CRIT-8                                |
| `dangerouslySetInnerHTML`               | 13                                                                      | LLM output paths include `BlockOutput`, `a2uiElements`, `MermaidBlock`, `GitHubDiff/DiffRow`; external documents include `DocxPreview`, `PagesPreview`                                                  | ⚠️ F-MED-6                                 |
| Duplicate status literal definitions     | 5 locations                                                             | `types/session/session.ts`, `ProjectManager/WorkItems/constants.ts`, `TaskKanban/config.ts`, `AgentOrgOverviewPanel.tsx`, `AgentOrgTaskList.tsx`                                                        | ❌ F-MED-4                                 |
| Uncleaned `setTimeout` / `setInterval`  | ~80 hits                                                                | Hotspots: `cliAdapter.ts` (5), `api/realtime/websocket/client.ts` (4); most have cleanup                                                                                                               | ⚠️ Sampled                                 |
| Large files ≥ 700 lines                  | 12 locations                                                            | `cliAdapter.ts` 1000, `ChatHistory/index.tsx` 909, `MessageReferenceCards.tsx` 710                                                                                                                      | ⚠️ F-MED-7                                 |

---

## Memory File Verification (FE Perspective)

| Memory                                            | Verification result                                                                                                                                                                                                                                                         |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `workspace_chatpanel_engine_panel_view_bloat.md`  | **Partly stale**: StickyNotes has been deleted; 6 misplaced files remain                                                                                                                                                                                                    |
| `workspace_tab_systems_inventory.md`              | ✅ ACCURATE                                                                                                                                                                                                                                                                 |
| `workspace_force_send_queue_dispatch.md`          | ❌ **Entirely stale**: `showQueuedMessageOptimistically`, `forceSendPendingQueueAtom`, `isQueueRuntimeStillWorking`, `hasTurnBlockingRunningEventForSession`, and `markQueueTurnSettled` no longer exist; `useQueueDispatch.ts` has been rewritten around the `turnLifecycle.ts` FSM — **memory must be rewritten** |
| `workspace_composer_bar_shared.md`                | ✅ ACCURATE                                                                                                                                                                                                                                                                 |
| `workspace_chat_input_surfaces_matrix.md`         | ⚠️ **Partly stale**: EditorArea max-height has changed back from `(isChatPanel ? 140 : 300)` to `(isChatPanelFullScreen ? 200 : 300)` — memory needs updating                                                                                                                                 |
| `workspace_subagent_ui_visibility_regex.md`       | ❌ **DRIFT**: regex `(?:agentsession                                                                                                                                                                                                                                        | subagent)-` does not match the current Rust `SUBAGENT_SESSION_PREFIX = "agent-"` and `SHADOW_SESSION_PREFIX = "shadow-"` — F-CRIT-5 |
| `workspace_terminalblock_loading_shimmer_weak.md` | ✅ ACCURATE                                                                                                                                                                                                                                                                 |
| `workspace_askquestion_streaming_returns_null.md` | ✅ ACCURATE                                                                                                                                                                                                                                                                 |
| `workspace_mode_switch_clears_draft.md`           | OPEN — 8 `[draft-bug]` traces remain                                                                                                                                                                                                                                       |
| `workspace_workstation_toggle_right_blank.md`     | OPEN — `[ws-blank-diag]` remains                                                                                                                                                                                                                                           |
| `workspace_sessionreplay_file_blank.md`           | OPEN — `[file-blank]` remains                                                                                                                                                                                                                                              |
| `workspace_message_reference_cards_drift.md`      | ⚠️ Partly stale; run vitest to confirm                                                                                                                                                                                                                                     |
| `workspace_default_pinned_actions_gap.md`         | ❌ **STALE**: DEFAULT_PINNED no longer pins skill-form setup-repo and includes `migrate()` cleanup — confirmed by the cross-layer audit                                                                                                                                      |

See [memory-verification.md](./memory-verification.md) for the complete memory verification.

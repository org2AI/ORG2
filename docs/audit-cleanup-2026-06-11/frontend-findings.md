# Frontend dead code and duplicated implementations: findings

> Scope: `src/`. The frontend exploration subagent was interrupted, so the main context directly rechecked some dimensions with ripgrep (dead modules / dead exports / ChatPanel engine structure / send paths / atoms with multiple sources of truth). Remaining tab-system duplication and empty-directory scans are follow-ups.

## 1. Dead modules (high confidence; removable)

| File                                   | Size                   | References                               | Risk                                         | Recommendation |
| -------------------------------------- | ---------------------- | ---------------------------------------- | -------------------------------------------- | -------- |
| `src/util/platform/tauri/gitBundle.ts` | ~250 lines (from memory) | 0 (none of three patterns matched `gitBundle`) | No matches in cross-language `*.rs` search; not a `window.*` global | **Delete** |
| `src/util/dialogs/openLinkDialog.ts`   | 1 file sampled            | 0 (`openLinkDialog` grep matched only itself) | Same as above | **Delete** |

**No longer included** (the memory baseline is stale):

- `localStorage.ts` → used by `useAppDeferredInitialization.ts:26`.
- `deferredInit.ts` → used by `useFirstPaintSignal.ts:21`.
- `gitActionDialog.ts` → used in 12 places.
- `channelActionDialog.ts` → used in 1 place.
- `gitAuthenticationDialog.tsx` → used in 1 place (`src/services/git/operations/remoteOps.ts:12`).

## 2. Unused `export default` keywords (keep named exports; remove only default)

All 14 service files have both `export default` and named exports. The grep `import\s+\w+\s+from.*<basename>` returned 0 matches, showing that all callers use named imports. Removing the `export default` keyword is **zero risk**:

| File                                                 | Line |
| ---------------------------------------------------- | ---- |
| `src/services/guiAgent/GUIAgentService.ts`           | 334  |
| `src/services/workStation/EditorTabService.ts`       | 176  |
| `src/services/workStation/EditorService.ts`          | 492  |
| `src/services/panel/PanelService.ts`                 | 71   |
| `src/services/git/GitOperationsService.ts`           | 83   |
| `src/services/search/SearchService.ts`               | 157  |
| `src/services/workStation/WorkStationViewService.ts` | 276  |
| `src/services/app/AppViewService.ts`                 | 50   |
| `src/services/file/FileService.ts`                   | 490  |
| `src/services/git/GitService.ts`                     | 469  |
| `src/services/terminal/TerminalService.ts`           | 288  |
| `src/services/test/TestService.ts`                   | 249  |
| `src/services/file/FileOperationsService.ts`         | 427  |
| `src/services/navigation/NavigationService.ts`       | 97   |

## 3. Misplaced files in the ChatPanel engine (PanelView bloat)

The `src/engines/ChatPanel/` root contains seven non-chat files (verified on 2026-06-11, slightly fewer than the 9+ in memory because `StickyNotesPanelView` has already moved).

| Misplaced file                         | Suggested location                                |
| ------------------------------------- | ------------------------------------------------- |
| `ProjectPanelView.tsx`                | `src/modules/Project/` or `src/features/Project/` |
| `WorkItemPanelView.tsx`               | `src/modules/WorkItem/`                           |
| `WorkspaceDashboardPanelView.tsx`     | `src/modules/Workspace/Dashboard/`                |
| `WorkspaceExplorePanelView.tsx`       | `src/modules/Workspace/Explore/`                  |
| `WorkspaceOverviewPanelView.tsx`      | `src/modules/Workspace/Overview/`                 |
| `BenchmarkRunBuilder.tsx`             | `src/features/Benchmark/`                         |
| `useBenchmarkSessionCreatorSlots.tsx` | `src/features/Benchmark/`                         |
| `LinkSessionToWorkItemModal.tsx`      | `src/modules/WorkItem/modals/`                    |

Keep these chat-related items in the ChatPanel root:

- `ChatView.tsx` / `ChatPanelContent.tsx` / `ChatPanelEmptyContent.tsx` / `ChatPanelHeader.tsx`
- `ChatFloatingComposer.tsx`
- `ChatHistoryOverrideContext.ts` / `ChatSessionContext.ts`
- `config.ts` / `types.ts` / `index.tsx`
- Directories: `adapters/`, `blocks/`, `ChatItems/`, `ChatHistory/`, `components/`, `events/`, `header/`, `hooks/`, `navigation/`, `rendering/`, `InputArea/`, `ThreadSelector/`

**ROI assessment**: file moves plus import-path updates only. No behavior changes. `git blame` will show a one-time change, which can be made clear with a commit message such as `chore: move <files> to <module>`.

## 4. Remaining tab-system duplication

**[partial - incomplete]** The frontend exploration subagent did not finish this before it was interrupted. Memory file `workspace_tab_systems_inventory.md` lists eight systems: WorkStation TabBar / PrimarySidebarLayout / EditorBottomPanel / Communication / SessionReplay / SidebarModules / TabPill / WorkItem detail. PanelTabBar is known to have absorbed ①↔③. Whether the remaining six are still independent has not been verified. **Action**: run a separate follow-up to "use `grep -l Tab` to list the N independent tab implementations in src/ and compare their props."

## 5. Duplicated send paths (anti-pattern #21/#36/#53)

`dispatchMessageBySessionType` is called from **14 places across 4 files** in production code:

| File                                                                  | Lines                        |
| --------------------------------------------------------------------- | ---------------------------- |
| `src/engines/ChatPanel/events/interactive_events/next-step/index.tsx` | 163, 236, 259                |
| `src/engines/ChatPanel/hooks/useWorkspaceChat/useWorkspaceChat.ts`    | 199, 393, 409, 426, 453, 468 |
| `src/engines/ChatPanel/hooks/useWorkspaceChat/useMessageDispatch.ts`  | 72, 162                      |
| `src/engines/ChatPanel/ChatHistory/hooks/useEditUserMessage.ts`       | 66, 203, 231                 |

**Expected shape**: `useMessageDispatch.ts` should be the only file holding the dispatcher; all other callers should go through it using intent → queue state machine. The current state clearly violates anti-pattern #53: "exactly one dispatcher owns append/dequeue/send."

**ROI**: medium (requires clarifying the semantics of next-step interactions and message editing); semantic acceptance requires e2e. This report only flags the issue; handle it separately in Phase 8.

## 6. Atoms with multiple sources of truth / shadow booleans (anti-pattern #51/#54)

Memory file `workspace_force_send_queue_dispatch.md` says several old atoms are GONE; this review found that claim **partly incorrect**:

### 6.1 `holdSessionQueueForStopAtom` — still active; a shadow boolean

It still exists and is read at:

- `src/store/ui/messageQueueAtom.ts:164` (queue decision point)
- `src/engines/SessionCore/control/sessionTimelineBoundary.ts:20, 132`
- `src/store/ui/__tests__/messageQueueAtom.test.ts:13, 220, 223, 232, 248`

**Violation**: anti-pattern #51, "Separate 'hold' atom duplicating FSM state." The FSM already has a `stopping` phase that should replace it.

### 6.2 `userInitiatedCancelAtom` — still active; a multi-purpose atom

Read at:

- `src/store/session/cliSessionStatusAtom.ts:174, 175`
- `src/engines/SessionCore/control/sessionTimelineBoundary.ts:17, 128, 134`
- `src/engines/SessionCore/hooks/session/useQueueDispatch.ts:49, 193`
- e2e helpers (not counted)

**Violation**: anti-pattern #54, "Multi-purpose cancel atom causing cross-concern bleed." Its name carries two concerns: (a) "post-Stop dispatch priority" and (b) "draft restoration gate."

### 6.3 `forceSendPendingQueueAtom` — confirmed dead

Its only remaining reference is `src/app/root/e2e/helpers/sessionHelpers/inspectChatState.ts:147`, a pure e2e helper. The atom definition can be removed and the e2e helper updated in the same PR.

## 7. Legacy modes / dead branches

**[partial - incomplete]** Memory file `workspace_agent_exec_mode_display_wire_split.md` suggests that modes such as `wingman` / `review` / `debug` in the wire union are no longer selectable in the picker. Grep the `AgentExecMode` enum and dead branches such as `mode === "wingman"`. Not run in this audit.

## 8. Empty directories / single-file directories

**[partial - incomplete]** Not run before the frontend subagent was interrupted. Follow up with `find src -type d -empty` and count `*.ts*` files in each top-level directory.

## 9. Missing Markdown / chat-block-content handling

ripgrep for `chat-block-content` matched **35+ files and 80+ locations**, covering all of ChatPanel/blocks/_ / ChatPanel/events/_ / ChatPanel/ChatItems/_ / InputArea/_. **No gaps found**—the main chat surfaces all have a typography wrapper. The fix recorded in memory file `workspace_chatpanel_chat_block_content_typography.md` has propagated.

If Phases 1–8 introduce a new chat surface, check it in that PR.

## 10. Other incidental findings

- The ~80 `export default` occurrences, including `src/router/routes/OpenSourceMarketUnavailablePage.tsx:29`, are component entry points and **should not be removed**; remove only those in service files (§2).
- The current state of the WS-as-debug-tee described in memory file `workspace_agent_events_via_websocket.md` was not rechecked; defer it.
- `src/util/dialogs/` contains both `.ts` and `.tsx` filenames (`gitAuthenticationDialog` is TSX), so the naming convention is inconsistent. **Not included in ROI ranking.**

## Open questions (user decisions needed)

1. **Remove all 14 service `export default` keywords together in Phase 2?** (Default answer: yes.)
2. **Use `git mv` for one Phase 3 PR or make one PR per PanelView?** (One PR is recommended; a clear commit message should suffice.)
3. **Should queue e2e be rerun before removing `holdSessionQueueForStopAtom` in Phase 7?** (Strongly recommended—this atom has been in production for some time, and removing it incorrectly could drop the first message after Stop.)
4. **Should the Phase 8 send-path consolidation be split across PRs?** (Recommend separate PRs for next-step, edit-user-message, and useWorkspaceChat, each with its own e2e.)
5. **Should the three unfinished dimensions (tab systems, empty directories, and legacy modes) get a follow-up audit?** (Open a follow-up task.)

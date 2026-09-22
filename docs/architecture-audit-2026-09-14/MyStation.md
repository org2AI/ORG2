# My Station architecture audit

**Scope.** My Station, the workstation surface: `src/modules/WorkStation/**`,
`src/store/workstation/**`, `src/store/ui/workStationLayout/**`, and the chrome it
shares from `src/components/WindowChrome`, `src/components/TabPill`,
`src/modules/shared/layouts`, `src/hooks/tabHost`, `src/hooks/ui/workbench` and
`src/config/workstation`. Agent Station replay views are included where they reuse
this chrome.

**Base.** develop `7197f36d4a` (every audited file is identical to `9fb4a9cb9d`).
Another session had uncommitted edits in
`src/modules/WorkStation/shared/StationPaneControls.tsx` and two AppShell tests;
findings that touch them are marked _in flight_.

**Method.** Six read-only slices ran in parallel: bar geometry (BAR), bar controls
and slot ownership (CTRL), sidebars and panels (SIDE), tab system and app shell
(TABS), CodeEditor (CODE), and the other surfaces (SURF). Each traced from rendered
components, registries, actions and shortcuts instead of counting references. The
lead re-checked the highest-impact claims against source (see Verification). `L1`–`L6`
are the lead's own findings. No source file was modified, and no type check, lint,
test or build was run.

Companion UI report: `docs/frontend-ui-audit-2026-09-14/MyStationChrome.md`.

**Follow-up PRs.** #1838 applies BAR-1 and BAR-5, and #1841 removes the dead code
listed at the end of this report. Findings they resolve are marked below.

## Acceptance criteria for the refactor program

- [ ] One definition of the 36px chrome row (height, insets, rule, drag region, top-edge offset); no raw `h-9` row roots in station chrome
- [ ] Pressed or open state on bar icon buttons is expressed only through `aria-pressed` / `aria-expanded` (glyph sizes stay tuned per icon)
- [x] Header insets animate only while a station opens or closes, and the chat header has no bottom rule (#1838)
- [ ] Shell components contain no tab-type or app-type conditionals; per-type behaviour comes from one table that is exhaustive over `WorkStationTabType`
- [ ] Every close path (tab ✕, ⌘W, actions, services) goes through one command with one unsaved-changes guard
- [ ] Each panel toggle has one writer, and no callback object mirrors atom state
- [ ] One header-slot type and no `ReactNode | Slots` union
- [ ] No props, handlers, atoms or components without a live caller in the audited tree (knip plus call-chain trace)
- [ ] Windows drag regions come from one helper
- [ ] The main window and the detached station window run the same init steps, or each gap is documented

## Layer coverage

| Layer                       | Covered | Notes                                                                                                             |
| --------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------- |
| 1 Compilation               | Skipped | Read-only audit; each fix PR owns its typecheck and lint                                                          |
| 2 Dead code and duplication | Yes     | Call-chain traces from TabBar, header strip and sidebar render trees, the tab registry, zod actions and shortcuts |
| 3 Naming                    | Yes     | Stale "40px", "DatabaseManager", "ActionBar" and `TabContentRenderer` docs                                        |
| 4 Semantic overloading      | Yes     | Term table below                                                                                                  |
| 5 Default branches          | Yes     | New-tab-type defaults table below                                                                                 |
| 6 Concept leakage           | Yes     | Tab and app knowledge in shell components, project logic in AppShell, engine → module imports                     |
| 7 New-developer confusion   | Yes     | Alias layers, hooks that return JSX, `showWorkStation` that toggles chat                                          |
| 8 Wire protocol             | Limited | No IPC change proposed; the AI-context snapshot reads status-bar state (SURF-4)                                   |
| 9 Init parity               | Yes     | Main window vs detached station window, table below                                                               |
| 10 Resolver symmetry        | Yes     | Sidebar width limits; close and open paths with different side effects                                            |

## Behaviour defects found during the audit

These are correctness issues, not refactors. Each should land as its own PR.

| ID      | Defect                                                                                                                                                                                          | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Confidence                                                                               | Fix                                                                                                                                                                                                                                                                                                     |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TABS-1  | ⌘W closes a tab without the unsaved-changes prompt that the tab ✕ shows; the editor's Save / Don't Save / Cancel dialog is unreachable                                                          | ⌘W: `src/hooks/navigation/useGlobalShortcuts/useTabShortcuts.ts:246-251` → `src/store/workstation/tabRegistry/atoms.ts:127-136` (no guard). ✕: `src/hooks/tabHost/useCloseTabWithGuard.ts:31`. Dialog: `src/modules/WorkStation/CodeEditor/Panels/EditorMainPane/hooks/useEditorPaneState.ts:136-261`, reachable only through `workstation-close-active-tab` (`src/hooks/tabHost/useWorkStationTabShortcutBridge.ts:20`), which nothing has dispatched since the initial commit | Path confirmed; whether the unsaved-drafts cache keeps the buffer was not traced         | `requestCloseTabsAtom({tabIds, source})` used by ✕, ⌘W, `editor.tab.*` and `EditorTabService`; delete the bridge and its 3 call sites                                                                                                                                                                   |
| SIDE-1  | "Toggle bottom panel" (Spotlight and the agent action `panel.toggleBottom`) flips an atom no panel renders; the header toggle returns null at all 5 mounts                                      | `src/store/ui/workStationLayout/bottomPanelAtoms.ts:19-61`; `PanelService.ts:52-54`; `panelActions.zod.ts:57-72`; `src/modules/WorkStation/shared/TabBarTrailingControls.tsx:28` (`onToggleBottomPanel` has no writer); panels archived in `cdf5a3a35a`                                                                                                                                                                                                                         | Confirmed                                                                                | Delete the panel contract (Wave 1). #1841 removed the header toggle and its two callback fields; the atoms, action and Spotlight entry remain                                                                                                                                                           |
| CODE-1  | CodeEditor removes and re-adds 8 global listeners on every render, and its memoized sidebar and content props change every render                                                               | Inline object at `src/modules/WorkStation/CodeEditor/index.tsx:117-120` in the deps of `hooks/useCodeEditorEvents.ts:517-524`; fresh return from `hooks/useGitDiffState.ts:325-338` consumed at `hooks/useCodeEditorHandlers.ts:113,129`                                                                                                                                                                                                                                        | Confirmed (render cost not measured)                                                     | Stable `actions` object; effect reads through `optionsRef`                                                                                                                                                                                                                                              |
| TABS-2  | Launchpad and the `+` menu reopen tabs by merging factory defaults over live data, overwriting a populated Source Control tab; the shortcut hint beside them runs a path that activates instead | `src/modules/WorkStation/AppShell/useWorkStationLaunchActions.ts:95-155` → `src/store/workstation/tabs/tabMutations.ts:49-72`; `src/services/workStation/WorkStationViewService.ts:66-69`                                                                                                                                                                                                                                                                                       | Confirmed                                                                                | Launch actions call `WorkStationViewService.open*`                                                                                                                                                                                                                                                      |
| SURF-2  | Channels replay publishes its breadcrumb and plan actions (Edit, Save, Open in My Station) into a header row it disables                                                                        | `src/modules/WorkStation/Chat/Communication/index.tsx:249,252-268`; only reader `shared/SessionReplay/SimulatorWorkstationTabHeader.tsx:47`, mounted at `SimulatorReplayChrome.tsx:51`; expectation in `Communication/TEST_CASES.md:52-53`                                                                                                                                                                                                                                      | Code path confirmed; not observed in the app                                             | Check in the app, then remove `showWorkstationTabHeader`                                                                                                                                                                                                                                                |
| SURF-5  | Project replay always receives `state={}`, so its tab strip holds at most the current event's operation                                                                                         | `src/modules/WorkStation/shared/simulatorRegistry/useSimulatorAppRenderer.tsx:83-90`; the only caller passes `{currentEvent, mode, isActive}` (`src/engines/Simulator/components/SimulatorContentArea/useSimulatorContent.tsx:94-98`); `src/modules/WorkStation/ProjectManager/SessionReplay/index.tsx:519-549`                                                                                                                                                                 | Code path confirmed; visible effect plausible                                            | Project replay calls `useSimulatorAppState`, like the other replay apps                                                                                                                                                                                                                                 |
| BAR-2   | On Windows, the tab bar, Agent Station header and sidebar tab row keep drag regions while the header strip directly below suppresses its own                                                    | Guarded: `AppShell/WorkstationTabHeader.tsx:68`, `src/engines/ChatPanel/ChatPanelHeader.tsx:375,433`. Unguarded: `shared/TabBar/index.tsx:388,415,493`, `AppShell/AgentStationTopHeader.tsx:110`, `SimulatorWorkstationTabHeader.tsx:57`, `ReplayTabBar.tsx:282`, `PrimarySidebarLayoutWithSections.tsx:340`. Rationale: `446abcd57f`                                                                                                                                           | Gap confirmed; runtime effect needs a Windows check                                      | `chromeDragRegionProps(enabled)` at all 17 sites                                                                                                                                                                                                                                                        |
| SIDE-7  | One primary-sidebar width atom has three sets of limits; Project can display a width above its own maximum                                                                                      | `CodeEditor/useCodeEditorPrimarySidebarConfig.ts:42-44` (240–500, reset 300); `src/modules/ProjectManager/ProjectManagerLayout/hooks/useProjectManagerSidebarConfig.tsx:138-139` (200–400); `src/config/workStationPrimarySidebar.ts:6-8` (200–500, default 240); unclamped render at `shared/WorkStationShell/index.tsx:243-245`                                                                                                                                               | Confirmed                                                                                | Limits only in `WORK_STATION_PRIMARY_SIDEBAR`                                                                                                                                                                                                                                                           |
| BAR-1   | Pane-collapse inset motion now differs by station: removed from the My Station tab bar and both chat header rows in `a5547913a7`, still on the Agent Station and MainApp headers                | `git show a5547913a7`; insets still flip at `shared/TabBar/index.tsx:392-401`; kept at `AgentStationTopHeader.tsx:109`, `src/modules/MainApp/shared/MainAppPageHeader.tsx:36`; rationale `src/modules/shared/layouts/viewContainerTokens.ts:28-34`                                                                                                                                                                                                                              | Removal confirmed; that change's audit calls it deliberate for the published chat header | **Decided:** insets animate only while a station (My Station or Agent Station) opens or closes, never on tab or session changes. Applied in #1838 through `src/modules/shared/layouts/useStationToggleInsetTransition.ts` on the My Station tab bar, the Agent Station header and both chat header rows |
| TABS-7  | In a detached station window, quick open, go to symbol, the open-tab shortcuts and maximize chat are gated on the `/orgii/workstation` prefix instead of `isWorkbenchPath`                      | `useGlobalKeydownShortcuts.ts:165-166,173,183-193,252-253`; `src/config/routes.ts:185-191`                                                                                                                                                                                                                                                                                                                                                                                      | Code confirmed; not run                                                                  | Gate on a named predicate in `routes.ts`                                                                                                                                                                                                                                                                |
| SURF-3  | Closing a browser tab from the tab strip skips the inspector and log cleanup that the unreachable close path performs                                                                           | `AppShell/useWorkstationTabList.ts:101-105` → `Browser/BrowserLayout/useBrowserTabSync.ts:239-256`; cleanup only at `useBrowserSessions.ts:265-285`                                                                                                                                                                                                                                                                                                                             | Plausible                                                                                | Move the cleanup into the sync teardown                                                                                                                                                                                                                                                                 |
| BAR-5   | The chat published header's bottom rule can never render                                                                                                                                        | `ChatPanelHeader.tsx:324-326` sets `joinWithFollowingRow: tabRowCollapsed \|\| …`, and `:391,:404` pass `hideBottomBorder={!tabRowCollapsed}`; the comment at `:321-323` says the publisher decides                                                                                                                                                                                                                                                                             | Confirmed                                                                                | **Decided:** the chat header has no bottom rule. Applied in #1838: removed the border class, `hideBottomBorder` and `joinWithFollowingRow`, whose only writer was the chat header                                                                                                                       |
| CODE-3  | `FileService.save` (agent `file.save`) can fall back to a legacy content atom that edits do not update                                                                                          | `src/services/file/FileService.ts:219-233`; `CodeEditor/hooks/useCodeEditor/useFileContent.ts:69-120`                                                                                                                                                                                                                                                                                                                                                                           | Plausible                                                                                | FileService reads the live content manager                                                                                                                                                                                                                                                              |
| CODE-11 | Git push and pull only stream output when CodeEditor has mounted and published an atom                                                                                                          | `CodeEditor/EditorLayout/components/EditorIntegrations/index.tsx:43-53` → `gitOutputAtom.ts:15` → `src/services/git/operations/types.ts:45-47`, `remoteOps.ts:78-92`                                                                                                                                                                                                                                                                                                            | Structure confirmed; mount-dependent fork plausible                                      | `createGitStreamingOps({repoId, repoPath})`                                                                                                                                                                                                                                                             |
| SURF-1  | `WorkStation/Canvas` listens for `canvas-event`, which nothing dispatches; Channels still mounts it for canvas-type events                                                                      | `src/modules/WorkStation/Canvas/index.tsx:78-155` (only references in `src` and `src-tauri`); `Communication/index.tsx:151,194-196`                                                                                                                                                                                                                                                                                                                                             | Dead listener confirmed; blank placeholder plausible                                     | Delete `Canvas/`, `CommunicationCanvas.tsx` and the `isCanvasEvent` branch                                                                                                                                                                                                                              |

## Findings by area

Effort: S under an hour, M half a day, L several days.

### 1. The 36px bars

**BAR-6 — One chrome row definition.** L · medium risk · confirmed. Absorbs L2, BAR-5, BAR-8 and BAR-2.

- 13 named definitions of the row: numeric 36 at `shared/TabBar/config.ts:8`, `src/components/WindowChrome/WindowsTopBar.tsx:28`, `src/config/windowChromeTokens.ts:8`, `src/config/detailPanelTokens.ts:101`, `src/engines/ChatPanel/header/chatPanelHeaderLayout.ts:2` and `CodeEditor/Panels/EditorPrimarySidebar/config.ts:73-74`; numeric 40 at `src/config/workstation/tokens.ts:52`; `h-9` class tokens at `tokens.ts:245,262`, `detailPanelTokens.ts:99`, `shared/StatusBar/statusBarTokens.ts:32` and `WindowChrome/HeaderActionGroup.tsx:14`.
- Plus 10 raw `h-9` row roots and 4 raw `h-11 min-h-11 pt-2` top-edge rows. `TabBar/index.tsx:389-403` duplicates `AgentStationTopHeader.tsx:111-124`.
- L2: `WorkstationTabHeader` and `SimulatorWorkstationTabHeader` are documented as mirrors but already differ in the Windows drag guard, content inset, toggle wrapper and separator rule.
- BAR-5: the chat header was the only writer of `joinWithFollowingRow`, so #1838 removes the field together with the chat rule; other rows still remove borders by string edits (`DetailSplitLayout/index.tsx:222`, `DetailPanelHeader/index.tsx:60`).
- Proposal: `CHROME_ROW` tokens and `<ChromeRow edge="top|inner" inset rule drag surface>` in `src/components/WindowChrome/`. `edge="top"` owns the 8px top gap, the collapsed-sidebar offset, the right-edge reservation and the inset transition. Migrate station rows first, then page and detail rows. This deletes `HEADER_CONTENT_*`, `FILE_BAR_ROW_CLASSES`, `HEADER_CLASSES.fileBar/pageHeader`, `SEARCH_TAB_ROW_CLASSES`, `TAB_BAR_CONTROLS_ROW_*`, `TAB_BAR_TRAILING_*`, `TAB_BAR_HEIGHT` and `TOP_BAR_HEIGHT`.

**BAR-8 — Insets named by what they align to.** S–M · low · confirmed.

- `HEADER_CONTENT_LEFT_PADDING_CLASS` (`pl-[15px]`, "aligns with the first tab icon") is only true in the chat pane (`ChatPanelHeader.tsx:422-424`). In My Station, tabs start after `pl-1.5` plus the station pill, both header strips override the default, and the file, URL, search and page rows use 15px under a header whose content starts at 59px or more.
- The same page-header content gets `px-3`, `pl-[15px] pr-[7px]` or `pl-[15px] pr-2` depending on host.
- Proposal: `CHROME_ROW.inset = { edge: 6, text: 15, detail: 16, list: 12 }`, each documented by its alignment target.

**CTRL-6 with CTRL-8, CTRL-11 and part of BAR-7 — One pressed state for bar buttons.** M · low–medium (visual) · confirmed.

- Glyph sizes are **not** part of this: the 6 size/stroke combinations across 21 `TabBarTrailingIconButton` sites are tuned per icon for optical consistency (confirmed by Harry, 2026-09-14). See Keep with reason.
- Pressed state has four paints: `bg-fill-2! text-primary-6!` ×7, `bg-fill-1! text-primary-6!` ×6, `bg-surface-selected! text-primary-6!` ×10, and the `active` prop. `aria-pressed` accompanies one of them (`WebUrlBar/index.tsx:544`). The hover icon swap is copied 4 times.
- `AppShell/SourceControlHeaderActions.tsx:38-54,77-133` has three copied handlers and buttons; its modes are declared again in `shared/SidebarModules/SourceControl/SourceControlFilterHeader.tsx:45-53`.
- Accessibility gaps: the "More" button in `SourceControlFilterHeader.tsx:251-272` is named only by its tooltip; `shared/TerminalInfoButton.tsx:29-33` opens on hover only.
- Proposal: a `pressed` prop on the chrome icon button (glyph size stays with each caller); icon-only pressed and open paint driven by `aria-pressed` / `aria-expanded`; `HeaderToggleGroup({items})` with a shared `SOURCE_CONTROL_MODE_META`.

**L3 with CTRL-4 — Header slot contract.** S, then M · medium · confirmed.

- `WorkstationTabHeaderSlots` (`src/store/workstation/workstationTabBarAtoms.ts:129`) re-declares `PublishedHeaderSlots` (`WindowChrome/PublishedHeaderSlotsView.tsx:9`). `isWorkstationTabHeaderSlots` (`:147-162`) duck-types by listing every key, so a new slot field that is missed there gets wrapped as content.
- 7 of 21 publishers pass a bare ReactNode. 10 pass fresh objects or JSX (for example `TabContent/renderers/githubPrDetail.tsx:94-98`), so the memo in `src/hooks/tabHost/useWorkstationTabHeader.ts:43-46` recomputes and the strip re-renders on every publisher render.
- The `workstationHeaderHost` key is threaded through 47 references in 17 files.
- Proposal: memoize per slot field and track ownership with a `useId` token; wrap the 7 bare publishers and delete the union and duck-type; later, provide a header outlet through context from each host and delete the host keys.

**L4 with CTRL-5 — Shell components know tab types.** M · medium · confirmed. Resolved by TABS-5.

- `WorkstationTabHeader.tsx:46-59,64,70` special-cases Source Control, Browser and the Launchpad; `AppShell/CodeSidebarHeaderActions.tsx:34-45` deny-lists 7 tab types; `SourceControlHeaderActions.tsx:57-58`, `AppShellContent.tsx:139-142` and `statusBarVisibility.ts:13` also check the type.
- Five renderers publish flags that never change for their type: `chatSession.tsx:175`, `agentConfig.tsx:141`, `githubIssueDetail.tsx:92`, `githubPrDetail.tsx:97`, `src/modules/MainApp/WorkManagement/index.tsx:183-194`.

**L5 with CTRL-3 and SURF-4 — Status-bar state is not a command bus.** M · low · confirmed.

- `activeStatusBarAppAtom` (`statusBarAtoms.ts:99`) is `activeHostAtom` under another name; `StatusBarAppType` (`src/types/ui/workstation.ts:11`) duplicates `WorkstationTabHost` (`src/store/workstation/tabHost.ts:21`).
- `StatusBarCallbacks`: `onToggleBottomPanel` and `bottomPanelCollapsed` have no writer (removed in #1841); `devToolsOpen`, `onPrevSession` and `onNextSession` have no reader; `primaryPanelCollapsed`, `onTogglePrimaryPanel` and `layoutMode` mirror atoms that their readers already fall back to; `onOpenSettings` is a `goToSettings` call. The `project` slot has two writers, and Project Manager's cleanup erases AppShell's entry.
- AppShell subscribes to 8 panel atoms mostly to fill the mirror.
- `GlobalStatusBarState` gives every app every field: 8 written fields are never displayed, and `appType` repeats the slot key.
- Proposal: readers use the atoms; `useOpenEditorSettings()`; a browser-only commands atom; `StatusBarStateByApp` keyed by app; the AI snapshot (`src/services/context/appUiSnapshot.ts:91-103`) reads browser tab data directly.

**L1 with BAR-3 — Token file dead exports and false docs.** S · low · confirmed.

- `HEADER_HEIGHT = 40` (`tokens.ts:52`) is documented as the height of every Workstation header, has 0 importers, and every bar is 36px.
- Also unreferenced: `TAB_BAR_CONTROLS_ROW_BASE_CLASS`, `TAB_BAR_CONTROLS_ROW_PADDING_TRAILING_ONLY` (identical to `…_FULL`), `TAB_BAR_CONTROLS_ROW_CLASS`, `SEARCH_TAB_ROW_CLASSES.withBorder`, `SECTION_ACTION_BUTTON`, 9 of 11 `HEADER_BUTTON` keys, 5 `PANEL_CONSTANTS` fields and 2 `STATUS_BAR_TOKENS` fields.
- One file-bar string has three names, each with one user. `HEADER_CLASSES.sectionTitle` documents 12px padding but uses `px-4` with an arbitrary `h-[40px]`, and has one real user.
- False docs: "Used by … ActionBar" (`tokens.ts:7-8`), a raw `<button>` example (`:114-127`), "40px" in `workstationTabBarAtoms.ts:136`, `useWorkstationTabHeader.ts:4`, `SimulatorWorkstationTabHeader.tsx:4` and `SidebarToggleButton.tsx:159`, and "DatabaseManager" / "32px pills on 40px row" in `TabBar/index.tsx:9-11`.
- #1841 removes `HEADER_HEIGHT`, the unreferenced tokens and keys above except the `STATUS_BAR_TOKENS` fields, and the false docs inside `tokens.ts`. The file-bar names, `sectionTitle` and the "40px" and "DatabaseManager" comments in other files remain.

**CTRL-1 with CTRL-2 and BAR-4 — Bar code that never renders.** S · low · confirmed · touches an in-flight test.

- The project search button in the tab bar: all 4 registrations pass `onSearch: null` (`ProjectManager/Projects/index.tsx:243`, `LinearProjects/index.tsx:303`, `ProjectWorkItemsTabContent.tsx:259`, `WorkItems/hooks/useWorkItemsTabBarState.ts:104`), and `ProjectManagerWorkItemsTabBarTrailing.tsx:29` returns null without it. The visibility test mocks the component so it renders.
- Never rendered or never passed: `TabBarBottomPanelToggle` (5 mounts), `TabBarDevToolsToggle` (0 mounts), `TabBar.onMoreOptions`, `PrimarySidebarLayoutWithSections.headerSlot`, `TabBarPlusMenu.items`, `AppSwitcherChip` `onClick` and `hidden`, `SidebarToggleButton.showShortcut`, `StationTabBarLeading.trailing`, and `onNewTabShortcutId` on a bar with no new-tab button.
- #1841 removes both toggles, `TabBar.onMoreOptions` and `PrimarySidebarLayoutWithSections.headerSlot`. The project search chain and the other never-passed props remain.

**CTRL-7 with CTRL-9 and CTRL-10 — Station controls.** S · low · confirmed · in flight.

- Maximize chat is one command drawn by three components with four looks (`StationPaneControls.tsx:180-209,247-309`, `StationHeaderControls.tsx:37-52`); in an unpinned split view two are visible with different labels. The `directionalHover = true` path has no live caller.
- The station pill renders through six layers (`WorkstationTabBar` → `WorkStationTabBarLeading` → `StationTabBarLeading` → `TabBarLeadingLayout` → `NoDragRegion` → `StationModeChip` → `StationModePill`). `useWorkstationTrailingSlot` is a hook that returns a fresh fragment each render, defeating the memoized `TabBar`.
- `AgentStationTopHeader.tsx:86-96` registers `toggle_captions` with its own window listener outside the central shortcut table, with no text-input guard. `src/modules/shared/layouts/SplitViewLayout.tsx:62-73` handles ⌘B in the bubble phase, so it only fires while typing in an input.

### 2. Sidebars and panels

**SIDE-7 with SIDE-9 and TABS-3 — Primary sidebar and layout state.** S–M · low–medium · confirmed.

- Six toggle implementations write `workStationPrimarySidebarCollapsedPersistAtom` (`SidebarToggleButton.tsx:176-178`, `useWorkStationPanels.ts:111-113,175-177`, `PanelService.ts:41-43`, `WorkStationViewService.ts:250-268`, `useSimulatorPlaceholderActions.ts:73`).
- Two zod actions advertise `toggle_workstation_sidebar` (`panelActions.zod.ts:43`, `workStationViewActions.zod.ts:192`). The fallback chain in `useTabShortcuts.ts:158-205` duplicates six zod handlers and always runs, because `GlobalShortcuts` (`src/app/root/AppBootstrap.tsx:97`) mounts above every `ActionSystemProvider`.
- `useWorkStationPanels` returns 19 fields, of which 9 are read, and subscribes to 7 atoms. Seven base/persist atom pairs; 6 of 14 storage keys are dead; two chrome atoms are never written.
- Proposal: `toggleWorkStationPrimarySidebarAtom`; `persistedLayoutAtom(key, parse, {clamp, toggle})`; focused selectors; one limits token.

**SIDE-4 — WorkStationShell API.** M · low–medium · confirmed.

- An omitted `primarySidebarConfig` renders an expanded, empty 240px sidebar (`shared/WorkStationShell/index.tsx:136-152`, `config.ts:84-92`), which forces 4 hand-written opt-outs.
- Defaults are applied twice (`buildPrimarySidebarConfig`, `config.ts:117-139`, and the shell). The reversed grid and `secondary-panel--left` are unreachable (`index.scss:115-139`, `index.tsx:296-299`); several BEM classes have no rules; resize wiring is duplicated for the primary and secondary panels (`index.tsx:160-226`).
- Proposal: an omitted sidebar means no sidebar; defaults in one place; delete the dead CSS; `useDockedPanelResize`. The E2E spec `org-detail-ui.spec.mjs:58-60` queries the grid class.

**SIDE-5 — Sidebar section stack.** M · low · confirmed.

- In `shared/PrimarySidebarLayout/PrimarySidebarLayoutWithSections.tsx` the tab dropdown cannot open (`:282-294`, portal `:368-412`); `globalSection`, `headerSlot` and `widthClass` are unused; 6 of 7 callers pass `hideTabs` and 5 wrap a single tab; section resize assumes a 600px container (`:217`); section state is seeded once (`:141-166`), so later sections ignore their defaults. `PanelSectionHeader` has 0 consumers.
- #1841 removes the dropdown, `globalSection`, `headerSlot`, `widthClass` and `PanelSectionHeader`. The resize assumption and seed-once section state remain.
- Proposal: `SidebarSectionStack` that measures its real container, plus a thin tabs wrapper for the two multi-tab callers.

**SURF-6 with SIDE-8 and SURF-7 — Replay shells and placeholders.** M · low–medium · confirmed.

- `ReplayShellPlaceholder` (`shared/SessionReplay/ReplayShellLayout.tsx:42-56`) has 0 users while its body is inlined 4 times; `useSimulatorAwaitingAgentCaption` always returns `""` (13 `caption=` props); `useSimulatorPlaceholderActions` always returns `[]`; `QuickActionsPanel` is never rendered; `usePrimarySidebarSurface` returns a constant.
- Project, Channels and Canvas replay roots bypass `ReplayShellLayout`; "no sidebar" is a hidden toggle in one app and a disabled toggle in two.
- Proposal: `ReplayShellLayout` gains `placeholder`, `header` and `sidebar: ReactNode | null`; `SimulatorReplayChrome` becomes internal.

**SIDE-6 with SURF-9 and SURF-10 — Browser DevTools dock.** M · low–medium · confirmed.

- DevTools content and secondary-panel config are duplicated in `Browser/BrowserLayout/index.tsx:143-215` and `Browser/SessionReplay/index.tsx:197-267` with drifted defaults (height 300 vs 240, width unpersisted); the replay status bar is forced to `h-[48px]!` (`:306`); `WebInspector` requires and discards `width`.
- The console and network log hooks share one structure (10-session LRU, poll generation, three clear functions).
- Proposal: `useBrowserChrome()` returning `{secondaryPanelConfig, statusBarProps}`, persisted panel size, and `useSessionLogPoller<T>`.

**SIDE-10 — Section-header count badge.** S–M · low · confirmed. `COUNT_BADGE.base` appears 7 times with 6 identical tone ladders; the DevTools section header is hand-rolled without `aria-expanded`. Proposal: `count` and `countTone` on `SidebarSectionHeader`.

**CODE-13 with SIDE-11 — Source Control lives inside the Explorer sidebar.** L · medium · confirmed.

- `EditorPrimarySidebar` renders Files and Search only (`index.tsx:268-290`) but holds 102 of its 162 files (21,293 of 29,386 lines): Source Control, PR, Issues, Stash, History and Worktree code, consumed through `shared/SidebarModules/SourceControl` with 13 deep imports back into CodeEditor. 66 deep import statements from 33 files outside CodeEditor.
- The tab-sidebar registry is a side-effect Map with 2 entries and an untyped `surface?: Record<string, unknown>` payload.
- Proposal: move-only PRs into `src/modules/WorkStation/SourceControl/` with a public `index.ts`, after the CODE-12 extractions; a static `TAB_SIDEBARS` map with a typed prop.

### 3. Tab system and app shell

**TABS-5 with SIDE-2 and CTRL-5 — One tab-type table.** L (two PRs) · medium · confirmed.

- A new tab type edits about 20 per-type lists across about 15 files: the type union, ownership and teardown lists, `FILE_TAB_TYPES`, `DEFAULT_CATEGORY_BY_TYPE`, host mapping, storage whitelist, renderer registry and loading skeleton, icon, titles, the sidebar allow- and deny-lists, the repo allow-list, status-bar and header-strip checks, recents, retention and chat placement.
- `category` exists only to derive the host, and a persisted category wins over the type (`tabHost.ts:55`), so changing a category would mis-route saved tabs.
- Proposal: `src/store/workstation/tabs/tabTypePolicy.ts` (`satisfies Record<WorkStationTabType, …>` with host, ownership, persist, cachedPerRepo, ephemeral, sidebar, requiresRepo, statusBar, headerStrip, retentionPool, titleKey) and `TAB_TYPE_VIEWS` in `TabContent/registry.ts` (renderer, fallback, icon, sidebar). Precedents: the exhaustive renderer map, `tabRetention.ts`, `getWorkstationTabOwnership`.

**TABS-1 with TABS-2, SURF-3 and SURF-12 — One close command, one open path.** M–L · medium · confirmed.

- Close: four paths with three different sets of side effects; 5 of 6 `file.close*` zod actions duplicate `editor.tab.*`.
- Open: the `+` menu bypasses the service. Browser has four open paths, a tab factory with 0 production callers whose ids `isBrowserSessionTab` would reject (`tabs/factories/browser.ts:43-53`), and its sessions ↔ tabs sync lives inside `BrowserLayout`, which forces three extra AppShell mount rules (`AppShellContent.tsx:96-139`).
- Browser dead machinery: the shortcut bridge, most of `useBrowserPaneState`, every browser tab store action except `switchBrowserTabAtom`, the WebViewport tab bar (`hideTabBar` is always true), the browser host context and its 57-line memo, and the `devtools` tab type (0 creators).
- Proposal: `requestCloseTabsAtom`; launch actions call the service; `openBrowserSessionAtom`; move request handling and the sync into the headless `BrowserEventBridge` (main window only: `src/modules/StationWindow/index.tsx:209` also mounts the browser app).

**L6 with TABS-6 and TABS-8 — AppShell: frame, two surfaces, host table.** M · medium · confirmed.

- `isAgentStation` appears 37 times in 7 AppShell files. A disabled `AgentStationChromeFrame` renders the same wrapper as its two parents. `useCurrentTurnLastAgentMessage`, which builds a Map of every event, also runs in My Station.
- Three near-identical host mount blocks define "active" three ways; `isActive` is always `true` at both mount sites (`src/modules/index.tsx:381`, `StationWindow/index.tsx:223`); six boolean props; the 60s keep-alive value is repeated in four files; `visitedModes` is a `Set<string>`.
- Proposal: `StationFrame` → `MyStationSurface | AgentStationSurface`; `CONTENT_HOSTS satisfies Record<WorkstationTabHost, {Component, extraMount?}>`, reusing the `hostMountPolicy.ts` predicates; `useWarmHosts(): ReadonlySet<WorkstationTabHost>`; one `visible` flag through a `HostSlot`.

**TABS-4 — Tab dead code.** S · low · confirmed. `useLaunchpadDashboardTabCleanup` removes a type that no longer exists; the `git-diff` branch in `SidebarSlot.tsx:65-68` is unreachable; the `db-*` categories have no tab types; `tabs/types.ts:77-83` describes per-category mounting that the registry no longer does.

**TABS-7 — Detached station window ownership.** M · high · needs a decision. Both windows load and write the same `workstation:tabs:v4:*` keys (the known #1711 limitation), terminal teardown runs per window and may kill PTYs shown in the other (plausible), and the shortcut gate above. Decide which window owns tab writes before writing code.

### 4. CodeEditor

CODE-1, CODE-3 and CODE-11 are in the defect table.

- **CODE-2 — Dead code.** S · low · confirmed. `IDE_APP_CONFIG` (`SessionReplay/config.ts:257-266`); `clearFileCache` and `updateCachedFileMtime` (`hooks/fileContent/cache.ts:364,411`); the indexing-progress atoms (254 lines, only reader `shared/StatusBar/EditorStatusBar.tsx:87-90`); the `FileSearchPanel` overlay (362 lines, can never open; SIDE-3); the staging API in `hooks/sourceControl/useFileSelection.ts:63-150`, whose name also collides with `EditorPrimarySidebar/hooks/useFileSelection.ts`. `CODE_EDITOR_ICONS` and `searchZodActions` are already gone. #1841 removes `IDE_APP_CONFIG`, `updateCachedFileMtime`, the indexing-progress atoms and the `FileSearchPanel` overlay; `clearFileCache` and the staging API remain.
- **CODE-3 — Legacy file-content pipeline.** M · medium · confirmed. 12 `EditorContentProps` fields (`Panels/EditorMainPane/types.ts:20-46`) are never read by `EditorContent` (`Panels/EditorMainPane/index.tsx:51-68`), while `hooks/useCodeEditor` re-reads the file into atoms on every selection.
- **CODE-4 — Preview-type switch in three files.** S. `BinaryView.tsx:110-179`, `GitDiffBinaryPreview.tsx:54-91`, `shared/DiffFileSection/diffFilePreview.tsx:48-73` → `renderFilePreview()`.
- **CODE-5 — Editor display settings wired six times.** S → `useEditorDisplaySettingsProps()`.
- **CODE-6 — Source Control tree built and flattened twice per render.** S (`useFileTreeHandling.ts:94-195` and `virtualizedTreeUtils.ts:120-183`).
- **CODE-7 with SURF-8 — Commit and PR diff layout twins.** M. Same resizable file-list column, placeholders and read-only diff; both carry a collapsed rail nothing opens. → `FileListDiffLayout` and `GitFileListColumn`; `GitStatusBadge` in diff section headers and navigation rows; delete dead `DiffSectionList` / `GitFileList` options.
- **CODE-8 — CSV and XLSX editors duplicate their draft cache and cell-patch helpers.** S, about 180 lines.
- **CODE-9 — Path-tree builder shared by live Source Control and replay; replay item labels built twice with different rules.** S.
- **CODE-10 — 19 hand-rolled `let cancelled = false` loaders and 0 `useAsyncData`.** M, incremental.
- **CODE-12 — Largest functions (sizes plausible).** M each:
  1. `TimelineContent/index.tsx:36-371` — about 335 lines, two variants that never mix; split `GitFileTimeline` / `SessionFileTimeline`.
  2. `SourceControlContent/index.tsx:55-580` — about 525 lines, about 70 props, 36 forwarded unchanged.
  3. `PrLevelActions.tsx:118-455` — about 337 lines; picks success messages by matching English labels.
  4. `SessionReplay/FileSidebar.tsx:82-502` and `SessionReplay/index.tsx:54-471`.
  5. `IssuesContent/index.tsx:66-481` — copy the PR split (`useIssueSections`, `useNewIssueForm`).

### 5. Other surfaces

- **SURF-7 — Single-consumer abstractions.** S. `CountBadge` (5 variants, one use), `FloatingBar` (variant union of one), `PropertyEditor` (502 lines, one consumer), `TableSurface` (5 unused props and a dead pagination branch).
- **SURF-11 — Stale ownership.** S/M. "Database Manager" in 18 docs although no such module exists; `src/store/workstation/database/atoms.ts` contains no atoms; `Chat/Communication` is the Channels replay app and 5 engine files import it.

## Layer 4 — term overload

| Term                | Meanings                                                                                                                                                                                 | Proposal                                                       |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| mode                | station (`types/ui/workstation.ts:4`); content host (`isCodeMode`, `visitedModes` in `useAppShellDock.ts:9`); `replayMode`; sidebar `layoutMode`; `chatPanelMode`                        | "mode" means station only; `warmHosts`, `sidebarSide`          |
| host                | tab content host (3 values); header slot host (5 keys, `workstationTabBarAtoms.ts:212-218`); simulator host (`hostMountPolicy.ts:65`); `windowsHost`; `hooks/tabHost/` holds panel hooks | `ContentHost`, `HeaderSlotOwner`                               |
| app                 | content host (`activeApp` in `CodeSidebarHeaderActions.tsx:49`); simulator dock `AppType`                                                                                                | "app" for dock apps only                                       |
| shell               | two components named `AppShell` (`src/modules/index.tsx:127`, `WorkStation/AppShell/index.tsx:46`); `WorkStationShell` is the host pane layout; `ReplayShellLayout`                      | `WorkbenchLayout`, `StationSurface`, `HostPaneLayout`          |
| station / simulator | `stationModeAtom` lives in `simulatorAtom.ts:278`; `WorkStationViewService.showWorkStation` toggles chat (`:134-158`)                                                                    | `store/workstation/station.ts`; `toggleStationChat`            |
| launchpad           | type `start`, category `launchpad`, `WorkStationStartPage`, chat start-page tab                                                                                                          | `Launchpad*` identifiers; keep the persisted `"start"` literal |
| workbench           | `isWorkbenchPath` vs `isWorkStationRoute` vs a hard-coded `/orgii/workstation` prefix                                                                                                    | two named predicates in `routes.ts`                            |
| casing              | 60 `*WorkStation*` vs 286 `*Workstation*` identifiers; 29 `workStation*` vs 84 `workstation*`                                                                                            | codemod to `Workstation`, last                                 |

## Layer 5 — what a new tab type silently gets

| Site                                                    | Default                                                          |
| ------------------------------------------------------- | ---------------------------------------------------------------- |
| `tabHost.ts:39` `default:`                              | Code host                                                        |
| Storage whitelist (a Set with no completeness check)    | Tab dropped on restart                                           |
| `CodeSidebarHeaderActions.tsx:34-45` deny-list          | Search button in the header strip                                |
| `useCodeEditorPrimarySidebarConfig.ts:24-29` allow-list | File-tree sidebar                                                |
| `AppShellContent.tsx:139-142` repo allow-list           | "Cannot find repo" placeholder when the repo path is missing     |
| Ownership teardown allow-list                           | Live resource not torn down on close                             |
| `WorkstationTabIcon.tsx:199` `default:`                 | `file.txt` icon                                                  |
| `WorkstationTabHeader.tsx:59`                           | Header strip shown (the Launchpad needed follow-up `5dbf4fdc61`) |

## Layer 9 — init parity

| Step                                                                                                  | Main window                | Detached station window                                      | Intentional?                |
| ----------------------------------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------ | --------------------------- |
| AppShell effect hooks (Launchpad seed, terminal teardown, status-bar callbacks, simulator panel sync) | Yes                        | Yes, same component                                          | Yes, but see the next rows  |
| Tab store load and write (`tabs/atoms.ts:73-75,184-193`)                                              | Yes                        | Yes, same keys, no resync                                    | No (known #1711 limitation) |
| Route entry                                                                                           | `useWorkstationRouteEntry` | No-op; intents arrive via `useStationWindowNavigation.ts:31` | Yes                         |
| Palette and tab shortcuts                                                                             | Prefix check passes        | Prefix check fails                                           | No                          |
| Terminal teardown when the Terminal tab closes                                                        | Kills PTYs                 | Kills PTYs from its own list                                 | Plausible bug               |

## Suggested PR order

One responsibility per PR.

1. **Wave 0 — defects.** TABS-1 · CODE-1 · TABS-2 · BAR-2 (with a Windows smoke test) · SURF-2 and SURF-5 (check in the app first) · TABS-7 shortcut predicate · SIDE-7 limits. BAR-1 and BAR-5 are applied in #1838.
2. **Wave 1 — dead code, by area.** #1841 covers the never-rendered bar controls (CTRL-2, BAR-4), the dead tokens (L1, BAR-3), the section dropdown (SIDE-5), the `FileSearchPanel` overlay (SIDE-3) and most of CODE-2, including the indexing atoms. Remaining: bottom panel (SIDE-1) · project search chain (CTRL-1) · the rest of CODE-2 · legacy content pipeline (CODE-3) · replay placeholders (SIDE-8) · Browser dead paths (SURF-3) · Canvas (SURF-1) · tab dead code (TABS-4).
3. **Wave 2 — state and contracts.** Status-bar state (L5, CTRL-3, SURF-4) · primary sidebar and layout storage (SIDE-7, SIDE-9, TABS-3) · header slot steps 1–2 (L3, CTRL-4).
4. **Wave 3 — bar primitives.** `ChromeRow` (BAR-6, BAR-5, BAR-8, L2) with screenshots per host · pressed state for bar buttons (CTRL-6, CTRL-8, CTRL-11) after the in-flight `StationPaneControls.tsx` edit lands · station controls (CTRL-7, CTRL-9, CTRL-10).
5. **Wave 4 — structure.** Tab-type table (TABS-5, store half then view half) · AppShell split and host table (fix `useKeepAliveWindow` pruning first) · WorkStationShell and section stack (SIDE-4, SIDE-5) · replay shell (SURF-6) · CodeEditor extractions (CODE-4 to CODE-10, CODE-12) · git streaming (CODE-11) · Browser chrome and sessions (SIDE-6, SURF-9, SURF-10, SURF-12) · moves last: Source Control (CODE-13, SIDE-11), Channels (SURF-11), naming codemod (TABS-9). TABS-7 needs a decision before any code.

## Keep with reason

- Header icon glyph sizes and strokes (14, 16 and 18px; 1.75 or 2) — tuned per icon so different glyphs read at the same visual size.
- `hostMountPolicy.ts` pure predicates — the tested mount matrix; the host table should call them.
- The ownership switch with no `default` and the exhaustive renderer registry — the model for the tab-type table.
- `useAppShellSimulatorPanelSync` gated mirror — protects native webview geometry.
- The simulator host mounting only while displayed — a deliberate cost asymmetry with My Station keep-alive.
- `removeTab` and `FileOperationsService` closing without a prompt — programmatic deletes should not ask.
- Owner-checked cleanup in the header publish hook — correct for retained panes.
- Pinned right-edge chrome (`src/hooks/ui/workbench/usePinnedWorkbenchChrome.ts:110-167`) — one visibility predicate and one reservation hook for all five consumers.
- 44px top-edge rows next to 36px inner rows — the 8px gap aligns the band with the traffic lights; two variants of one row token, not drift.
- `ReplayTabBar` as a separate component — read-only strip with no drag, close or menu; share geometry only.
- Left/right sidebar placement — a live setting.
- The focused-chat trail rail as its own shell — its two title-fold toggles are below the three-occurrence threshold.
- Replay panels separate from live panels — different data model; share the path-tree builder only.
- Replay diffs on `VirtualizedModernDiff` — replay edits are fragments whose start lines may be unreliable.
- `GitDiffContent`'s editable conflict path — no other diff view does this.
- The 29 effects that sync `xRef.current` — no canonical `useLatestRef` exists, and `useMounted.ts` documents the React Compiler limits.
- `DiffSectionList`, `TableSurface` and `SharedBrowserHostSlot` — genuinely shared.
- `Chat/Communication` content — built from engine pieces rather than copied from `engines/ChatPanel`; move it, don't merge it.

## Verification

The lead re-checked these against source: TABS-1 (⌘W path, dead bridge event, unreachable dialog), TABS-2 (merge on reopen), TABS-3 (duplicate actions, `GlobalShortcuts` mount order), TABS-6 (`isActive` always `true`), TABS-7 (prefix gate), CODE-1, CODE-3 (unused props), SIDE-1, SIDE-7 (limits), SIDE-8 (constant caption), BAR-1 (`git show a5547913a7`), BAR-5, CTRL-1, CTRL-4 (inline publisher object), SURF-1, SURF-2, SURF-5, and L1–L6. The remaining findings rest on each slice's static trace and carry the confidence shown.

Not done: no tsc, lint, tests or builds; no app run on any platform; no screenshots; no knip run; no performance measurement. Re-render and listener findings are code-path claims, not profiles.

## Follow-up applied (2026-09-14, #1838)

Decisions from review: header icon glyph sizes are intentional; insets animate only while a station opens or closes; the chat header has no bottom rule.

- `src/modules/shared/layouts/useStationToggleInsetTransition.ts` (new): returns `CHROME_INSET_TRANSITION_CLASSES` for 320ms after `effectiveChatPanelMaximizedAtom` flips, added in the same render as the new inset; otherwise empty, so tab and session changes snap.
- Applied on `src/modules/WorkStation/shared/TabBar/index.tsx`, `src/modules/WorkStation/AppShell/AgentStationTopHeader.tsx` (was always on), and the tab row and folded published row in `src/engines/ChatPanel/ChatPanelHeader.tsx`. `MainAppPageHeader` keeps its always-on transition (not a station).
- `src/engines/ChatPanel/header/ChatPanelPublishedHeader.tsx`: no border class, no `hideBottomBorder`.
- `joinWithFollowingRow`, which only `ChatPanelHeader` set, is removed from both slot types, the duck-type key and the chat publish equality check. Both station header strips now always draw their rule, as they already did.
- Tests: new `useStationToggleInsetTransition.test.ts` (at rest, tab re-renders, close/open window, quick reopen); `ChatPanelPublishedHeader.test.ts` (never a rule; transition only when given); `ChatPanelHeader.test.ts` (a reservation at rest carries no transition).
- Verified on the PR branch: `prettier --check`, `oxlint` and `eslint --max-warnings 0` on the 14 changed files pass; `tsgo --noEmit` exit 0; `vitest run --config config/vitest.config.ts` over the shared layouts, chat header, AppShell, replay, tab bar, workstation store and WorkManagement suites: 106 files, 671 tests passed; `check-test-placement` consistent; `git diff --check` clean. Not verified: the motion itself in the running app, and the typed-lint ratchet.

## Dead code removed (2026-09-15, #1841)

Behaviour-neutral deletions, each re-verified by call-chain trace before removal (64 files; 1,902 lines deleted, 46 added):

- **Bar controls:** `TabBarTrailingControls.tsx` and its test (bottom-panel toggle null at all 5 mounts, DevTools toggle never mounted), their 5 mounts and barrel export, `FileHeader.beforeMoreMenuSlot`, `StatusBarCallbacks.onToggleBottomPanel` / `bottomPanelCollapsed`, and the tab bar's never-passed more-options button (`onMoreOptions`).
- **Tokens:** `HEADER_HEIGHT`, `TAB_BAR_CONTROLS_ROW_BASE_CLASS`, `…_PADDING_TRAILING_ONLY`, `TAB_BAR_CONTROLS_ROW_CLASS`, `SECTION_ACTION_BUTTON`, `ROW_BUTTON`, 9 unused `HEADER_BUTTON` keys (the two live class strings are unchanged), `SEARCH_TAB_ROW_CLASSES.withBorder`, 5 unused `PANEL_CONSTANTS` fields; two inset constants un-exported; stale "Used by" docs.
- **Sidebar sections:** `PanelSectionHeader` (0 consumers); `PrimarySidebarLayoutWithSections`' never-openable tab dropdown and its `globalSection`, `headerSlot` and `widthClass` props; `CollapsibleSection.showTopBorder` (only the removed global section passed it); the `refresh-git` title special case (no such action key).
- **CodeEditor:** the `FileSearchPanel` overlay and its visibility state, 4 handlers and `onSearchClick` prop; the indexing-progress atoms, `useIndexingIndicator` and the status-bar indicator, with its 8 message keys in all 13 locales; `IDE_APP_CONFIG`; `updateCachedFileMtime` and its tests.
- **i18n:** `common:tooltips.moreOptions` (more-options button) and `sessions:simulator.titleBar.showBottomPanel` (bottom-panel toggle), in all 13 locales.

Verified on the PR branch: `prettier --check`, `oxlint` and `eslint --max-warnings 0` on the 30 changed TypeScript files pass; `tsgo --noEmit` exit 0; `vitest run --config config/vitest.config.ts` over `src/modules/WorkStation`, `src/store/workstation`, `src/store/ui/workStationLayout`, `src/modules/shared/components/FileHeader`, `src/modules/shared/layouts` and six dependent suites outside them: 248 files, 1,554 tests passed; `check:i18n-keys` reports no missing and no new unused keys; `check-test-placement` consistent; `git diff --check` clean.

Possible visible effect: file headers at the five former toggle mounts no longer render an empty right-side container when they have no other right controls, which can remove one flex gap.

Still dead, deliberately left for separate changes:

- Bottom-panel atoms, `PanelService.toggleBottomPanel`, the `panel.toggleBottom` action and its Spotlight entry: removing them removes a visible (no-op) command.
- Project tab-bar search chain (`ProjectManagerWorkItemsTabBarTrailing` and its atoms): its visibility test is being edited by another session.
- `useWorkStationTabShortcutBridge` and the unreachable Save / Don't Save dialog: decide together with the ⌘W close fix (TABS-1), which may reuse the dialog.
- Browser: unreachable close/new-tab handlers, pane state, store actions, WebViewport tab bar, host context, the `devtools` tab type, unread prev/next-session status-bar callbacks (SURF-3).
- Replay placeholder helpers that return constants, `QuickActionsPanel`, `ReplayShellPlaceholder` (SIDE-8), and the `WorkStation/Canvas` module (SURF-1), which changes what Channels shows for canvas events.
- `WorkStationShell` reversed-grid CSS and unused BEM classes (needs a visual check); layout storage dead keys and never-written chrome atoms (SIDE-9).

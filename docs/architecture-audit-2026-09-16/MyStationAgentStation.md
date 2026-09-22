# My Station / Agent Station audit — 2026-09-16

**Scope.** The two station surfaces and everything they own:
`src/modules/WorkStation/**` (706 files), `src/engines/Simulator/**` (83),
`src/store/workstation/**` (64), `src/modules/StationWindow/**` (3),
`src/modules/shared/layouts/FocusedChatWorkstationRail/**` (30) — 886 source
files, ~136,000 lines, 248 test files. Plus the station-owned slices of
`src/store/ui/workStationLayout`, `src/store/ui/simulatorAtom.ts`,
`src/hooks/tabHost`, `src/services/workStation`, `src/engines/BrowserCore` and
`src/engines/TerminalCore`.

**Base.** develop `224b6a4d5b`, clean tree. Read-only pass: no source file was
modified, and no build, typecheck, lint or test suite was run. Three read-only
scripts were run and are quoted under Verification.

**Method.** Six parallel read-only slices — shell/chrome, tab state and
persistence, live Code Editor, Agent Station, Browser/Terminal/Project, and the
rail plus cross-cutting sweeps. Each traced from a rendered component or a
production entry point rather than counting grep hits. The lead independently
re-verified every P0 and every P1 marked "verified" below against source; those
re-checks are listed under Verification.

**Relationship to the 2026-09-14 pass.** That audit's reports
(`docs/architecture-audit-2026-09-14/MyStation.md`,
`docs/frontend-ui-audit-2026-09-14/MyStationChrome.md`) were never merged —
they exist only on the stale branch `origin/docs/my-station-audit`
(commit `86439e7e0a`, PR #1842, five commits behind develop, mixed with
unrelated Spotlight and branch-switch work). This report does **not** restate
its findings. Its still-open items were re-verified on today's develop and are
listed under "Carried over" so the two reports compose.

Companion UX report: `docs/frontend-ui-audit-2026-09-16/MyStationAgentStationUX.md`.

---

## Fixed in this pass (2026-09-16, uncommitted working tree)

All three P0s, plus CORR-1 and PERF-1, are implemented with regression tests at
the owning boundary. Verification for those changes is at the end of this file
under "Fix verification".

| Finding | What landed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DATA-1  | New `CodeEditor/hooks/fileContent/diskGuard.ts`; ⌘S (`useFileContentManager`) and close-tab Save (`useEditorPaneState`) now compare disk against the buffer's baseline and prompt before overwriting. The external-change subscription in `useFileContent` reloads only a CLEAN buffer and no longer matches by basename. **Correction to this report:** the suggested "bridge `file:changed`" fix was wrong on two counts — `emit_file_changed`/`emit_files_changed` in `crates/git/src/watch/event_emitter.rs` have **zero callers**, so the event is never emitted; and the subscription it would have fed calls `loadContent()`, which overwrites the buffer and clears the dirty flag, so wiring it would have destroyed unsaved edits. Live invalidation therefore remains unavailable and needs a Rust producer (see Follow-ups). |
| DATA-2  | `miniTerminalHostMountedAtom` is now gated on `!collapsed`, so suppression and panel mounting share one condition.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| DATA-3  | `UnifiedTabContent` wraps its dispatch in `DetailPaneErrorBoundary` keyed by tab id; `AppShellContent` wraps all four content hosts.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| CORR-1  | `useWorkStationTabShortcutBridge` now takes a required `host` and compares it against `activeHostAtom`; the dead `onNewTab` branch and its stale doc were removed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| PERF-1  | New `util/core/storage/coalescedStorageWrite.ts`; `workStationLayout/storage.ts` and the simulator sidebar atom now coalesce their disk writes and flush on teardown. The layout module's read cache is also kept current on write, which closes CONTRACT-1's staleness half.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

Not addressed here: PERF-1's second clause (the whole `AppShell` re-rendering
each drag frame) needs the narrower subscription described in SHELL-1 and is
left open.

## P0 — user-visible data loss or breakage

### DATA-1 · An agent editing an open file silently loses the user's edits

Two independent defects compose into one data-loss path, which matters more here
than in a normal editor because the agent writes to the same working tree the
user has open.

**(a) External-change invalidation is wired at both ends but never connected.**
`onExternalFileChange` (`CodeEditor/hooks/fileContent/cache.ts:363`) has **zero**
production callers — the only references are its own test. Meanwhile
`useFileContent.ts:321` subscribes through `subscribeToFileChanges` and is
waiting for a notification that can never arrive. The comment at
`useFileContent.ts:246` — "file watcher handles invalidation" — is false. The
Rust side already emits the event (`src-tauri/crates/git/src/watch/event_emitter.rs:73`,
`emit("file:changed", …)`) and two other frontend consumers listen to it
(`contexts/git/GitStatusContext/hooks/useGitEventListeners.ts:199`,
`hooks/flowAwareness/useGlobalFlowTracker.ts:64`). It is simply never bridged to
the editor's cache. The editor therefore shows stale text indefinitely.

**(b) The two save paths users actually hit do not compare against disk.**
The branch-switch save does
(`EditorMainPane/hooks/useFileContentManager.ts:98-104`: re-reads the file and
throws `"The file changed on disk; review it before switching"`). ⌘S
(`useFileContentManager.ts:~130`) and the close-tab **Save** button
(`useEditorPaneState.ts:184`) both call `writeTextFile` directly with no
comparison, overwriting whatever was written since the buffer loaded.

Combined: an agent (or `git checkout`) rewrites a file the user has open, the
editor never learns, and the user's next ⌘S silently discards the agent's work.

_Fix:_ bridge `file:changed` → `onExternalFileChange(path)` once at the
`EditorIntegrations` level, and extract the branch-switch guard into one
`saveBuffer(path, content, baseline)` that ⌘S, Save All and close-tab Save all
route through, offering reload/overwrite on mismatch. Fix the callback's path
match too — `changedPath.endsWith("/" + basename)` matches a same-named file in
any directory. _Verified._

### DATA-2 · Collapsing the workstation rail strands running terminals

`useWorkstationRailTrailTerminal.ts:34-37` registers
`useEffect(() => { setMiniTerminalHostMounted(true); return () => setMiniTerminalHostMounted(false); }, [setMiniTerminalHostMounted])`.
The dependency is only the stable setter, so `hostMounted` tracks the **hook's**
lifetime — and the hook lives in the rail, which stays mounted when collapsed.
The terminal panel itself is gated separately by
`showTrailTerminal = miniTerminalVisible && !collapsed` (line 60, rendered at
`index.tsx:232`).

`miniTerminalSuppressedIdsAtom` (`store/ui/miniTerminalAtom.ts:70-78`) returns
the claimed ids while `visible && hostMounted`. So on collapse: the panel
unmounts, `hostMounted` stays `true`, and the claimed PTY sessions remain
suppressed in the WorkStation terminal pane while `useWorkstationRailTabs` also
filters them out of Opened Tabs. The sessions are reachable from neither
surface until the rail is expanded again. The effect's own comment — "this
trail — the panel's only host — is actually mounted" — states precisely the
invariant that is broken.

_Fix:_ gate `miniTerminalHostMountedAtom` on `!collapsed` so suppression and
mounting share one condition. `WorkstationTrailTerminal.test.ts` has zero
rail-collapse cases. _Verified._

### DATA-3 · No error boundary anywhere in the station tree

Zero `ErrorBoundary` usages across `src/modules/WorkStation/**` and
`src/engines/Simulator/**`, against **45** `<Suspense>` boundaries and **69**
`React.lazy` sites. A throw in any lazily loaded tab renderer — or a failed
chunk fetch after the Tauri app updates under a running window — propagates
past every `Suspense` to the root boundary in `App.tsx` and blanks the entire
application, losing every open tab. Because the offending tab is persisted as
active, reloading restores it and reproduces the crash.

This is sharpened by **46** unchecked `tab.data.X as T` casts in
`src/modules/WorkStation` over `data: Record<string, unknown>`
(`store/workstation/tabs/types.ts:119`), which **is** serialized to
localStorage. A tab persisted by an older build deserializes into
`undefined as string` and throws inside the renderer.

`src/modules/shared/layouts/DetailPaneErrorBoundary.tsx` already exists and is
used in exactly one place.

_Fix:_ wrap `UnifiedTabContent`'s dispatch and `AppShellContent`'s three lazy
hosts in `DetailPaneErrorBoundary`, keyed by tab id so a retry remounts. Add a
`parseXTabData(data): XTabData | null` narrowing function per tab type and
render a "this tab can no longer be restored" placeholder on null. Highest
return per line in this audit. _Verified._

---

## P1 — correctness

| ID      | Area          | Location                                                                                                     | Finding                                                                                                                                                                                                                                                                                                                                                                       | Fix                                                                                                                                            | Conf                                     |
| ------- | ------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| CORR-1  | Shell         | `EditorMainPane/index.tsx:131`, `ProjectManagerLayout/index.tsx:179`, `Browser/useBrowserLayoutState.ts:133` | ⌘W is a window-level `CustomEvent`; Code and Project both register `enabled: true` unconditionally while the 60 s keep-alive mounts them together, so one ⌘W runs **both** close handlers. Only Browser gates on `isActive`. The Code handler additionally falls back to the pinned Explorer tab when the active tab is foreign.                                              | Gate on the active host (`enabled: isCodeMode` / `isProjectMode`), or have the bridge compare `activeHostAtom` against a required `host` prop. | verified                                 |
| CORR-2  | Agent Station | `SimulatorContentArea/SimulatorSingleView.tsx:69`                                                            | `FloatingReplayContainer` has exactly one JSX site, inside the **per-cell** content component, but drives the single global cursor (`navigateNextSimulatorEventAtom`) and the single global playing atom. In any layout above 1×1, N copies each run a timer and each call `navigateNext()` — play skips N events per tick.                                                   | Hoist to `ActivitySimulator` (one instance) or gate on `index === 0`.                                                                          | verified                                 |
| CORR-3  | Agent Station | `hooks/useCellPlayback.ts:74`                                                                                | The autoplay effect lists `events.length` in its dependencies while the interval is `autoPlayInterval / playbackSpeed` (default 1500 ms). During a live streaming session each arriving event tears down and recreates the interval, so it never reaches its delay and the cursor never advances. `FloatingReplayContainer/index.tsx:155` has the identical shape at 2000 ms. | Read the count from a ref inside the tick; keep only `isPlaying` / `speed` / `isSyncMode` as deps.                                             | verified                                 |
| CORR-4  | Agent Station | `GridCell/IndependentGridCell.tsx:360-375`                                                                   | `areGridCellPropsEqual` omits `historyLoad`, which `SubagentChatPane` uses to render the loading text **and the error + Retry button**. On the error path `events` keeps its identity, so nothing else invalidates and the retry affordance never appears.                                                                                                                    | Add `if (prev.historyLoad !== next.historyLoad) return false;`.                                                                                | verified                                 |
| CORR-5  | Code Editor   | `useFileContentManager.ts:152-166`, `ActionSystem/.../fileTabActions.zod.ts:44-59`                           | **Save All saves one file.** The shortcut-bound, agent-callable `file.saveAll` action dispatches `save-all-files`; the sole listener saves only `activeFilePathRef.current`, then reports `success: true`. Other dirty buffers sit in `unsavedContentCache`, and `getDirtyCachedPaths()` + `saveCachedBufferForSwitch()` already exist to save them.                          | Iterate `getDirtyCachedPaths()` plus the active buffer; report per-file failures.                                                              | verified                                 |
| CORR-6  | Code Editor   | `SearchContent/useSearchContent/useSearchExecution.ts:317-326`                                               | Toggling any search option never re-runs the search. The trigger effect omits `storeOptions`, and `search()` is never invoked by the panel — `SearchContent/index.tsx` only calls `setOptions`. Match Case, Whole Word, Regex, include/exclude globs and only-open-files all leave stale results with the toggle visibly active.                                              | Add `storeOptions` to the effect deps; `lastSearchKeyRef` already prevents redundant runs.                                                     | verified                                 |
| CORR-7  | Code Editor   | `useEditorPaneState.ts:158-213`                                                                              | The unsaved-changes dialog is hardcoded English **and branches on the English button label** (`result === "Save"`, `result === "Don't Save"`). Localizing the labels would route every answer to the Cancel branch, so ⌘W on a dirty tab would appear to do nothing. This gates data loss.                                                                                    | Map outcomes to a discriminated result before comparing; move copy into i18n.                                                                  | verified                                 |
| CORR-8  | Tabs          | `tabs/tabMutations.ts:261-275`, `services/workStation/EditorTabService.ts:38-55`                             | "Close all tabs" wipes **every** workspace's view state and **every** search tab's cached results via the global `clearTabViewStates()` / `clearSearchTabSessionStates()`. `closeFromMainPane` additionally runs the mutation as a pure _probe_, so the global clears fire before the real close.                                                                             | Release only the tabs handed in; delete the global clears from the close path.                                                                 | verified                                 |
| CORR-9  | Tabs          | `TabBar/hooks/useTabLabelCollapse.ts:47-63`                                                                  | Label collapse is a one-way latch: `true` fires whenever the strip overflows, but `false` only when the container width grows by >10 px. Closing tabs until the strip fits leaves every inactive tab icon-only until the window is resized.                                                                                                                                   | In the rAF branch set `overflowCollapsed = scrollWidth > clientWidth + 1`.                                                                     | verified                                 |
| CORR-10 | Tabs          | `tabs/storage.ts:67,142,208-217`                                                                             | Persistence failure is silent: `persistWorkstationTabsState` returns `false` after partially writing and no caller inspects the result. `MAX_TABS_PER_PARTITION = 200` is enforced only on **read**, so a 250-tab workspace writes fine and silently loses 50 tabs on reload.                                                                                                 | Surface a one-time notice on persist failure; enforce the cap at write time so read and write agree.                                           | verified                                 |
| CORR-11 | Code Editor   | `useStashCount.ts`, `EditorPrimarySidebar/hooks/useStashState.ts:394-398`                                    | The Source Control "Stashed" badge never updates. `useStashCount` fetches once per `repoPath`; stash push/apply/pop/drop call a local `refresh()` with no path back to the count.                                                                                                                                                                                             | Move the count into a shared per-repo atom written by `useStashState.refresh`.                                                                 | verified                                 |
| CORR-12 | Browser       | `Browser/hooks/useWebviewDOMTree.ts:429-437`                                                                 | The DOM-tree hover highlight is cleared by its own effect cleanup on every hover move: the cleanup depends on `highlightedXpath`, so changing it runs the previous cleanup, which clears the highlight just issued on the same IPC channel.                                                                                                                                   | Move the unmount-only clear into a ref-read cleanup with `[]` deps.                                                                            | plausible — confirm by hovering two rows |
| CORR-13 | Code Editor   | `FileTreeContent/hooks/useRevealPath.ts:105-107`                                                             | The non-virtualized reveal path builds `querySelector(\`[data-tree-path="${actualPath}"]\`)`from a raw filesystem path, throwing`SyntaxError`inside a`requestAnimationFrame`for any path containing`"`or`\`.                                                                                                                                                                  | Use `CSS.escape`, or a ref map.                                                                                                                | verified                                 |

---

## P1 — performance and lifecycle

| ID      | Area          | Location                                                                                                                                                    | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Fix                                                                                                                                | Conf                                                                       |
| ------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------- | --------------- | --------------------- | ------------------------- |
| PERF-1  | Layout        | `hooks/ui/useResizeHandle.ts:139`, `store/ui/workStationLayout/primarySidebarAtoms.ts:78-86`, `bottomPanelAtoms.ts:59`, `store/ui/simulatorAtom.ts:368-377` | Dragging a panel divider performs a **synchronous `localStorage.setItem` per animation frame**. The rAF-throttled handler calls `onSizeChange` once per frame straight into the _persist_ atom, which writes to disk unconditionally; the simulator sidebar additionally `JSON.stringify`s. ~60 disk writes per second of dragging, plus a full `AppShell` re-render each frame.                                                                                               | Keep the live size in a transient atom/ref; commit to the persist atom in `onResizeEnd` (the hook already exposes the hook point). | verified (frame cost not profiled)                                         |
| PERF-2  | Tabs          | `tabs/storage.ts:359-397`                                                                                                                                   | **Every tab mutation rewrites the entire tab store**: all directory workspaces, shared, global, legacy seed, every session workspace, then the manifest — synchronously, with no debounce, no dirty tracking and no no-op bailout. There is no `debounce`/`setTimeout`/`queueMicrotask`/`requestIdleCallback` anywhere in `src/store/workstation/tabs/`. 11 call sites reach it. A user with 40 visited sessions pays ~43 serialize-and-write operations per tab click.        | Track a dirty set of workspace ids; write only those, coalesced on a microtask, flushed on `pagehide`.                             | verified                                                                   |
| PERF-3  | Agent Station | `SimulatorMainPane.tsx:122-127`, `GridCell/SimpleGridCell.tsx:73-78`                                                                                        | A memo comparison that **can never fire** costs 8 `JSON.stringify` calls per invocation. Both comparators `return false` on `prev.events !== next.events` _before_ reaching `getEventsTailSignature(prev.events) !== getEventsTailSignature(next.events)` — so by then both sides are the same array and the strings are equal by construction.                                                                                                                                | Delete both `getEventsTailSignature` functions and their call sites.                                                               | verified                                                                   |
| PERF-4  | Agent Station | `ActivitySimulatorGrid.tsx:37`, `SimulatorMainPane.tsx:27`, `SimpleGridCell.tsx:20`                                                                         | The same `getEventRenderSignature` is copy-pasted in three components stacked in one parent→child chain, each `JSON.stringify`ing `args`, `result`, `extracted` and `payloadRefs`. One `displayEvent` change stringifies the same event up to 24 times — and `args` for a write/edit tool and `result` for a read carry whole file contents.                                                                                                                                   | One shared util keyed on `id                                                                                                       | chunk_id                                                                   | displayStatus | extracted?.kind | payloadRefs?.length`. | verified; profile to size |
| PERF-5  | Browser       | `AppShell/AppShellContent.tsx:192,230`                                                                                                                      | Switching to Agent Station hides My Station with `display:none` but leaves the Browser host **active**, so the whole DevTools polling stack keeps running: console 1 s, network 1 s, inspector 300 ms, DOM-dirty 1.5 s. `isActive` is hardcoded `true` at both `WorkStationPage` call sites, and `isBrowserMode` is unaffected by a station switch. The ports scanner in the same shell _does_ consult `isAgentStation`.                                                       | Feed `!isAgentStation && !chatPanelFocused` into the Browser host's `isActive`, as `shouldEnableWorkspacePortScan` already does.   | verified                                                                   |
| PERF-6  | Browser       | `engines/BrowserCore/webviewMountWindow.ts:5-11`, `hooks/platform/useInlineWebview/useInlineWebviewNativeVisibility.ts:40-49`                               | A hidden My Station leaves up to 4 native WKWebViews **running, not hidden**: the hide path only moves them to `(-10000,-10000)` at `1×1` — there is no `set_inline_webview_visibility(false)` counterpart to the show call. Page JS, timers and media keep going. The file documents this ("A parked webview is a full live page … holding page JS, timers, and media").                                                                                                      | Add a visibility-false call on the hide path, or suspend/mute. Keep the mount window as is.                                        | verified for the JS path; macOS offscreen throttling needs a runtime check |
| PERF-7  | Browser       | `useInlineWebview/useWebviewLayout.ts:137-147`, `BrowserSessionWebview.tsx:374-397`                                                                         | Two independent timer ladders fire forced position IPC per geometry change, per webview, neither coalesced: `[16,50,120,240]` plus an immediate call (5 invokes), and `[0,50,100,170]` (4 invokes). The trigger republishes on every ≥1 px rect change. Dragging a divider for 2 s at 60 fps is ~120 rect changes ⇒ ~600 invokes per webview × 4 warm webviews. `force:true` deliberately bypasses the 2 px dedupe.                                                            | Run the forced update through a trailing debounce; collapse each ladder into one settle timer that restarts per event.             | verified                                                                   |
| PERF-8  | Terminal      | `EditorMainPane/EditorPaneLayers.tsx:107-124`                                                                                                               | The WorkStation terminal host never passes `visible` to `TerminalCore`, whose own doc calls that prop "as load-bearing as the active-session check" — without it a background terminal keeps a foreground output drain, a WebGL context and process polling. The layer hides it with `opacity-0`, and `isTerminalTabActive` is in scope but not forwarded. The chat panel (`ChatPanelTerminalContent.tsx:280`) and the rail (`WorkstationTrailTerminal.tsx:199`) both pass it. | Thread `visible={isTerminalTabActive}` through `TerminalMainContent`.                                                              | verified                                                                   |
| PERF-9  | Code Editor   | `useCodeEditor/useFileTree.ts:351-413`, `useMultiRootFileTree.ts:383-440`                                                                                   | The explorer tree reloads while the Code host is hidden. `autoLoad` is hardcoded `true`, `isActive` is never threaded into `useCodeEditor`, and the only guard is `document.hidden` (whole window). Every git status change with a changed path set triggers a 500 ms-debounced full `loadFileTree()`, which re-reads every expanded directory — while the user is in Chat.                                                                                                    | Thread `isActive` into `useCodeEditor`; gate refresh and initial load on host visibility with one catch-up on activation.          | verified                                                                   |
| PERF-10 | Code Editor   | `hooks/sourceControl/gitFilesDerivation.ts:32-43`, `useGitFiles.ts:41-51,139`                                                                               | `baseFileListIdentity` `JSON.stringify`s the entire working-tree file list **on every render** of every consumer — it is called in the hook body, outside the memo — and `deriveBaseFilesFromIdentity` `JSON.parse`s it back on change. One consumer is mounted at CodeEditor level, so this runs on every CodeEditor render including while hidden. `setFiles` is additionally O(n²) (`baseFiles.find` inside a loop).                                                        | Key the memo on length plus a rolling hash; index `baseFiles` by id in a `Map`.                                                    | verified                                                                   |
| PERF-11 | Agent Station | `hooks/useSimulatorSubagents.ts:135-138` → `useSubagentSessions.ts:284-308`                                                                                 | The `es_get_child_sessions` IPC re-issues on every `eventStoreVersion` bump — i.e. every EventStore mutation including streaming deltas. The `queryKey` is `${parentSessionId}:${eventCount}`, which never repeats, so it dedupes nothing. No debounce, no in-flight coalescing.                                                                                                                                                                                               | Trailing-coalesce 250–500 ms, or key off a subagent-relevant signal.                                                               | verified; IPC counts would size it                                         |
| PERF-12 | Rail          | `useTrailPanelResize.ts:88-106`, `useTrailPanelDimensions.ts:36-40`                                                                                         | Terminal drag-resize writes React state **at the rail root** once per frame, re-rendering every section, row and hook in the rail ~60×/s — while the only consumers are CSS vars and one inline style.                                                                                                                                                                                                                                                                         | Write the CSS var and panel size imperatively on refs during the drag; commit to state in `onResizeEnd`.                           | verified                                                                   |
| PERF-13 | Rail          | `engines/ChatPanel/components/SessionWorkstationRail.tsx:300-321`, `useWorkstationRailSections.ts:47`                                                       | `sessionContext` is a fresh object literal every render and the rail is not memoized, so **every section memo recomputes on every parent render** — during an agent turn, continuously.                                                                                                                                                                                                                                                                                        | `useMemo` both `sessionContext` literals; memoize `WorkstationItemRow`.                                                            | verified                                                                   |
| PERF-14 | Tabs          | `tabs/atoms.ts:79-120,223-250`                                                                                                                              | A write to **any** workspace recomputes `composePanel` for the presented one, producing fresh arrays for all consumers. `useTabLabelCollapse`'s `useLayoutEffect` depends on that array, so every unrelated mutation recreates a `ResizeObserver` and forces a synchronous layout read. `openEditorFilePathsAtom` already hand-rolls an identity cache for exactly this reason.                                                                                                | Memoize `composePanel` per (state, workspaceId); depend on `tabs.length` in the collapse hook.                                     | verified                                                                   |
| PERF-15 | Tabs          | `tabs/atoms.ts:284-298`, `tabs/editorCache.ts:288-307`                                                                                                      | `directory:*` tab workspaces are **never disposed**, and `working-directory` is the default sharing mode. Only `session:<id>` has a disposal path. The manifest, one localStorage key per directory, and `editorCacheByWorkspace` grow monotonically per repo path ever opened — and are re-read at boot and rewritten on every mutation (PERF-2).                                                                                                                             | Add a directory-workspace reaper mirroring `MAX_EDITOR_CACHE_REPOS`; prune empty session entries at load.                          | verified                                                                   |
| PERF-16 | Agent Station | `hooks/useSimulatorSession.ts:138-161`                                                                                                                      | `executionThreads` walks every event id and runs a regex per event, with deps that change on every streaming delta — a 5,000-event session re-scans 5,000 entries per delta, for a count and a thread list.                                                                                                                                                                                                                                                                    | Compute incrementally, or derive the roster in SessionCore once per snapshot.                                                      | verified; profile to size                                                  |
| PERF-17 | Terminal      | `store/workstation/codeEditor/terminal/index.ts:335-340`                                                                                                    | `closeAllTerminalSessionsAtom` awaits `close_pty` one session at a time, so closing the Terminal tab with N shells costs N serial IPC round trips before the UI settles.                                                                                                                                                                                                                                                                                                       | `Promise.all`, or remove locally first and fire kills concurrently.                                                                | verified                                                                   |
| PERF-18 | Code Editor   | `EditorPrimarySidebar/hooks/useWorkstationPr.ts:163-270`                                                                                                    | Each PR list load is a serial two-request waterfall (`resolveRepoFullName()` then `listPRsLocal`); open and closed lists resolve the remote independently, so a manual refresh costs 2 remote lookups + 2 list fetches, none shared or cached.                                                                                                                                                                                                                                 | Memoize the repo full name per `repoPath`; fan the two list fetches out in parallel.                                               | verified                                                                   |

---

## P2 — dead code, contracts and hygiene

| ID         | Location                                                                                    | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Fix                                                                                                                                            |
| ---------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| DEAD-1     | `store/ui/workStationLayout/chromeAtoms.ts:10,16`                                           | `workStationStatusBarHiddenAtom` and `workStationFollowAgentHighlightEnabledAtom` are read only in `AppShell/index.tsx:48,50` and have **zero writers**. The status bar can never be hidden and the follow-agent highlight can never be turned off, so the corresponding branches in `shouldShowWorkStationStatusBar` and `AgentStationChromeFrame` are unreachable.                                                                                                                                        | Delete both atoms and collapse the dead branches, or wire the intended settings UI.                                                            |
| DEAD-2     | `store/ui/workStationLayout/storage.ts:5-18`                                                | 6 of 14 `STORAGE_KEYS` have zero references outside the module: `follow_agent_highlight`, `title_bar_hidden`, `right_collapsed`, `browser_primary_sidebar_collapsed`, `split_enabled`, `split_ratio`. `status_bar_hidden` is read but never written. No schema version.                                                                                                                                                                                                                                     | Delete the dead keys; add a schema version key.                                                                                                |
| DEAD-3     | `store/ui/simulatorAtom.ts:100`                                                             | `globalReplayStateAtom` has **no writers** — one `useAtomValue` and nothing else. `triggerTime` is always `0`, so the guard `triggerTime > lastGlobalTriggerRef.current` never passes: ~45 lines of "global replay synchronization", the `GlobalReplayState` type and its doc are dead. Knock-on: `setLocalPlaybackSpeed` is only called from that branch, so `localPlaybackSpeed` is always 1 and its selector is dead too.                                                                                | Delete the atom, the sync effect, `setLocalPlaybackSpeed` and the local-speed branch.                                                          |
| DEAD-4     | `hooks/useCellReplayState.ts:326`, `cellReplayTypes.ts:71`                                  | `syncToMain` has **zero production callers** (defined, returned, typed, and exercised only by its test). Any cell interaction sets `hasUserOverride: true` permanently, and `cellReplayStatesAtom` is never pruned or reset on session switch — so a scrubbed cell stops following the main cursor for the process lifetime with no UI to undo it. Cells keyed `cell-${index}` additionally inherit a previous session's index.                                                                             | Add a resync control wired to `syncToMain`; clear the atom on session change.                                                                  |
| DEAD-5     | `store/workstation/tabs/types.ts:120-127`, `tabMutations.ts:141-145`                        | The pinned/non-closable subsystem is dead **and its docs are wrong**: `pinned: true` has zero producers, `usePinnedTabs` (105 lines) has one caller passing `enabled: false`, yet `types.ts` claims pinned tabs "survive close all / close other" and `closeTab`'s doc claims it is "a no-op" for them. Neither has any guard in code.                                                                                                                                                                      | Delete the subsystem and the stale docs, or implement the guard. Do not leave a documented invariant unenforced.                               |
| DEAD-6     | `shared/simulatorRegistry/useSimulatorAppRenderer.tsx:87`                                   | Every replay app receives a default `onSelectItem` whose body is `throw new Error("Function not implemented.")`, alongside `state={{} as SimulatorAppBaseState}`. A landmine handed to seven apps.                                                                                                                                                                                                                                                                                                          | Replace with a no-op, or make the prop optional.                                                                                               |
| DEAD-7     | `engines/BrowserCore/index.tsx:150,158`                                                     | Two of three station/modal props are unreachable in production — `isSecondaryStationHidden` is always `false` and `isTabReallyActive` always short-circuits — yet they cost two live Jotai subscriptions (`stationModeAtom`, `webviewBlockedAtom`) that re-render the component for nothing. Only tests exercise the combinations.                                                                                                                                                                          | Delete the dead branch and both atom reads; make `respectModalBlocking` required or remove it.                                                 |
| DEAD-8     | `hooks/tabHost/useWorkStationTabShortcutBridge.ts:1-15`                                     | The whole `onNewTab` branch is dead (all three call sites omit it), and its doc still promises "Database: add connection" — a module that no longer exists.                                                                                                                                                                                                                                                                                                                                                 | Delete `onNewTab` and `HUMANTOOLS_NEW_TAB`; rewrite the doc.                                                                                   |
| DEAD-9     | `services/workStation/WorkStationViewService.ts:59,241,274,342,391`                         | Five methods `await import(...)` `stationModeAtom`, which is already statically imported at the top of the same file — the "lazy loading" comment cannot lazy-load anything. Same for `activeStationChatVisibleAtom` in three methods.                                                                                                                                                                                                                                                                      | Drop the redundant dynamic imports.                                                                                                            |
| DEAD-10    | `store/workstation/tabs/atoms.ts:503-523`, `browser/tabs/index.ts:412-443`                  | Three tab-data write APIs with no consumers: `updateWorkstationTabDataAtom` (0 production callers) and `updateBrowserTabDataAtom` / `updateBrowserTabTitleAtom` (reachable only through hook members nothing destructures). The browser variants also lack the `hasDataChanges` bailout.                                                                                                                                                                                                                    | Delete, or route through `updateTabData`.                                                                                                      |
| DEAD-11    | knip + full-`src` re-scan                                                                   | 212 knip entries across 117 station files, but only **2** symbols have zero references anywhere: `engines/Simulator/config.ts:153 EVENT_TYPE_ICONS` and `store/workstation/tabs/factories/project.ts:292 projectOrgSettingsTabFactory`. The other 104 named candidates all have real consumers reached by deep import. This is dead _barrel surface_, not dead code: five barrels re-export ~79 symbols nobody imports from them.                                                                           | Delete the 2 orphans. Trim barrel re-exports, or add a knip ignore — **do not mass-delete on knip output alone**.                              |
| CONTRACT-1 | `store/workstation/stationWindowAtoms.ts:12-15` vs `workStationLayout/storage.ts:38-48`     | The comment claims the layout atoms "resync across windows through the `storage` event". They do not: `workStationLayout` uses plain `atom()` seeded from a boot-time snapshot plus raw `localStorage.setItem`, with no `subscribe` — unlike the sibling `createZodJsonStorage` atoms, which do resync. A detached station window resizing its sidebar silently overwrites the main window's persisted value with no live resync. Separately, `setStoredValue` never refreshes the module's own read cache. | Scope the keys by window label or move onto `atomWithStorage` + `createZodJsonStorage`; fix the comment either way; update the cache on write. |
| CONTRACT-2 | `tabRegistry/atoms.ts:97-120`, `EditorTabService.ts:38-55`, `browser/tabs/index.ts:365-400` | Six close paths run the mutation **twice** — once as a throwaway probe to compute closed ids, then again for real — so `releaseClosedTabResources` fires twice per close. Idempotent today; a latent bug for any non-idempotent release.                                                                                                                                                                                                                                                                    | Expose a pure `selectTabsClosedBy(state, op)`; keep release exclusively inside `closeWorkstationTabsAtom`.                                     |
| CONTRACT-3 | `useSourceControlSetup.ts:72-80` vs `SourceControlTabSidebarContent.tsx:25-45`              | The sidebar-surface context is unchecked in both directions: the declared return type lists three fields while the memo emits seven, and the consumer recovers them with an unchecked `value as SourceControlSidebarContext`. Renaming a field on either side compiles clean.                                                                                                                                                                                                                               | One shared exported type used on both ends; drop the cast.                                                                                     |
| CONTRACT-4 | `bottomPanelAtoms.ts:41-62`, `primarySidebarAtoms.ts:60-86`                                 | Clamp asymmetry: the read path _rejects_ out-of-range stored values and falls back to the default, while the write path _clamps_. A 700 px height stored by an older build resets to 250 instead of clamping to 600. Bottom-panel bounds are magic numbers duplicated across read and write.                                                                                                                                                                                                                | One `clampStoredNumber(key, {min,max,default})`; add a `WORK_STATION_BOTTOM_PANEL` config.                                                     |
| CONTRACT-5 | `CodeEditor/hooks/fileContent/cache.ts:213-222`                                             | Dirty buffers are never evicted and never repo-scoped: `evictUnsavedContentCache` skips every dirty entry, so the cap of 32 applies only to clean ones, and keys are absolute paths shared across repos. If the file is deleted or moved, the read throws before `popUnsavedContent` runs, so the entry and its on-disk draft survive with no UI to reach them.                                                                                                                                             | Surface dirty-but-unreachable buffers off `getDirtyCachedPaths()`.                                                                             |
| CONTRACT-6 | `hooks/git/useSharedGitStatus.ts:237-248`                                                   | `refreshSharedGitStatus` calls `getOrCreateEntry`, but entries are deleted only on unsubscribe. A post-mutation refresh landing after unmount creates an entry that is never started and never deleted, parking a decoded status snapshot for the process lifetime.                                                                                                                                                                                                                                         | No-op (or self-clean) when `entry.subscribers.size === 0`.                                                                                     |
| LEAK-1     | `engines/TerminalCore/index.tsx:164,194`                                                    | `document.querySelector(".terminal-core")` resolves to whichever host is first in DOM order, but the chat panel, the station and the rail can all carry that class at once — so ⌘F and the copy capture cross-talk between terminals, and every instance overwrites one global. Two further sites do the same query.                                                                                                                                                                                        | Scope to the instance's own root via a ref.                                                                                                    |

---

## Positives worth protecting

These were checked and are genuinely good; do not spend budget re-auditing them.

- **i18n catalog hygiene is clean and CI-enforced.** `node scripts/quality/i18n-keys/check.mjs --json` → `missing 0, unused 16, localeGaps 0, localeExtras 0, placeholderMismatches 0, dynamic 223`. Only one unused key is in station code. The gap is hardcoded strings that never enter the catalog (see the UX report), not catalog drift.
- **Code-splitting discipline is real.** No heavy third-party dependency is statically reachable from the main entry via station code: `papaparse`, `jszip`, `@codemirror/*` and xterm all sit behind `React.lazy` or dynamic-import boundaries; `TabContent/registry.ts` is 100% lazy.
- **`useSharedGitStatus`** is a correct single-flight coordinator: one subscription and one in-flight status request per repo, `useSyncExternalStore` fan-out, `document.hidden` deferral with catch-up, and a microtask-deferred delete so StrictMode re-subscription reuses the entry. Only CONTRACT-6 is off.
- **The browser memory primitives** — `webglContextManager` (8-context budget) and `bufferCache` (10 entries / 8 MB / memory-pressure tier) — are bounded, registered with the cache registry, and reasoned out. Best-in-repo memory hygiene.
- **PTY output already uses a Tauri `Channel<ArrayBuffer>`** with backpressure, acks and foreground/background drains, not `emit`.
- **Canvas agent output is not injected raw**: static HTML is sanitized into a shadow root and React artifacts run in an iframe with `sandbox="allow-scripts"` and no `allow-same-origin`. No security finding.
- **Zero empty `catch {}`** in the station tree; all 16 silent catches carry an explaining comment.
- **No root CSS custom-property writes** anywhere in station code, so the known WKWebView whole-document restyle cost does not apply here.
- **`hostMountPolicy.ts`** pure predicates and the exhaustive renderer registry remain the right model — the tab-type policy table should call them.

---

## Sweep candidates

One decision each, not N findings.

| Sweep                                                                         | Count                                   | Worst sites                                                                                                                                                |
| ----------------------------------------------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getEventRenderSignature` verbatim triplication                               | 3 components, 12 `JSON.stringify` sites | `ActivitySimulatorGrid.tsx:37`, `SimulatorMainPane.tsx:27`, `SimpleGridCell.tsx:20`                                                                        |
| Timer effects listing the event count in deps                                 | 2                                       | `useCellPlayback.ts:78`, `FloatingReplayContainer/index.tsx:155`                                                                                           |
| Visibility gating that stops at `document.hidden` and ignores host `isActive` | 4                                       | `useFileTree.ts:361`, `useMultiRootFileTree.ts:~404`, `useGitWorktrees.ts:102`, `useSharedGitStatus.ts:159`                                                |
| Direct `writeTextFile` saves bypassing a shared guard                         | 5                                       | `useFileContentManager.ts:104,130`, `useEditorPaneState.ts:184`, `cache.ts:344`, preview editors                                                           |
| "Fire the same imperative sync N times on a timer ladder"                     | 3                                       | `useWebviewLayout.ts:139`, `BrowserSessionWebview.tsx:381`, `TerminalCore/index.tsx:144-159`                                                               |
| Probe-mutate-then-diff-ids on close paths                                     | 6                                       | `closeTabAtom`, `closeOtherTabsAtom`, `closeSavedTabsAtom`, `EditorTabService.closeFromMainPane`, `closeOtherBrowserTabsAtom`, `closeSavedBrowserTabsAtom` |
| Unchecked `tab.data.X as T` over a persisted boundary                         | 46 in `modules/WorkStation`             | `projectWorkitemsCompat.tsx:49-51,73,91-92`, `githubPrDetail.tsx:32`, `agentConfig.tsx:355`, `subagentDetail.tsx:17`                                       |
| Constant / never-overridden props threaded through layers                     | 5                                       | `WorkStationPage.isActive`, `WebDevTools.isOpen`, `BrowserCore.manageWebviews` + `.respectModalBlocking`, `WorkspacePortScanner.enabled`                   |
| Redundant `await import` of an already-static import                          | 5                                       | `WorkStationViewService.ts:59,241,274,342,391`                                                                                                             |
| Persisted value read-rejected but write-clamped                               | 3                                       | `bottomPanelAtoms.ts:41,57`, `primarySidebarAtoms.ts:63,80`, `splitLayoutAtoms.ts:8`                                                                       |
| Hardcoded route-prefix string instead of `ROUTES`                             | 4                                       | `StationHeaderControls.tsx:37`, `useStationWindowRouteGuard.ts:14`, `modules/index.tsx:193`, `router/lazy/preload.ts:25`                                   |
| `as unknown as` across the replay event model                                 | 16 total                                | `CodeEditor/SessionReplay/index.tsx:61,62,461`, `Browser/SessionReplay/index.tsx:450` — the replay and backend event types have silently diverged          |
| Non-null `!` on API response payloads                                         | 25                                      | `useWorkstationIssueList.ts:114,116,117,140,142,143` (12 of 25 in one file)                                                                                |

---

## Test gaps at the owning boundary

The station tree has ~886 source files and 248 test files, but the highest-risk
owners are untested. These are never imported by any test, directly or through
`vi.mock`:

- `store/workstation/projectManager/drafts.ts` (231 lines, atom store, FIFO eviction at `MAX_DRAFTS = 20` — silently drops in-progress "New Work Item" forms; **no test file in the directory at all**)
- `GitDiffContent/useGitDiffEditBuffer.ts` (200 lines, unsaved-edit buffer plus `writeTextFile`; must survive a branch switch via `registerBranchSwitchEditor`)
- `EditorMainPane/hooks/useFileContentManager.ts` (owns DATA-1b and CORR-5)
- `Browser/hooks/useBrowserSessions.ts` (322 lines, IPC)
- `store/workstation/database/atoms.ts`
- `engines/Simulator/hooks/useCellPlayback.ts` (the timer — CORR-3 lives here)
- The three simulator memo comparators (PERF-3, PERF-4, CORR-4 all live in this gap)

Where tests exist they are often shallow: `store/workstation/tabs/__tests__/`
has 12 files but none covers `atoms.ts`'s 633 lines directly — they exercise
mutations, storage and retention as slices.

Placement convention: `check-test-placement.mjs` enforces consistency **per
directory**, not per tree. `store/workstation/tabs/` and `codeEditor/terminal/`
use `__tests__/`; `store/workstation/` root uses colocated tests.

---

## Carried over from 2026-09-14 (re-verified open on develop today)

| Item                                                 | Status today                                                                                                                                                                                                                                                      |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ⌘W closes dirty tabs with no prompt                  | Open. `useCloseTabWithGuard` has 3 callers; `workstation-close-active-tab` still has 0 dispatchers. Now compounded by CORR-1 and CORR-7.                                                                                                                          |
| Windows drag-region guards                           | Open. 7 unguarded sites in station chrome (`TabBar/index.tsx:387,414,492`, `SimulatorWorkstationTabHeader.tsx:55`, `ReplayTabBar.tsx:282`, `AgentStationTopHeader.tsx:111`, `PrimarySidebarLayoutWithSections.tsx:289`) vs guarded `WorkstationTabHeader.tsx:66`. |
| Primary-sidebar width limit sets                     | Open. CodeEditor 240–500 vs `WORK_STATION_PRIMARY_SIDEBAR` 200–500 vs ProjectManager 200–400.                                                                                                                                                                     |
| Channels replay publishes into a disabled header row | Open. `Chat/Communication/index.tsx:249` still `showWorkstationTabHeader={false}`.                                                                                                                                                                                |
| Project replay always gets `state={}`                | Open. `useSimulatorAppRenderer.tsx:85`, alongside DEAD-6.                                                                                                                                                                                                         |
| Detached-window shortcut prefix gate                 | Open.                                                                                                                                                                                                                                                             |
| Bottom-panel dead atoms / action                     | Open.                                                                                                                                                                                                                                                             |

---

## Suggested order

1. **Wave 0 — data loss and breakage.** DATA-1 (bridge `file:changed` + one guarded save path) · DATA-2 (one mount/suppression condition) · DATA-3 (error boundary + `parseTabData`) · CORR-5 · CORR-7. One PR each.
2. **Wave 1 — correctness.** CORR-1 · CORR-2 · CORR-3 · CORR-4 · CORR-6 · CORR-8 · CORR-9 · CORR-10 · CORR-11.
3. **Wave 2 — lifecycle and cost.** PERF-1 and PERF-2 (both cheap and high-value) · PERF-5, PERF-6, PERF-8, PERF-9 (visibility gating, one sweep) · PERF-3 and PERF-4 (delete, then cheapen) · PERF-7 · PERF-11 to PERF-18.
4. **Wave 3 — dead code and contracts.** DEAD-1 to DEAD-11 · CONTRACT-1 to CONTRACT-6 · LEAK-1.
5. **Wave 4 — tests.** Cover `drafts.ts`, `useGitDiffEditBuffer`, `useCellPlayback` and the memo comparators before refactoring them.

Wave 0 items are independent of each other and of the 2026-09-14 backlog.

---

## Verification

**Scripts run** (read-only; sources inspected before running):

- `node scripts/quality/check-test-placement.mjs` → exit 0. Output: "1 directory mixes both test-placement conventions … `src/modules/MainApp/Settings/sections` — 2 colocated, 10 in `__tests__`/". No station directory flagged.
- `node scripts/quality/i18n-keys/check.mjs --json` → `missing 0, unused 16, localeGaps 0, localeExtras 0, placeholderMismatches 0, missingDetails 0, dynamic 223`. (`writeFileSync` is gated behind `--write-baseline`, which was not passed.)
- `npx knip --no-progress --reporter json` → 212 station entries over 117 files, then re-verified by an independent full-`src` reference scan excluding the defining file, barrel re-export lines and test files.

**Lead re-verification against source** (independent of the slice that reported
it): DATA-1a (zero `onExternalFileChange` callers; live `subscribeToFileChanges`
consumer; Rust emitter present) · DATA-1b (guarded switch path vs unguarded ⌘S
and close-tab Save) · DATA-2 (the `hostMounted` effect's dependency array and
the separate `showTrailTerminal` gate) · DATA-3 (error-boundary inventory; 46
`tab.data` casts; `data: Record<string, unknown>`) · CORR-1 (`enabled` value at
all three bridge call sites) · CORR-2 (single `FloatingReplayContainer` JSX
site, per-cell) · CORR-3 (`events.length` in deps) · CORR-7 (English label
branching) · PERF-1 (rAF → persist atom → synchronous `setItem`) · PERF-2
(every-key write, no debounce in the directory) · PERF-3 (comparison ordering)
· PERF-8 (`visible` passed by two hosts, not the third) · DEAD-1 (zero writers)
· DEAD-2 (per-key reference counts) · DEAD-3 (zero writers) · DEAD-4 (zero
production callers) · DEAD-5 (zero `pinned: true` producers) · DEAD-6 · plus
the seven carried-over items.

**Not done.** No typecheck, lint, build or test suite was run. No run of the app
on any platform, no screenshots, no profiling, no Windows check. Every
performance finding is a code-path claim with a stated cost model, not a
measurement — PERF-1, PERF-3, PERF-4, PERF-7 and PERF-16 in particular need a
profiler trace before anyone claims a frame-time win. Findings marked
_plausible_ carry the specific check that would confirm them.

---

## Fix verification (2026-09-16)

Changed: 13 files modified, 7 added (2 source, 5 test). Working tree only — no
commit, no branch, no pull request.

- `node_modules/.bin/tsgo --noEmit --pretty false` — clean.
- `vitest run --config config/vitest.config.ts` over the five new test files —
  5 files, 28 tests passed.
- Regression suites: `src/store/ui/workStationLayout`, `src/store/ui/__tests__/miniTerminalAtom.test.ts`,
  `src/hooks/tabHost`, `src/modules/WorkStation/TabContent`,
  `src/modules/WorkStation/shared/SessionReplay`,
  `src/modules/shared/layouts/FocusedChatWorkstationRail`, `src/util/core/storage`
  — 28 files, 193 tests passed.
- `src/modules/WorkStation/CodeEditor` + `src/modules/WorkStation/AppShell` —
  111 files, 782 tests passed.
- `src/engines/Simulator` + `src/modules/WorkStation/Browser` +
  `src/modules/ProjectManager` + `src/store/workstation` — 154 files, 821 tests
  passed.
- `eslint --max-warnings 0 --report-unused-disable-directives`, `oxlint -c .oxlintrc.json --max-warnings 0`
  and `prettier --check` over the 19 changed TypeScript files and the 13
  `common.json` locales — all clean.
- `node scripts/quality/i18n-keys/check.mjs` — `missing 0, localeGaps 0, placeholderMismatches 0`
  after adding `workstation.fileChangedOnDiskTitle`, `workstation.fileChangedOnDiskBody`
  and `actions.overwrite` to all 13 locales.
- `node scripts/quality/check-test-placement.mjs` — the only directory it flags
  (`src/modules/MainApp/Settings/sections`) belongs to a concurrent session, not
  to this change.

Two bugs were caught by the new tests rather than by review: the coalescing
wrapper's `removeItem` did not cancel an already-queued write, so a flush could
resurrect a removed key; and the module registered a `visibilitychange` listener
behind a `window` probe, which crashed on import under the node test
environment where `window` exists without `document`. Both are fixed.

Not done: no build, no app run on any platform, no screenshots, no profiling.
The PERF-1 change is a write-count reduction argued from the code path — the
frame-time win is still unmeasured.

## Follow-ups this pass created

1. **Live external-change invalidation is still unavailable.** A Rust producer
   must call `emit_file_changed` (or the debouncer must retain per-file paths,
   which it currently discards before flushing) before `onExternalFileChange`
   has any source. The frontend side is now safe to wire.
2. **The close-tab dialog still branches on English button labels** (CORR-7).
   The new save guard uses `ask`, which returns a boolean, but the surrounding
   Save / Don't Save / Cancel dialog in `useEditorPaneState` was left as found.

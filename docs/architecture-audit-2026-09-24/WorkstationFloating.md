# Workstation floating presentation architecture audit

Scope: whole-Workstation docked / floating / collapsed presentation, state preservation, native-window handoff, visibility propagation, and native browser geometry. This is a frontend presentation change; persisted tab/session/editor/terminal ownership remains with existing stores and engines.

## Acceptance and ownership

- One Workstation React subtree survives presentation changes; floating does not create a second editor, browser, terminal, or Project host.
- Presentation intent is document-local, independent of My Station / Agent Station content mode and saved dock sizing.
- Expanded primary chat and visible Workstation can coexist.
- Collapse and Settings occlusion disable host activation without destroying retained state. Agent Station remains the existing exception: its derived simulator view mounts only while displayed.
- Native-window acquisition changes presentation only after success; generation checks prevent late completion/close from overwriting newer user intent.

| Value                                               | Owner                                       | Lifetime                                     |
| --------------------------------------------------- | ------------------------------------------- | -------------------------------------------- |
| docked / floating / collapsed                       | `store/workstation/presentationAtoms.ts`    | Current document / Jotai store               |
| floating rectangle                                  | `scaffold/AppLayout/WorkstationSurface.tsx` | Stable mounted surface                       |
| chat expanded / workstation visible                 | `resolveWorkstationPresentation`            | Derived, including Settings occlusion        |
| tabs, unsaved files, PTY sessions, browser sessions | Existing Workstation stores and engines     | Existing business lifecycle                  |
| detached presentation recovery                      | Generation-tagged presentation atoms        | Outstanding successful native-window handoff |

## Ten-layer review

| Layer                           | Verdict     | Evidence and decision                                                                                                                                                                                                              |
| ------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 Compilation                   | Pass        | `pnpm exec tsgo --noEmit --pretty false` exited 0; targeted ESLint passed; circular check passed across 8,176 modules.                                                                                                             |
| 2 Structure / duplication       | Keep        | A stable `WorkstationSurface` changes layout around one child tree. No dock/Portal duplicate subtree. Reuses drag/resize primitives.                                                                                               |
| 3 Naming                        | Fix         | Host activation now uses `workstationVisible`; `chatPanelFocused` remains only at WorkStationPage's compatibility boundary for the existing standalone StationWindow caller.                                                       |
| 4 Semantic overloading          | Fix         | Chat expansion no longer means Workstation invisibility. Presentation and Station content mode are separate types.                                                                                                                 |
| 5 Defaults                      | Keep        | New stores start docked. Standalone StationWindow always resolves docked. Explicit dock clears the chat-maximized preference so restore actually reveals the split.                                                                |
| 6 Boundaries                    | Keep        | Presentation does not modify session transport, terminal lifetime, browser ownership, or persisted tab data. Native frame updates use the existing IPC contract.                                                                   |
| 7 Discoverability               | Keep        | Projection and stable-host comments explain the split between visibility and mount ownership. Collapsed retains floating geometry.                                                                                                 |
| 8 Wire / serialization          | Not changed | No new RPC schema, database format, cloud record, or serialized preference. Existing native frame IPC still supplies the existing rectangle shape; mocked IPC tests inspect that payload. Live native delivery remains unverified. |
| 9 Entry / initialization parity | Fix         | AppLayout and WorkStationPage consume real visibility. Code, Browser, Project and Agent Station each receive the same lifecycle decision. Standalone window keeps its current behavior.                                            |
| 10 Resolver / recovery symmetry | Keep        | Successful native acquisition suspends only the captured generation; close restores only its matching Station mode and unchanged generation. Failed acquisition does not collapse the floating surface.                            |

## Focused findings

| Line                                                   | Element                | Verdict          | Reason                                                                                           | Suggested change                                                        |
| ------------------------------------------------------ | ---------------------- | ---------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `presentationAtoms.ts:78`                              | Layout projection      | keep with reason | Separates occupied dock space from actual floating visibility                                    | Consume the projection for lifecycle gates                              |
| `AppShellContent.tsx:115`                              | AgentStation host      | keep with reason | Existing simulator is a derived view with visible-only mount ownership                           | Preserve this exception to host retention                               |
| `WorkstationSurface.tsx:29`                            | Stable parent          | keep with reason | Dock/floating mode does not move children across a Portal or alternate parent                    | Keep its key and subtree stable                                         |
| `SharedBrowserApp.tsx:43`                              | Geometry publication   | fix              | Position-only movement must reach the hoisted native owner without scale-transition retry timers | Publish the committed fast geometry event                               |
| `GlobalDragDrop/useGlobalDragDrop/utils/routeUtils.ts` | Drop-target visibility | fix              | A collapsed retained pane still has positive-size rectangles                                     | Reject hidden, aria-hidden and inert ancestors before hit-test fallback |

## Verification and limits

Visibility ownership tests passed: 7 files / 33 tests across AppShell composition, scanner and mount policies, caption compatibility, native layout coalescing, shared browser rectangle publication, and Project content retention. These are rendered React/mocked IPC tests, not native window proof. The drag/drop utilities additionally passed 2 files / 4 tests, covering positive-size retained targets under hidden, aria-hidden and inert ancestors, native fallback hit-testing, direct DOM targets and reveal recovery. Integrated layout/state checks are tracked by the integration run.

Native browser dragging, overlay stacking with Sidechat, real PTY reconnect focus, window ownership transfer and visible/hidden CPU measurements require Tauri verification. Persistence migration and rollback are not required: no persistent format changed; removing the presentation feature returns to the existing docked layout.

## Integrated verification (2026-09-24)

- `pnpm exec tsgo --noEmit --pretty false`: passed (no diagnostics).
- Targeted ESLint with `--max-warnings 0`: passed for all task-owned source/tests in the root and worker runs.
- `pnpm check:circular`: passed, 8,176 modules (worker run).
- `git diff --check`: passed across the current worktree.
- Main integration Vitest run: 25 files / 127 tests passed. Additional exact-path run: 6 files / 41 tests passed. Workers additionally reran final state/Settings/narrow-viewport changes (4 files / 52 tests passed).
- Browser smoke on the current development frontend at 1440×900: float, drag, resize, collapse, reopen, dock, and float from Station-only layout passed. Size changed from 900×700 to 629×519 through the rendered resize handle; collapse/reopen preserved 629×519 and position. Dock/re-float also preserved that frame.
- At 500×600 the floating frame was clamped inside the visible viewport. Checked rendered dark-theme layout and Agent Station selection. Native browser content, live editor/PTY state, light theme and real native multiwindow handoff were not exercised by this browser smoke.
- During parallel editing, Fast Refresh briefly hit an invalid hook-order state as hooks were added. A full reload after edits completed removed it; the final float/collapse/dock smoke had no application error screen.

No app instance with the updated frontend was available through native app control: the debug executable exists but is not a launchable registered app bundle. The browser-mode frontend cannot execute Tauri IPC, so native claims remain explicitly unverified.

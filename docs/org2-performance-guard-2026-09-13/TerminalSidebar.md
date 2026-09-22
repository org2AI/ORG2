# Terminal sidebar restoration

The authoritative sidebar mapping is the module-local registry in `SidebarModules/registry.ts`. Commit `66e95ca31` deleted the terminal module, including its `registerTabSidebar("terminal", TerminalTabSidebar)` call and entry-point export. The terminal therefore reached `SidebarSlot`'s default explorer fallback. Restoring the module and entry-point import restores the mapping; no persisted domain data is changed or requires cleanup.

| Area               | Verdict | Evidence                                                                                                                              | Change or reason kept                                                          | Verification                                                               |
| ------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| Background work    | keep    | `useTerminalState` reads existing Jotai atoms; restored components contain no timers, effects, listeners, or mount-triggered requests | Creation, closing, and process termination remain explicit user actions        | Source inspection; desktop CPU measurements not run                        |
| Memory             | keep    | Derived lists and PID maps are component-owned and bounded by current terminal/process records; no new global cache                   | Terminal is outside the retained-tab pools and normally unmounts when inactive | SidebarSlot activation/deactivation tests; existing retention-policy tests |
| Scope/isolation    | keep    | Existing store supplies terminal sessions, targets, and selected repository                                                           | No new transport, persistence, auth, or cache scope                            | Source inspection; no cross-instance runtime claim                         |
| Rendering/hot path | keep    | Sidebar subscribes to session metadata and shell-process records, not terminal output bytes                                           | Restore prior row rendering and existing shared UI components                  | Routing tests; typecheck and lint; no measured runtime improvement claim   |

Lifecycle: importing the production entry point installs the terminal sidebar registration. Activating a terminal mounts its sidebar; switching to a file unmounts it under the current retention policy. The existing slot also hides/reuses a sidebar if explicitly passed a retained tab and releases it after removal. Document visibility does not start extra work. There are no new network/offline, account, provider-ingestion, or multi-instance mechanisms in this fix.

Verification actually run:

- `pnpm test src/modules/WorkStation/shared/SidebarModules/SidebarSlot.test.ts src/store/workstation/tabs/__tests__/tabRetention.test.ts`: seven tests passed. The new routing tests import the production module entry point and mock terminal content/services; they do not verify the full visual rows or live PTY actions.
- `pnpm typecheck:fast`: passed.
- `pnpm exec eslint src/modules/WorkStation/shared/SidebarModules/Terminal src/modules/WorkStation/shared/SidebarModules/index.ts src/modules/WorkStation/shared/SidebarModules/SidebarSlot.test.ts`: passed.
- `git diff --check`: passed.
- `pnpm check:circular`: failed on three cycles in SessionCore/ChatPanel/input hooks and HoverCard; none includes a changed module. Those cycles were not changed by this fix.
- Desktop visual validation, live PTY actions, and visible/hidden/post-close CPU/RSS measurements were not run: the user requires explicit opt-in for desktop control. No screenshot or runtime performance claim is made.

Performance verdict: blocked for desktop measurement; source inspection and targeted lifecycle tests pass.

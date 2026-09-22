# Nested menu dismissal UI audit

| Line                                                                                     | Element                          | Verdict          | Reason                                                                                                                                                                                                               | Suggested change |
| ---------------------------------------------------------------------------------------- | -------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `src/features/RuntimeDataSource/UsageRangePicker.tsx:162`                                | Custom range Apply               | keep with reason | Existing shared Button and date fields keep their presentation; applying returns focus to the parent menu's Custom row.                                                                                              | None.            |
| `src/modules/ProjectManager/WorkItems/components/WorkItemContextMenu/index.tsx:153`      | Context menu selection           | keep with reason | Pointer and shortcut selection share one dispatcher. Root actions dismiss by default, nested updates remain open, and terminal nested actions can opt into dismissal. Existing shared menu controls remain in place. | None.            |
| `src/scaffold/GlobalSpotlight/palettes/UnifiedModelPalette/UnifiedModelDropdown.tsx:168` | Model source submenu             | keep with reason | Anchored dropdown explicitly keeps its parent open while the standalone palette retains its existing close-on-source default.                                                                                        | None.            |
| `src/scaffold/NavigationSidebar/connectors/SessionFilterSubmenuPanel.tsx:88`             | Sidebar settings and filter rows | keep with reason | Existing shared controls retain selection feedback; property updates remain open while navigation/import/export actions still dismiss. No new native control or theme override is introduced.                        | None.            |

Verdict totals: **0 fix**, **4 keep with reason**, **0 abstract**.

## Architecture review

Checked compilation, dispatcher reuse, naming, selection-versus-dismissal semantics, root/nested defaults, shared UI type scope, and caller clarity (layers 1–7). The optional `ContextMenuItem.closeMenuOnSelect` field remains UI-only; it does not alter persistence or serialized requests (layer 8). Pointer and numeric shortcut paths use the same selection dispatcher (layer 9). The standalone palette and anchored dropdown pass explicit source-dismissal choices; model/account resolution is unchanged (layer 10). No backend change is involved.

## Performance guard

| Area               | Verdict | Evidence                                                                                      | Change or reason kept                                                                            | Verification                                          |
| ------------------ | ------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| Background work    | keep    | Existing mouse/keyboard listeners remain scoped to open menus and clean up in effect teardown | Enter no longer dismisses a menu independently of the row action; no new timers or subscriptions | Source lifecycle inspection and keyboard tests        |
| Memory             | keep    | Menu state is component-local; no new cache or collection                                     | Parent menus intentionally stay mounted until dismissed                                          | Component tests repeatedly select options and unmount |
| Scope/isolation    | keep    | No auth, network, persistence, or session identity changes                                    | Existing selection callbacks remain authoritative                                                | Selection callback assertions                         |
| Rendering/hot path | keep    | Existing native row click dispatch is retained                                                | Removes an extra close call; no runtime speed claim                                              | 11 focused suites, 65 tests pass                      |

Performance verdict: **blocked** for desktop CPU/RSS and visible/hidden runtime measurements, which were not run because computer control was not authorized. Source-level ownership and automated checks pass. Full desktop screenshots/E2E were not run.

Risk: nested context-menu actions now stay open unless explicitly marked terminal. Keyboard Enter follows the clicked row's policy, so a caller expecting automatic dismissal must own that dismissal just as it does for pointer input. Root actions and Escape retain their dismissal behavior.

# Chat tab presentation consolidation

Single responsibility: remove duplicated ownership of chat tab presentation while preserving behavior. Reuses the merged header fix; no drag, shortcut, persistence, or navigation changes.

Acceptance criteria met: one icon-rendering path for expanded/collapsed headings; one read-only effective-layout atom consumed by the four layout readers; old repeated icon/layout branches removed; one trailing-controls renderer; one plus-menu action-props definition; one owner for close-control base appearance. Existing entity specializations and saved preference writers remain.

| Layer                  | Coverage and result                                                                                                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1 Compilation          | `pnpm typecheck:fast` and scoped ESLint passed; targeted tests documented in the PR.                                                                                                 |
| 2 Structure/dead code  | Removed replaced branches/imports. New icon renderer and layout atom are wired to production consumers. No speculative framework or unused abstraction.                              |
| 3 Naming               | `effectiveChatPanelMaximizedAtom` explicitly distinguishes display state from saved preference.                                                                                      |
| 4 Semantic overloading | Raw preference reads that implement user settings remain raw; no mechanical global replacement.                                                                                      |
| 5 Defaults             | Preserved generic icon fallback and collapsed-heading omissions; no new icon/product behavior for previously unhandled tab types.                                                    |
| 6 Boundaries           | Entity icon policy stays in ChatPanel. Visual close styles stay in the shared primitive. A small store leaf owns effective layout without importing upper-level components.          |
| 7 Comprehensibility    | The pill owns interaction/placement, the icon component owns entity appearance, and row variants share one controls renderer.                                                        |
| 8 Wire                 | No wire, IPC, backend, schema, configuration or persisted format changes. Backend protocol checks intentionally excluded.                                                            |
| 9 Entry parity         | Five supported collapsed icon types tested against expanded rendering; all four effective-layout composition sites migrated. Saved preference restoration and pinned chrome covered. |
| 10 Resolver symmetry   | Same creator target and management section now feed shared icon selection. Entity preview and title resolvers remain untouched.                                                      |

Sweep: four layout resolver consumers migrated (ChatPanel, Modules layout, pinned chrome, right-edge reservation); both close primitive callers migrated (Chat pill and Workstation SortableTab). No production direct layout-resolver calls remain outside the derived atom. Pure helper exports remain for tests and explicit callers. Icon menus/drag overlays represent different roles and are unchanged.

Kept out: optional separator primitive, drag-controller unification, and potential shortcut ownership behavior changes. These are not prerequisites for shared tab presentation. No runtime performance improvement is claimed.

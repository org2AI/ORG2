# SidebarUnification UI audit

| Line                                                                                                          | Element              | Verdict          | Reason                                                                                           | Suggested change |
| ------------------------------------------------------------------------------------------------------------- | -------------------- | ---------------- | ------------------------------------------------------------------------------------------------ | ---------------- |
| `src/components/SidebarRow/index.tsx:24`                                                                      | Sidebar row          | keep with reason | Shared Button with custom geometry for multiline text, graph decoration and first-line icons     | None             |
| `src/components/SidebarSectionHeader/index.tsx:37`                                                            | Section disclosure   | keep with reason | Shared Button preserves compound title/action slots; callers own expansion and data lifecycle    | None             |
| `src/components/VirtualizedStickyTree/StickyTreeRow.tsx:23`                                                   | Sticky tree row      | keep with reason | Opaque backing masks scrolling content; shared inset and Button surface align with ordinary rows | None             |
| `src/components/TreeRow/config.ts:7`                                                                          | Virtual row pitch    | keep with reason | 28px row plus shared 1px gap is represented in virtual measurements                              | None             |
| `src/modules/WorkStation/shared/PrimarySidebarLayout/SectionHeaderActions.tsx:8`                              | Header action portal | keep with reason | Mounted body keeps ownership of loading/action state; portal only relocates presentation         | None             |
| `src/modules/WorkStation/CodeEditor/Panels/EditorPrimarySidebar/content/GitHistoryContent/GitCommitRow.tsx:1` | Commit graph row     | keep with reason | Shared row preserves graph pitch while removing a parallel row renderer                          | None             |

Verdict totals: **0 fix**, **6 keep with reason**, **0 abstract**.

Source review: new action controls use shared Button; custom geometry is documented in reusable primitives. Native UI screenshots were not captured because computer control was not requested. Verification commands and outcomes are recorded in the PR.

Follow-up hover correction: Source Control section actions, Git-list controls, check rows and port rows use shared soft/button-hover treatment so they remain visible over the hovered row surface. Removed weaker local hover overrides; port-stop keeps its existing neutral color semantics with the stronger token. Shared Button dimensions, icons, event propagation and visibility behavior remain unchanged.

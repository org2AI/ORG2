# Explorer search hover UI audit

| Line                          | Element                  | Verdict          | Reason                                                                                                                                 | Suggested change |
| ----------------------------- | ------------------------ | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `FileTreeContentImpl.tsx:234` | Search row hover wrapper | keep with reason | Reuses `FileTreeHoverPreview` for files, compact folders, repository headers, and sticky headers; block display preserves row geometry | None             |
| `TreeNode.tsx:208`            | Native title policy      | keep with reason | Search rows use the path card; normal explorer behavior is preserved                                                                   | None             |
| `TreeRowBase.tsx:212`         | Symlink icon             | keep with reason | Removed its explicit aria-label at the user's request; no new action control introduced                                                | None             |

Verdict totals: **0 fix**, **3 keep with reason**, **0 abstract**.

The changed render paths retain existing shared TreeRow, FolderHeaderRow, and
StickyTreeRow controls. No raw action button or substitute clickable element was
introduced. Rename and new-item input modes do not mount hover wrappers.

## Performance guard

| Area               | Verdict | Evidence                                                      | Change or reason kept                            | Verification                                            |
| ------------------ | ------- | ------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------- |
| Background work    | keep    | Existing preview owns delayed show/hide and unmount cleanup   | No new polling or I/O                            | Hover delay, cancellation, and unmount timer tests pass |
| Memory             | keep    | Wrapper state belongs to mounted virtualized rows             | Card mounts only after hover delay               | Preview is absent before delay and after unmount        |
| Scope/isolation    | keep    | Preview receives the row's canonical path and repository root | Compact label is never used as a filesystem path | Source inspection                                       |
| Rendering/hot path | keep    | Search-only wrapper uses existing virtualized rows            | No eager card rendering or file scan             | Existing hover tests and file-tree tests pass           |

Verification: 30 tests across 5 files passed using
`pnpm test src/components/FileTreePreview/FileTreeHoverPreview.test.ts src/modules/WorkStation/CodeEditor/Panels/EditorPrimarySidebar/utils/filterTree.test.ts src/modules/WorkStation/CodeEditor/Panels/EditorPrimarySidebar/content/FileTreeContent/__tests__`.
ESLint passed for changed production files. Scoped `git diff --check` passed.
Desktop visual verification was not run because computer control is opt-in.

Performance verdict: pass. The isolated PR worktree passes `pnpm typecheck:fast`;
no compilation blocker remains. Hover lifecycle checks pass. Desktop geometry
remains unverified.

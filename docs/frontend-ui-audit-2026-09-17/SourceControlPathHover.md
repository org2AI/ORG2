# Source control path hover UI audit

| Line                               | Element                   | Verdict          | Reason                                                                                                                                                    | Suggested change |
| ---------------------------------- | ------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `SourceControlTreeRow.tsx:463`     | File/directory hover card | keep with reason | Reuses FileTreeHoverPreview with block geometry; canonical path and worktree root come from existing drag-path resolution; native filename title disabled | None             |
| `SourceControlStickyHeader.tsx:85` | Sticky path hover card    | keep with reason | Reuses the same card with the owning repository root; section headings have no filesystem card                                                            | None             |

Verdict totals: **0 fix**, **2 keep with reason**, **0 abstract**.

Shared TreeRowBase, TreeRowAction, and StickyTreeRow action controls are preserved.
No raw button or substitute action element was introduced. Context menus remain
outside the hover wrapper, and existing action propagation handlers are retained.

## Performance guard

| Area               | Verdict | Evidence                                                   | Change or reason kept                                   | Verification                                       |
| ------------------ | ------- | ---------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------- |
| Background work    | keep    | Existing hover component owns show/hide timers and cleanup | No new polling or I/O                                   | Delayed hover, cancellation and unmount tests pass |
| Memory             | keep    | Hover state is local to mounted virtualized rows           | Card only mounts after delay                            | Existing lazy-mount and teardown tests pass        |
| Scope/isolation    | keep    | Actual file/tree path is resolved against owning worktree  | Synthetic section-prefixed node IDs never feed the card | Row and sticky-header path regression tests pass   |
| Rendering/hot path | keep    | Existing virtualization bounds mounted wrappers            | Card performs no file scan                              | Source inspection and hover tests                  |

Verification:

- `pnpm test src/modules/WorkStation/CodeEditor/Panels/EditorPrimarySidebar/content/SourceControlContent/components/SourceControlTreeRow.test.ts src/components/FileTreePreview/FileTreeHoverPreview.test.ts` — 8 tests passed.
- ESLint passed for SourceControlTreeRow, its test, SourceControlStickyHeader, and SourceControlContent.
- `pnpm typecheck:fast` — passed.
- Scoped `git diff --check` — passed.
- Desktop hover geometry was not visually verified; computer control is opt-in.

Performance verdict: pass for the changed hover lifecycle and path routing.
No runtime speedup is claimed.

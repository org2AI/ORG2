# MobileFileTabs UI audit

| Line                               | Element                           | Verdict          | Reason                                                                                                                                                                                                                 | Suggested change |
| ---------------------------------- | --------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `MobileFileViewerControls.tsx:74`  | File tab strip                    | keep with reason | Reuses the same TabPillSurface as Desktop SortableTab, with as=button backed by shared Button, plus the shared FileTypeIcon. Selected surface, radius and hover styles remain owned by the shared component            | None             |
| `MobileFileViewerControls.tsx:87`  | Selection and keyboard navigation | keep with reason | Uses tablist/tab roles, selected-state roving tabindex, full path accessible names, and the existing authoritative targetIndex callback. Arrow keys, Home/End and focus visibility stay local to the mounted preview   | None             |
| `MobileFileViewer.tsx:54`          | Document panel                    | keep with reason | Links the mounted document to the active file tab with instance-scoped IDs. Single-file previews do not expose an orphan tabpanel                                                                                      | None             |
| `mobileFileViewerControls.scss:48` | File tab presentation             | keep with reason | Only touch geometry, font size, label cap and focus outline are mobile-specific. Removed the local square tab separators, selected background and underline rules; 44px targets and native horizontal scrolling remain | None             |

Verdict totals: **0 fix**, **4 keep with reason**, **0 abstract**.

## Lifecycle and scope

Tool event file targets remain authoritative. `useMobileFilePreview` owns selectedTarget for the lifetime of the mounted preview. Click/arrow/Home/End selects an existing targetIndex; the selected tab, header, document and copy source follow that target. Closing/reopening retains the existing reset policy. Duplicate basenames are distinguished by full path and targetIndex, not by visible name. No persistence, polling, retained caches, network requests or Desktop navigation ownership was added.

The original unavailable/empty/truncated/patch/merge/fallback editor states remain. Existing stale Desktop response invalidation remains in its original hook. Tabs do not navigate Desktop or mutate files.

## Desktop reuse boundary

Desktop TabBar composes drag-and-drop, WorkStationTab records, pane splitting, Git state and session transfer. Those owners are not dependencies of a transient multi-file tool preview. Reuse stops at TabPillSurface and FileTypeIcon; mobile selection stays in useMobileFilePreview. No new copies of Desktop surface styles or workspace state were introduced.

Architecture review covered compilation, presentation deduplication, naming, the distinction between preview targets and workspace tabs, defaults (button rendering), and dependency direction. Rust safety, wire payloads, startup parity and resolver symmetry are unchanged and outside this presentation refactor.

## Verification

- `pnpm exec vitest run --config config/vitest.config.ts src/modules/MobileRemote/components/transcript/MobileFileViewerTabs.test.ts src/modules/MobileRemote/components/transcript/MobileFileViewer.test.ts src/components/TabPill/TabPillSurface.test.ts`: 31 passed across 3 files
- Existing real CodeMirror suite covers copy/wrap, patch/merge rendering, unavailable/empty content, fallback, switching, remount and stale Desktop responses
- New rendered integration checks cover selected tab/document links, duplicate basenames, nonsequential target indices, roving focus, arrow wrapping, Home/End and single-file behavior
- `pnpm exec tsgo --noEmit --pretty false`: passed
- Scoped ESLint, Prettier and diff whitespace checks: passed
- Real iPhone 17 Pro simulator: saw the three-file strip; tapped the second file and verified its header, selected pill and patch content changed together
- Production JSX inspected: file actions use shared Button; the tablist and document containers have no substitute click handlers

## Remaining checks

Dark theme, enlarged accessibility text and overflowing many-file lists were not manually exercised. The layout uses existing theme tokens, a per-tab width cap and native horizontal overflow. No claim of all-device visual coverage.

## Isolated PR validation after rebase

See [`MobileFileTabsBatch.md`](../verification-2026-09-18/MobileFileTabsBatch.md) for the current branch results and remaining runtime/visual gaps. Earlier counts and simulator notes above describe the original integrated worktree.

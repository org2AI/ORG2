# File-path hover cards performance guard

Scope: Agent Station file rows reuse `FileTreePreview` inside their existing smart-positioned `Tooltip`. The Tooltip and `FileTreeHoverPreview` share a 500 ms opening delay; markdown and tool-event file links inherit the same default. Terminal Commands and Other Tools explicitly disable previews, so those rows mount no Tooltip and create no hover timers.

| Area               | Verdict | Evidence                                                                                                                       | Change or reason kept                                                   | Verification                                                                                          |
| ------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Background work    | keep    | Existing `Tooltip` and `FileTreeHoverPreview` own event-triggered opening and closing timeouts; cleanup clears both on unmount | Reuse existing ownership; no polling or additional timer implementation | Four fake-timer tests cover the 499/500 ms boundary, leave/re-entry, and removal before/after opening |
| Memory             | keep    | Preview tree and portal mount only after the opening timeout; unmount removes them                                             | No cache, retained history, or app-lifetime collection added            | Tests confirm no card before delay or after removal and no pending timers after removal               |
| Scope/isolation    | keep    | Hover state belongs to the mounted anchor; no network, persistence, or identity data added                                     | Existing path props and shared-session suppression remain               | Source inspection                                                                                     |
| Rendering/hot path | keep    | Existing virtualized tree and memoized row callback remain; path card renders only on demand                                   | Shared component replaces the previous tooltip content                  | Targeted tests and frontend typecheck                                                                 |

Lifecycle: initial/idle has zero timers; active hover schedules the opening timer; leaving before opening cancels it; closing and unmount are covered. Network, auth, provider transitions, sync, and multi-instance data are unchanged. Hidden-document and focus-return behavior retain the existing preview implementation and have not been exercised in the desktop app.

Verification:

- `pnpm test src/components/FileTreePreview/FileTreeHoverPreview.test.ts src/components/FileTreePreview/pathTree.test.ts src/components/FilePathBreadcrumb/FilePathBreadcrumb.test.ts src/components/Tooltip/index.test.ts src/components/Tooltip/tooltipPlacement.test.ts` — 40 tests passed
- `pnpm run typecheck:fast` — passed
- Changed-file ESLint and `git diff --check` — passed
- Desktop visual checks and visible/hidden idle CPU/RSS measurements — not run; the user's instructions prohibit computer control without explicit opt-in

Performance verdict: **blocked** for desktop measurements and hidden/focus lifecycle verification. Automated timing and cleanup checks passed; no measured CPU/RSS improvement is claimed.

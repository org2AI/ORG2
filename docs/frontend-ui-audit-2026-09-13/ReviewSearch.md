# ReviewSearch UI audit

| Line                                                                            | Element          | Verdict          | Reason                                                                                                                                                                                                                         | Suggested change |
| ------------------------------------------------------------------------------- | ---------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| `src/modules/WorkStation/shared/DiffSectionList/search/useReviewSearch.tsx:250` | Review Find card | keep with reason | Uses the existing FindCard without a review-only switch; the shared chat/file scope pill is kept (2026-09-18) so review search can switch to the open chat like other file targets. Existing match modes and navigation remain | None             |
| `src/modules/WorkStation/shared/DiffSectionList/index.tsx:373`                  | Review root      | keep with reason | Removes the pointer-capture handler used only to select a single search file; no new visual primitives                                                                                                                         | None             |

Verdict totals: **0 fix**, **2 keep with reason**, **0 abstract**.

Architecture: full-review scope is enforced at both eager worker requests and lazy file enumeration, not only hidden in the UI. Removed file-scope state, focused-path plumbing and click tracking. Existing per-file editor search remains separate. No persistence or wire changes.

Lifecycle: existing debounce, visibility pause/restart, generation checks, sequential lazy loading, match limit and worker termination remain. Navigation between files no longer restarts search solely because a focused path changes. No new timers, listeners, retained caches or polling. Source-level verdict: bounded; live CPU/RAM unmeasured.

Verification: `pnpm test src/modules/WorkStation/shared/DiffSectionList/search` — 10 tests passed, covering full file payload, no scope controls, lazy loading, stale-result rejection, close cleanup and visibility restart. Live desktop visual verification was not run because computer control is explicitly opt-in.

# Conversation pull request rail — lifecycle review

Scope: `useWorkstationRailGitHub` → `useBranchPullRequestStatus` → shared branch snapshot/head-check readers. The rail presents a conversation-scoped PR summary and does not request polling. This change does not modify provider transcript ingestion, cloud sync, or session persistence.

| Area               | Verdict | Evidence                                                                                                                                                  | Change or reason kept                                                                                                                               | Verification                                                                         |
| ------------------ | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Background work    | fix     | A same-repo/same-branch rail initially mounted open-only and all-state PR readers in different coalescing lanes                                           | Disable the redundant workspace reader and reuse the session result for compare URL; retain separate reader for genuinely different workspace scope | Rail data hook tests; equivalent-reader lifecycle test                               |
| Background work    | keep    | Existing hook owns visibility and remote-mutation listeners, shared head-check subscription, generation guard, and cleanup; `poll` remains false for rail | No new timer, retry loop, watcher, or background process                                                                                            | Existing hidden-start, hidden-push, no-poll, and push-invalidation tests pass        |
| Memory             | keep    | Existing branch cache is LRU capped at 8 entries with 45-second freshness; all-state lookup uses a distinct cache suffix                                  | Prevent closed summaries from contaminating open-only consumers; in-flight requests release on settlement                                           | Existing cache cap/eviction/coalescing tests plus all-state/open-only isolation test |
| Scope/isolation    | fix     | Conversation lookup uses its own worktree path/branch; previous branch results are generation-guarded and hidden by `scopeKey`                            | No fallback to an unrelated active workspace PR; scoped loading state and refresh-failure retention                                                 | New late-previous-branch-response test; rail same/different/unresolved-scope tests   |
| Rendering/hot path | keep    | Rail projects one summary row and an optional retry/loading row from existing hooks; no transcript scanning or list loading                               | Existing shared rows, section controls, and design tokens remain the presentation owner                                                             | Component rendering tests and browser fixture screenshots                            |

## Lifecycle matrix

| State                      | Required behavior                                                                     | Evidence / limitation                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Visible mount              | Load the scoped summary; coalesce equivalent reads                                    | Hook tests; two concurrent summary consumers issue one PR lookup                                    |
| Visible idle               | No rail-owned polling                                                                 | Existing no-poll timer test; `poll` omitted by rail                                                 |
| Hidden / visibility return | Defer network work while hidden, revalidate when visible                              | Existing hook visibility tests                                                                      |
| Push / refresh             | Revalidate on owning branch mutation; preserve cached summary on failure; offer retry | Existing mutation tests and new failure/retry test                                                  |
| Branch / session switch    | Clear previous visible scope immediately; reject delayed old result                   | New lifecycle test resolves current branch first, previous branch last; current summary remains     |
| Unmount                    | Remove listener/subscription ownership and invalidate pending completion              | Existing effect cleanup inspected; real process measurement not run                                 |
| No PR / closed / merged    | Hide absent section; show historical summary without requesting settled head checks   | Hook tests and rendered-section tests                                                               |
| Account / endpoint         | Reuse existing credential-scoped GitHub cache keys and identity eviction              | Cache implementation inspected; live credential-switch/native multi-instance behavior not exercised |

## Verification performed

- `pnpm test src/hooks/git/useBranchPullRequestStatus.lifecycle.test.ts src/hooks/git/useBranchPullRequestStatus.test.ts src/services/git/branchPullRequestStatus.test.ts`: **25 tests passed** during independent review.
- Real production `WorkstationSections`, `WorkstationItemRow`, shared Button/Tooltip/icon/token implementations bundled into an isolated browser fixture. Verified collapse/expand, click callback, long-title ellipsis at 256 px, light/dark themes, and no-PR section omission.
- Screenshot details and exact fixture limits are documented in `docs/verification-2026-09-25/pull-request-rail/README.md`.

## Remaining verification boundary

The real Tauri app was not launched from this isolated checkout. No live GitHub credential-switch, desktop close/reopen, CPU/RSS idle/hidden measurement, or direct secondary-instance measurement was performed. The browser fixture stubs only unrelated working-tree/image-resource reads and supplies synthetic PR data; it does not prove native RPC or live PR detail navigation. Existing shared in-flight readers remain settlement-bounded rather than introducing a new hard concurrency limit in this feature.

**Performance verdict: blocked** for full native measurement. Scoped code review and unit lifecycle checks pass; this is not a claim of measured runtime improvement or complete native lifecycle validation.

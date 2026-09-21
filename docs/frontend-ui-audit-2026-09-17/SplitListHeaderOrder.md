# SplitListHeader UI audit

| Line                                                                                | Element                          | Verdict          | Reason                                                                                                                                                        | Suggested change |
| ----------------------------------------------------------------------------------- | -------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `src/scaffold/layouts/SplitListHeader.tsx:30`                                       | Split header row order           | keep with reason | Shared shell places the search/action slot first in DOM order, so keyboard order matches visual order; full-width order and single-row geometry are preserved | None             |
| `src/scaffold/layouts/SplitListHeader.tsx:36`                                       | Row surface and controls         | keep with reason | Existing height, padding, colors, and caller-owned shared controls are unchanged; no raw buttons, inputs, or clickable substitutes introduced                 | None             |
| `src/modules/ProjectManager/WorkItems/components/WorkItemsPageHeader/index.tsx:119` | Work Items dataset selector      | keep with reason | Selector and search share the top row; project context remains below; existing shared controls and full-width publishing are preserved                        | None             |
| `src/modules/MainApp/TeamInbox/TeamInboxView.tsx:547`                               | Full-width Inbox leading control | keep with reason | Removed an unnecessary separator between the dataset selector and the flexible space before trailing actions                                                  | None             |

Verdict totals: **0 fix**, **4 keep with reason**, **0 abstract**.

Verification: 15 tests passed across SplitListHeader, GitHubWorkItemsView, and RoutineRunsSurface. Changed-file ESLint and diff whitespace checks passed. Desktop visual verification was not run because computer control was not authorized.

Final isolated-branch verification: 105 tests passed across 11 targeted suites; `pnpm typecheck:fast`, ESLint over all changed TypeScript files, and `git diff --check` passed.

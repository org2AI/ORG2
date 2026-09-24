# Mobile selection surfaces UI audit

| Line | Element | Verdict | Reason | Suggested change |
| --- | --- | --- | --- | --- |
| `src/modules/MobileRemote/_mobileUiTokens.scss:69` | Selection menus | fix | Session view and change-review dropdowns duplicate panel padding, radius, and option colors | Reuse `compact-selection-menu` while keeping each caller's width |
| `src/modules/MobileRemote/components/changes/mobileChangeReview.scss:175` | Review sheet surface | fix | Desktop background tokens differ from the mobile sheet surface | Use the sheet surface and card tokens |
| `src/modules/MobileRemote/components/sessionViewMenu.scss:6` | Dropdown behavior | keep with reason | Shared Dropdown already owns keyboard selection, portal and dismissal | Keep the existing control |
| `src/modules/MobileRemote/_mobileUiTokens.scss:56` | Mobile touch target | keep with reason | Compact visual spacing still uses the 44px row target | Keep the shared size token |

Verdict totals: **2 fix**, **2 keep with reason**, **0 abstract**.

The development root adds deterministic demo routes for visual checks; production navigation and shared control behavior remain unchanged. Source inspection found no new raw button or clickable substitute. Tests cover the development routes, coordinator, session menu and change review. Device screenshots were not captured in this isolated worktree.

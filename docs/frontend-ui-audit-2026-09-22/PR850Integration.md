# PR850 integration UI audit

| Line | Element | Verdict | Reason | Suggested change |
| --- | --- | --- | --- | --- |
| `SimulatorStatusBarView.tsx:97` | Five replay actions | fix | The old PR bypassed shared Button, while develop already migrated the desktop controls | Use shared variant, size, shape, icon and disabled props in the shared presentation |
| `WebOrganizationOnboarding.tsx:158` | Create/join toggle | fix | Removed appearance prop and importance variants represented selected state | Use tertiary with aria-pressed |
| `SidebarOrgSelector.tsx:95` | Conditional browser menu rows | fix | Preserve optional browser actions without restoring native buttons from the old branch | Use existing shared custom menu-row geometry |
| `CommentThreadList.tsx:183` | Resolved-thread disclosure | fix | Old native control lacked disclosure state and was bundled with unreachable mutation controls | Shared inline ghost Button with aria-expanded; retain thread display |
| `ChatPanelChrome.tsx:35` | Header geometry | keep with reason | Shared presentation now carries develop's Spotlight grid, pinned inset, collapsed row and transition hook | Keep caller-supplied content and toolbar; no duplicate desktop frame |
| `SidebarOrgSelector.tsx:95` | Custom Button layout | keep with reason | Compound dropdown rows have glyph/text children and dropdown-token geometry shared by the selector | Keep custom layout at this reusable menu boundary |
| `WebShell.tsx:24` | Browser navigation actions | fix | Button appearance API was removed since the PR was last integrated | Adopt current ghost variant; preserve accessible labels |

Verdict totals: **5 fix**, **2 keep with reason**, **0 abstract**.

Production changed TS/TSX inspected via TypeScript AST for native button creation and raw form controls; no new native-button boundary is needed. Browser-only old API sites are one compatibility sweep, using existing shared props without a design-system configuration change. Notes/replay controls preserve callbacks, disabled behavior and accessible names. Automated markup/DOM checks cover the changed behavior. Authenticated screenshots, themes and responsive visual inspection were not run: Computer Use is opt-in and was not requested.

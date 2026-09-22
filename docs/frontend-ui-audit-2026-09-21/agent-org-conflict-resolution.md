# Agent Org conflict resolution UI audit

| Line | Element | Verdict | Reason | Suggested change |
| --- | --- | --- | --- | --- |
| `AgentOrgSurfaceSwitcher.tsx:143` | Overview and surface triggers | keep with reason | Shared Button uses current tertiary variant, small size, icons and aria-pressed; removed obsolete appearance props during integration. | None. |
| `AgentOrgSurfaceSwitcher.tsx:233` | Group and member menu rows | keep with reason | Shared Button custom layout preserves compound checkmark, member name, writer badge and status columns using Dropdown tokens. | None. |
| `AgentOrgGroupProjectionView.tsx:173` | Shared navigation header | keep with reason | Reuses the switcher and content width token; remaining actions retain develop Button variant/tone migration. | None. |

Verdict totals: **0 fix**, **3 keep with reason**, **0 abstract**.

Inspected production JSX: no native buttons, clickable substitutes, or new native inputs in the resolved controls. Removed blocker card remains removed by the explicit PR product requirement. No new lifecycle or background work is introduced by this integration. Existing scrolling and navigation regression tests are rerun; fresh packaged-app visual evidence is not captured in this conflict-resolution pass.

# SettingsTableActions UI audit

| Line                           | Element        | Verdict          | Reason                                                                                                | Suggested change |
| ------------------------------ | -------------- | ---------------- | ----------------------------------------------------------------------------------------------------- | ---------------- |
| MyAccountsTableSection.tsx:390 | Refresh action | keep with reason | Reuses Button, localized labels and the existing refresh animation hook; loading disables the action. | None.            |
| useRouteToolbarConfig.tsx:96   | Top toolbar    | keep with reason | Removes duplicate integration add/refresh actions while preserving supplementary buttons.             | None.            |

Verdict totals: **0 fix**, **2 keep with reason**, **0 abstract**.

Reviewed changed controls only. Existing layout constants are outside this change. Desktop hover/focus and theme screenshots were not captured: computer control was not enabled.

# AccountInlineActionsBar UI audit

| Line                                                                                      | Element                     | Verdict          | Reason                                                                                                             | Suggested change |
| ----------------------------------------------------------------------------------------- | --------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------- |
| `src/modules/MainApp/Integrations/KeyVault/Accounts/Table/AccountInlineActionsBar.tsx:57` | Reconnect action            | keep with reason | Shared Button, primary importance, small size, visible translated label; route carries provider and account ID.    | None.            |
| `src/modules/MainApp/Integrations/KeyVault/Accounts/Table/AccountInlineActionsBar.tsx:69` | Quota/model refresh actions | keep with reason | Preserves develop's shared RefreshButton with loading and disabled ownership.                                      | None.            |
| `src/modules/MainApp/Integrations/KeyVault/Accounts/Table/AccountInlineActionsBar.tsx:53` | Status layout               | keep with reason | Standard spacing/height tokens; noninteractive div only owns layout. No native-button or clickable-element bypass. | None.            |

Verdict totals: **0 fix**, **3 keep with reason**, **0 abstract**.

Read current ButtonProps and presentation definitions. Inspected rendered JSX and changed TypeScript call sites: action controls use Button/RefreshButton; no new form fields or raw native controls. No layout redesign. Tests cover provider routing/setup-method restoration; rendered themes, narrow viewport and error states were not exercised in Tauri, so visual evidence remains unverified.

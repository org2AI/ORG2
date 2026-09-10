# ImportRowSelection UI audit

| Line                         | Element                 | Verdict          | Reason                                                                                                              | Suggested change |
| ---------------------------- | ----------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------- |
| useCredentialImport.tsx:271  | Checkbox/name cell      | keep with reason | A div avoids label-generated duplicate clicks; Checkbox retains an explicit accessible name and keyboard operation. | None.            |
| useExternalImport.tsx:421    | Shared import name cell | keep with reason | Uses the same Checkbox and functional selection update for all import kinds.                                        | None.            |
| InlineExternalImport.tsx:152 | Row click               | keep with reason | Uses SettingsTable's existing interactive-target exclusion for links, buttons and checkboxes.                       | None.            |

Verdict totals: **0 fix**, **3 keep with reason**, **0 abstract**.

Reviewed changed controls only. Existing layout constants are outside this change. Desktop hover/focus and theme screenshots were not captured: computer control was not enabled.

# CLI interactions UI audit

| Line                         | Element                    | Verdict          | Reason                                                                                                                       | Suggested change |
| ---------------------------- | -------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `CliPermissionPill.tsx:91`   | Permission selector        | keep with reason | Reuses SelectorPill, shared icon, tooltip and dropdown positioning engine; restricted to supported CLI sessions              | None             |
| `CliPermissionPill.tsx:110`  | Permission menu            | keep with reason | Reuses DropdownPanel, DropdownItem and the shared menu width token                                                           | None             |
| `QuestionCardBody.tsx:86`    | Native free-text answer    | keep with reason | Reuses the existing Textarea and question submission flow                                                                    | None             |
| `PermissionCardBody.tsx:149` | Persistent approval option | keep with reason | Hidden only for the new native protocol bridge, whose response grants one request; existing transports retain their behavior | None             |

Verdict totals: **0 fix**, **4 keep with reason**, **0 abstract**.

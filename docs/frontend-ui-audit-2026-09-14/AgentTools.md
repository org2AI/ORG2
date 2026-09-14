# Agent tools UI audit

| Line                                                                               | Element                  | Verdict          | Reason                                                                                                                         | Suggested change |
| ---------------------------------------------------------------------------------- | ------------------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| `src/modules/MainApp/AgentOrgs/config/customAgent/CustomAgentToolsSection.tsx:320` | Error notice             | keep with reason | Reuses PageNotice with danger semantics and translated title; no custom dialog or hardcoded color.                             | None.            |
| `src/modules/MainApp/AgentOrgs/config/customAgent/CustomAgentToolsSection.tsx:322` | Retry action             | keep with reason | Shared Button defaults to secondary outline and native button semantics; translated visible text supplies its accessible name. | None.            |
| `src/modules/MainApp/Integrations/BuiltInTools/Table/BuiltInToolsTable.tsx:289`    | Matrix failure and retry | keep with reason | Same shared notice and Button primitives; two small sites do not justify another wrapper.                                      | None.            |
| `src/modules/MainApp/Integrations/BuiltInTools/Table/BuiltInToolsTable.tsx:237`    | Tool availability switch | keep with reason | Existing shared Switch keeps its label and reflects authoritative blocked/pending state through its disabled contract.         | None.            |

Verdict totals: **0 fix**, **4 keep with reason**, **0 abstract**.

Inspected changed production JSX and shared Button props/presentation. No raw button/input or clickable substitute is introduced. No new arbitrary geometry, literal color or duplicated visual scaffold. Native desktop screenshots and themes were not exercised; this report is source evidence only.

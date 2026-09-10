# Chat error alerts UI audit

| Line                   | Element                      | Verdict          | Reason                                                       | Suggested change                                                       |
| ---------------------- | ---------------------------- | ---------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------- |
| UserChatItem.tsx       | Delivery failure and retry   | fix              | Custom red text was embedded in the message toolbar          | Moved to session body with default PageNotice and action configuration |
| AgentErrorChatItem.tsx | Account recovery alert       | fix              | User requested default alert props                           | Uses default full-width PageNotice with recovery action                |
| AgentErrorChatItem.tsx | Technical details disclosure | keep with reason | Native button supports keyboard activation and aria-expanded | None                                                                   |

Verdict totals: **2 fix**, **1 keep with reason**, **0 abstract**.

Scope: both screenshot error surfaces; shared alert defaults are unchanged.

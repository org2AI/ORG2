# WeeklyQuotaHistoryPanel UI audit

| Line                              | Element             | Verdict          | Reason                                                                                                                                                                     | Suggested change |
| --------------------------------- | ------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `WeeklyQuotaHistoryPanel.tsx:58`  | Error notice        | keep with reason | Fetch failures reuse compact PageNotice with status semantics                                                                                                              | None             |
| `WeeklyQuotaHistoryPanel.tsx:145` | Account heading     | keep with reason | Preserves account names and removes the Codex provider suffix as requested; selector follows the same rule                                                                 | None             |
| `WeeklyQuotaHistoryPanel.tsx:261` | Week controls       | keep with reason | Week picker sits below the chart; shared Button provides keyboard behavior, labels and disabled states                                                                     | None             |
| `WeeklyQuotaHistoryPanel.tsx:194` | Chart styling       | keep with reason | Uses shared chart tokens and existing responsive dimensions; no new color or size values                                                                                   | None             |
| `WeeklyQuotaHistoryPanel.tsx:154` | Account status line | keep with reason | One prioritized status left of the timestamp with a decorative separator; paused uses danger-6 and stale uses warning-6; paused sampling supersedes stale age as requested | None             |

Verdict totals: **0 fix**, **5 keep with reason**, **0 abstract**.

Reviewed D1–D5 for this panel. No cross-file sweep identified. Sampling and refresh lifecycle are unchanged. Verified through rendered component tests and lint; no desktop UI control used.

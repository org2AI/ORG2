# SourceControlFilterHeader UI audit

| Line                                | Element                   | Verdict          | Reason                                                                                                                     | Suggested change |
| ----------------------------------- | ------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `SourceControlFilterHeader.tsx:114` | Staging filter visibility | keep with reason | Explicit product requirement: hide Staged and Unstaged only when staged count is zero; unknown counts retain the options   | None             |
| `SourceControlFilterHeader.tsx:117` | Selection reconciliation  | keep with reason | An active hidden staging filter returns to Uncommitted through the existing owner callback; other selections are preserved | None             |
| `SourceControlFilterHeader.tsx:188` | Filter control            | keep with reason | Existing shared Select and theme tokens are reused                                                                         | None             |

Verdict totals: **0 fix**, **3 keep with reason**, **0 abstract**.

No source data is malformed or removed. This is an explicitly requested presentation rule. No new polling, listeners, scans, network requests, or retained resources are introduced. Reconciliation is keyed to the hidden-selection condition and does not run while an available filter remains selected. Existing Git operations and data ownership remain unchanged.

Tests cover positive/zero/unknown staged counts, hidden active selections, and preservation of history selection. Native visual verification was not performed because computer control was not authorized.

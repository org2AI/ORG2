# Modal status UI audit

Implementation follow-up to the modal audit. Scope is this PR only.

| Line                                       | Element               | Verdict          | Reason                                                   | Suggested change                      |
| ------------------------------------------ | --------------------- | ---------------- | -------------------------------------------------------- | ------------------------------------- |
| `src/scaffold/ModalSystem/index.tsx:64`    | Action status mapping | fix              | Accepted warning/success statuses were silently ignored  | Use existing Button semantic variants |
| `src/components/Button/presentation.tsx:1` | Semantic palettes     | keep with reason | The design system already supports all required statuses | Reuse existing tokens                 |

Verdict totals: **1 fix**, **1 keep with reason**, **0 abstract**. The fix is implemented; multi-site patterns count once.

Forward every supported semantic status to the existing Button variant API; keep default and omitted status mapped to primary. Cover danger, warning, success, default and omitted values on rendered actions.

The work-item return action now uses the intended warning palette. Existing danger/default behavior is covered. Native visual checks were not run because computer control was not authorized; no dependency, persistence or wire changes.

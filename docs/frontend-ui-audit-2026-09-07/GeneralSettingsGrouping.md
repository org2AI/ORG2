# General settings grouping UI audit

| Line                              | Element                                     | Verdict          | Reason                                                                                                                           | Suggested change |
| --------------------------------- | ------------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `GeneralSection.tsx:363`          | HTTP version in language/timezone container | keep with reason | Uses the shared SectionContainer with a SectionRow rendered by HttpVersionSettingsBlock; no nested card or custom spacing        | None             |
| `GeneralSection.tsx:481`          | Developer mode container                    | keep with reason | Uses the shared SectionContainer, SectionRow, and Switch immediately above the existing conditional JSON settings-file container | None             |
| `HttpVersionSettingsBlock.tsx:34` | HTTP selector row                           | keep with reason | Retains the existing translated label, HintWithInfo tooltip, Select, and SECTION_CONTROL_STYLE; parent now owns grouping         | None             |
| `GeneralSection.tsx:453`          | Version and update action                   | keep with reason | Reuses path text and action gap tokens; retains local-build label without revision metadata                                      | None             |
| `Org2CloudSection.tsx:199`        | Rename save/cancel buttons                  | keep with reason | Standard square secondary icon-only buttons; shrink-0 prevents the input flex layout from compressing their 32px width           | None             |

Reviewed D1–D5 for the changed layout: existing design-system controls and tokens retained, no custom colors/sizes or new interactions, no additional abstraction needed.

Verdict totals: **0 fix**, **5 keep with reason**, **0 abstract**.

Verification: targeted ESLint and fast TypeScript checks passed. No desktop visual verification was run.

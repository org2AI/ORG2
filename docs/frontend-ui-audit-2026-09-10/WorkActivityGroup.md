# WorkActivityGroup UI audit

Scope: work summaries, page-setting control, and the explicitly requested shared chat activity icon sizing. Reviewed D1–D5.

| Line                             | Element                         | Verdict          | Reason                                                                                                      | Suggested change                                                                                              |
| -------------------------------- | ------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `WorkActivityGroup/index.tsx:99` | Summary header                  | keep with reason | Reuses StackedBlock with its bold title and lighter count subtitle, retaining the requested existing format | None                                                                                                          |
| `WorkActivityGroup/index.tsx:38` | Expanded content paging         | keep with reason | Reuses SettingsTablePagination; mounts at most 20 native registry blocks and only after expansion           | None                                                                                                          |
| `WorkActivityGroup/index.tsx:81` | Group icon                      | keep with reason | Existing family icons for homogeneous work, ActivitySparkIcon for mixed families                            | None                                                                                                          |
| `EventBlockHeader.tsx:45`        | Expand/collapse keyboard action | fix              | Shared header previously had only pointer interaction; new expandable summaries require keyboard access     | Implemented Enter/Space, focusability, and expanded state; nested controls retain their own keyboard handling |
| `config.ts:295`                  | Activity icon sizing            | fix              | Shared desktop/mobile CSS previously tied icon dimensions to title text, overriding primitive dimensions    | Implemented fixed 16×16 wrapper and larger glyphs in the shared primitive and both chat stylesheet owners     |

Verdict totals: **2 fix**, **3 keep with reason**, **0 abstract**.

The shared icon change is the user-requested sweep; unrelated app/sidebar/menu icons are outside this scope. Component tests cover the native header, keyboard expansion, icon selection, collapse, and bounded paging. Desktop visual verification was not performed because computer control was not requested.

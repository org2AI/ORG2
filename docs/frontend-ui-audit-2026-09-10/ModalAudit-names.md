# Modal names UI audit

Implementation follow-up to the modal audit. Scope is this PR only.

| Line                                    | Element                          | Verdict          | Reason                                                           | Suggested change                        |
| --------------------------------------- | -------------------------------- | ---------------- | ---------------------------------------------------------------- | --------------------------------------- |
| `src/scaffold/ModalSystem/index.tsx:64` | Rich-title accessible name       | fix              | ReactNode titles previously had no name relationship             | Associate only title content with useId |
| `src/scaffold/ModalSystem/index.tsx:64` | String title and header controls | keep with reason | Preserve existing string names and exclude actions from the name | Retain                                  |

Verdict totals: **1 fix**, **1 keep with reason**, **0 abstract**. The fix is implemented; multi-site patterns count once.

Associate rich title content with a unique aria-labelledby target and accept an explicit aria-label for dialogs without a visible title. Preserve the existing string-title behavior and keep header actions outside the label.

Rich titles gain a wrapper around their label content. Automated DOM coverage checks names and unique IDs; native screen-reader and visual checks were not run because computer control was not authorized. No persistence, network or dependency changes.

# Activity group wording and page display UI audit

| Line                               | Element                  | Verdict          | Reason                                                                                                                                               | Suggested change |
| ---------------------------------- | ------------------------ | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `WorkActivityGroup/index.tsx:80`   | Homogeneous group labels | keep with reason | Uses the same translation keys and group icons as Explore, Run commands, and Edit files; browser presentation is now shared with the normal renderer | None             |
| `SessionHeaderActionsMenu.tsx:508` | Pagination section       | keep with reason | Pagination is the first row, followed by a shared menuGroupSeparator; keyboard navigation skips the noninteractive divider                           | None             |
| `SessionHeaderActionsMenu.tsx:508` | Setting row containers   | keep with reason | Uses menuControlItem instead of composing action-row styles and ad hoc alignment classes                                                             | None             |

Verdict totals: **0 fix**, **3 keep with reason**, **0 abstract**.

Checks: 61 targeted component/token tests pass, including identical terminal header text/icons in both display modes, stable tense across running/completed updates, pagination position, separator tokens, and bounded expansion. Typecheck and changed-file lint pass. All 13 locale files parse; old past/progressive group-title keys are gone, and Chinese tool/pinned-skills labels contain no 已. Desktop visuals were not checked because computer control was not requested.

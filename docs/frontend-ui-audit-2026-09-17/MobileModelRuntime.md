# Mobile model selector UI audit

| Line                                                                     | Element                              | Verdict          | Reason                                                                                                                                               | Suggested change |
| ------------------------------------------------------------------------ | ------------------------------------ | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `src/components/ModelSelectorPill/ModelSelectorPillView.tsx:79`          | Shared trigger and menu presentation | keep with reason | Extracted without changing rendered markup, geometry, colors, focus, or menu ownership; SelectorPill and PillGroup continue to use the shared Button | None             |
| `src/modules/MobileRemote/components/composer/MobileModelPicker.tsx:194` | Mobile trigger                       | keep with reason | Supplies the remote model, account label, and effort capability while preserving existing mobile class tokens and accessible label                   | None             |

Verdict totals: **0 fix**, **2 keep with reason**, **0 abstract**.

Inspected changed production JSX and the extraction diff: no raw button/input, native button creation, or replacement clickable element was introduced. The existing pointer/focus capture wrapper only observes events from its shared button; it is not an action control. No visual changes require screenshots; live iOS visual smoke testing is not performed in this change.

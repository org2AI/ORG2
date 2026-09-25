# Human conversation composer UI audit

| Line                                      | Element                 | Verdict          | Reason                                                                                                                                             | Suggested change |
| ----------------------------------------- | ----------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `ChannelPanelView/ChannelComposer.tsx:94` | Channel member picker   | keep with reason | Passes the existing custom mention contract into shared InputArea; no separate editable field, button, or geometry                                 | None             |
| `InputArea/index.tsx:247`                 | Human-mode context menu | keep with reason | Agent modes are excluded from the menu's actual entry list for human composers, including keyboard navigation; agent composers keep their defaults | None             |
| `ContextMenu/index.tsx:389`               | Member menu rows        | keep with reason | Existing MenuItemRow control and keyboard handling are retained; the patch changes audience data, not presentation primitives                      | None             |
| `ChannelPanelView/index.tsx:515`          | Channel composer footer | keep with reason | Uses the shared composer and existing loading/error/post-permission surface; no raw action control is introduced                                   | None             |

Verdict totals: **0 fix**, **4 keep with reason**, **0 abstract**.

Changed production JSX and the rendered row implementation were inspected for raw buttons, native button creation, substitute clickable elements, and form fields. No new bypass was introduced. The existing hidden file input is a documented native file-selection boundary and is unchanged. No new per-site styling or control abstraction warrants a sweep.

Real desktop evidence: before the change the channel @ menu showed Build/Plan/Ask/Project without teammates. After the change it showed all and two test teammates, with no agent modes; selection and Send persisted exactly one chosen recipient ID. Accessibility inspection and screenshots were collected in the acceptance task. The menu keeps existing dark-theme geometry. Light/narrow viewport visual acceptance has not been run.

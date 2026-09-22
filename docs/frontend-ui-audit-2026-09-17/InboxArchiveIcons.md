# Inbox archive icons UI audit

| Line                             | Element      | Verdict          | Reason                                                                                                                   | Suggested change |
| -------------------------------- | ------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| `AssignedWorkItemDetail.tsx:527` | Archive icon | keep with reason | Existing shared header action preserves its accessible label and Button control; only the shared Hugeicons glyph changes | None             |
| `CommentMentionDetail.tsx:99`    | Archive icon | keep with reason | Uses the same header action family and existing size/stroke presentation                                                 | None             |
| `WorkItemEventDetail.tsx:98`     | Archive icon | keep with reason | Retains the shared action wrapper, label, handler and upward-arrow restore pair                                          | None             |

Verdict totals: **0 fix**, **3 keep with reason**, **0 abstract**.

Inspected the production diff and surrounding action controls: no raw button, substitute clickable element, new dimensions, colors, or duplicate control shell is introduced. The shared icon export adds no dependency. Automated detail tests passed; desktop visual checks were not run because computer control was not authorized.

# Communication and submissions dependency leaves UI audit

Scope: renderer imports and extracted pure classification/derivation only. Rendered markup, handlers, styles, labels, and PR status behavior are unchanged. No visual evidence is needed for moving data functions; native WebView behavior was not exercised.

| Line                                                                                               | Element                | Verdict          | Reason                                                                                                                                     | Suggested change |
| -------------------------------------------------------------------------------------------------- | ---------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| `src/modules/WorkStation/Chat/Communication/EmailMessageBubble.tsx:240`                            | Message bubble shell   | keep with reason | Existing ChatBubbleLayout, ChatBubbleAvatar, and ChatBubbleHeader remain the shared scaffold; classification is now imported independently | None             |
| `src/modules/WorkStation/Diff/SessionReplay/SubmissionsContent.tsx:165`                            | Commit rows            | keep with reason | Existing GitCommitRow owns row navigation and rendering; moving derivation preserves its props and click path                              | None             |
| `src/modules/WorkStation/Diff/SessionReplay/SubmissionsContent.tsx:180`                            | Empty states           | keep with reason | Existing Placeholder controls localized empty rendering; the data leaf preserves empty arrays                                              | None             |
| `src/modules/WorkStation/Diff/SessionReplay/__tests__/SubmissionsContent.prStatusBadge.test.ts:14` | PR badge data contract | keep with reason | The type now comes from the data leaf while the same renderer and status badge tests cover unresolved and resolved states                  | None             |

Verdict totals: **0 fix**, **4 keep with reason**, **0 abstract**.

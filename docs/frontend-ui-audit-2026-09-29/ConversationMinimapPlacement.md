# ConversationMinimapPlacement UI audit

| Line                                                                       | Element                | Verdict          | Reason                                                                                                                                                                                                          | Suggested change |
| -------------------------------------------------------------------------- | ---------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `src/engines/ChatPanel/ChatHistory/components/ConversationMinimap.tsx:194` | Navigator placement    | keep with reason | Existing ChatPanelFullScreenContext is authoritative. One component remains in the chat body; fullscreen chooses left and ordinary mode right. Shared pill/flush geometry and theme tokens are retained.        | None.            |
| `src/engines/ChatPanel/ChatHistory/components/ConversationMinimap.tsx:199` | Turn and pin previews  | keep with reason | Both open inward. Hover expansion aligns with the selected edge; existing shared Button markers retain keyboard, navigation and hover behavior. Custom layout remains necessary for tiny minimap tick geometry. | None.            |
| `src/engines/ChatPanel/focusedChatWorkstationLayout.ts:76`                 | Former right-hand host | keep with reason | Removes obsolete portal host, callback props and reserved 36px column. The trail continues to own only its own surface/terminal width.                                                                          | None.            |

Verdict totals: **0 fix**, **3 keep with reason**, **0 abstract**.

## Contract and ownership

Unpaginated chat → existing fullscreen state in ChatPanelShell → ChatPanelFullScreenContext → ConversationMinimap placement. Enter fullscreen: left edge, previews right. Exit: right edge, previews left. Existing 960px chat-body breakpoint controls flush versus floating appearance on either side; narrower idle visibility follows the existing ordinary-pane rule. Pagination gating, sampled indices, pinned data and navigation callbacks are unchanged.

The previous placement was presentation-only: the maximized navigator portaled beneath the right workstation trail. No persisted data or writer is involved. Removing that host avoids relying on trail mount timing and keeps navigator DOM/focus stable across fullscreen transitions. No new timers, requests, subscriptions or caches; existing pin-hover cleanup is unchanged.

## Verification

- `pnpm test src/engines/ChatPanel/ChatHistory/components/__tests__/ConversationMinimap.test.ts src/engines/ChatPanel/ChatHistory/components/__tests__/ConversationMinimap.placement.test.ts src/engines/ChatPanel/focusedChatWorkstationLayout.test.ts src/engines/ChatPanel/components/SessionWorkstationRail.test.ts src/scaffold/AppLayout/FocusedChatWorkstationRail/FocusedChatWorkstationRail.test.ts src/engines/ChatPanel/ChatPanelShell.test.ts`: 74 passed on the isolated branch based on latest develop.
- The rendered test verifies default→fullscreen→default, same navigator DOM, retained focus/preview and working navigation callback.
- `pnpm typecheck:fast`: passed.
- ESLint with `--max-warnings 0` passed for all changed production files and tests; final two-file alignment changes rechecked.
- Scoped `git diff --check`: passed. Production JSX inspected: shared Button controls retained; no raw button or clickable-element substitutes added.
- Browser fixture using the real minimap/context: verified ordinary 680px right placement, fullscreen 1100px left placement, fullscreen 480px left pill, inward preview and navigation selection. Screenshots in `docs/verification-2026-09-29/minimap-placement/minimap-{normal-right,fullscreen-left,fullscreen-narrow}.png`.
- Desktop application integration was not visually exercised: current unbundled dev app is absent from the computer-use app inventory. Fixture screenshots verify the production component's CSS and interactions with sample conversation data; they are not full-app screenshots.

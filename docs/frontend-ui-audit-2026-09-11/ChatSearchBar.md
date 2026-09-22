# ChatSearchBar UI audit

| Line                                                                   | Element                  | Verdict          | Reason                                                                                                                                           | Suggested change |
| ---------------------------------------------------------------------- | ------------------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| `src/engines/ChatPanel/ChatHistory/components/ChatSearchBar.tsx:8`     | Session adapter          | keep with reason | Delegates all card chrome and selected controls to the shared FindCard; see FindCard.md for shared component review                              | None             |
| `src/engines/ChatPanel/ChatHistory/components/ChatHistoryView.tsx:324` | Search overlay placement | keep with reason | User requested a floating top-right overlay; anchored to the outer chat panel including header and rail, with pointer events limited to the card | None             |

Verdict totals: **0 fix**, **2 keep with reason**, **0 abstract**.

Visual verification was not performed because local computer control was not requested.

# Wiki modal UI audit

| Line                                                                      | Element            | Verdict          | Reason                                                                                                                                                 | Suggested change |
| ------------------------------------------------------------------------- | ------------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| `src/features/Wiki/WikiModal.tsx:13`                                      | Dialog shell       | keep with reason | Reuses Modal for focus trapping and Escape. A bounded 80dvh height and hidden body overflow make the article the only scroll owner                     | None             |
| `src/features/Wiki/WikiBrowser.tsx:30`                                    | Search             | keep with reason | Shared labeled Input in the fixed sidebar header; no result count or extra introductory copy                                                           | None             |
| `src/features/Wiki/WikiBrowser.tsx:42`                                    | Article navigation | keep with reason | Native buttons reuse SESSION_ROW_PRESENTATION, SIDEBAR_STYLE.rowHeight and sidebar selection tokens, matching sidebar rows without form-button styling | None             |
| `src/features/Wiki/WikiBrowser.tsx:61`                                    | Article pane       | keep with reason | Shared border token separates the fixed sidebar from a keyboard-focusable scroll region; article identity resets scroll on navigation                  | None             |
| `src/scaffold/NavigationSidebar/blocks/SidebarSettingsMenuButton.tsx:381` | Wiki menu action   | keep with reason | Matches sibling dropdown tokens and closes the dropdown before opening the separate modal                                                              | None             |

Verdict totals: **0 fix**, **5 keep with reason**, **0 abstract**.

English-only content is explicitly requested. Articles contain category, title, summary and instructions; interactive demonstrations and simulated credential validation are excluded.

Verification: rendered jsdom tests cover search, no results, article navigation, Escape/reopen, independent menu access outside developer mode and preserved onboarding actions. Desktop visual inspection and screenshots were not performed because computer control was not authorized. Small viewport layout, actual scrolling, and light/dark appearance remain visually unverified.

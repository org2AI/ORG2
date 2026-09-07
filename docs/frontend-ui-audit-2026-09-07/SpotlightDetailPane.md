# Spotlight detail panes UI audit

| Line                          | Element            | Verdict          | Reason                                                                                                                                              | Suggested change |
| ----------------------------- | ------------------ | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `SpotlightDetailPane.tsx:69`  | Hover ownership    | keep with reason | Reuses HoverCardBase singleton and disposal; no per-palette overlay engine                                                                          | None             |
| `SpotlightDetailPane.tsx:74`  | Surface            | keep with reason | The outer scrolling portal owns the same rounded border, background and shadow as Spotlight, preventing square clipping                             | None             |
| `SpotlightDetailPane.tsx:84`  | Compact content    | keep with reason | Two visual rows; title and summary truncate; branch commit timestamps are excluded from metadata selection                                          | None             |
| `SpotlightDetailPane.tsx:105` | Multi-folder chips | keep with reason | Reuses Tag and AnyIcon, receives typed folder members from both picker producers, and keeps full paths in titles                                    | None             |
| `sidePanePlacement.ts:8`      | Geometry           | keep with reason | Measured panel bounds and viewport padding govern layout; right placement follows the row, below placement centers under the footer with an 8px gap | None             |

Verdict totals: **0 fix**, **5 keep with reason**, **0 abstract**.

No config-level sweep candidate. Existing picker keyboard activation remains unchanged; focusable triggers also open detail panes. Blank and disabled items have no empty preview. Multi-folder chips occupy one horizontal scrolling row.

Live screenshots and native light/dark/narrow-window inspection were not performed because desktop control requires explicit user opt-in. Automated tests cover row alignment, centered below-footer geometry, rounded surface ownership, concise metadata, structured folders, singleton behavior, Escape, scroll dismissal, resize and unmount.

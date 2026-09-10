# WorkStationStartPage UI audit

| Line                                                      | Element             | Verdict          | Reason                                                                                                                                                                                                       | Suggested change |
| --------------------------------------------------------- | ------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| `src/modules/WorkStation/AppShell/StartPage/index.tsx:76` | Keyboard hint       | keep with reason | Retains the shared KeyboardShortcut component and dropdown variant. Both actual callers supply shortcutId, so removing raw-shortcut forwarding preserves the displayed hint.                                 | None             |
| `src/modules/WorkStation/AppShell/StartPage/index.tsx:52` | Action-row scaffold | keep with reason | The existing full-row button groups the label, optional diff badge, and trailing hint, using semantic button behavior and surface tokens. The prop deletion requires no redesign of this unchanged scaffold. | None             |

D1–D5 checked over the changed surface. Existing typography and row geometry are unchanged; no new colors, sizes, clickable nonsemantic elements, or duplicated shells are introduced.

Verdict totals: **0 fix**, **2 keep with reason**, **0 abstract**.

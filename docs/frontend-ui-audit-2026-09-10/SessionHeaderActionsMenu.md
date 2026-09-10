# SessionHeaderActionsMenu UI audit

Scope: page/input settings split and inline-diff toggle. Reviewed D1–D5.

| Line                               | Element                | Verdict          | Reason                                                                                                                             | Suggested change |
| ---------------------------------- | ---------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `SessionHeaderActionsMenu.tsx:492` | Page settings submenu  | keep with reason | Reuses ActionSubmenu and dropdown icon tokens, including shared keyboard and flyout behavior                                       | None             |
| `SessionHeaderActionsMenu.tsx:550` | Inline diffs switch    | keep with reason | Reuses labeled Switch; checked means full diffs and the adapter preserves the existing stored preference                           | None             |
| `SessionHeaderActionsMenu.tsx:559` | Input settings submenu | keep with reason | Reuses ActionSubmenu, keeps the Skills control separate and directly below page settings, and introduces no custom sizes or colors | None             |

Verdict totals: **0 fix**, **3 keep with reason**, **0 abstract**.

Verification: component tests cover submenu order, keyboard navigation, input control isolation, and both inline-diff toggle directions. Desktop visual verification was not performed because computer control was not requested.

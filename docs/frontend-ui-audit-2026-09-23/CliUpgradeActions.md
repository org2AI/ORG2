# CLI upgrade actions UI audit

| Line                                | Element                              | Verdict          | Reason                                                                                                                                                    | Suggested change |
| ----------------------------------- | ------------------------------------ | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `CliUpgradeButton.tsx:41`           | Documentation action                 | keep with reason | Shared secondary small Button; uses the application's existing link opener                                                                                | None             |
| `CliUpgradeButton.tsx:101`          | Upgrade action                       | keep with reason | Shared Button owns dimensions, loading/disabled behavior; menu trigger has accessible expanded/haspopup state                                             | None             |
| `CliUpgradeButton.tsx:125`          | Installation menu                    | keep with reason | Shared Dropdown owns portal, focus/navigation, Escape and outside click; explicit shared DropdownHeader preserves the original-install-method instruction | None             |
| `ChatPanelCliVersionWarning.tsx:34` | Version notice and remaining actions | keep with reason | Existing compact PageNotice, shared mute/refresh controls and width token preserved                                                                       | None             |

Verdict totals: **0 fix**, **4 keep with reason**, **0 abstract**.

Inspected production JSX and the diff: no raw button, native createElement button or substitute clickable element introduced. No form inputs added. The shared Dropdown's existing event wrapper surrounds a real Button; it is not a new per-site action control. All copy keys and placeholders are aligned in 15 locales. No config-level sweep candidate found.

Rendered behavioral coverage: 8 jsdom tests using the production notice, Button and Dropdown. Native screenshots, theme/viewport coverage and visual layout verification are not yet recorded.

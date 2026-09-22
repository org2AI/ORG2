# FileHeaderSidebarSettingsSubmenu UI audit

| Line                                                              | Element                        | Verdict          | Reason                                                                                                                              | Suggested change |
| ----------------------------------------------------------------- | ------------------------------ | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `src/features/FileHeader/FileHeaderSidebarSettingsSubmenu.tsx:63` | Sidebar settings flyout        | keep with reason | Reuses the shared `ActionSubmenu`, `Switch`, and `SegmentedTextPill` controls instead of recreating menu or input behavior.         | None.            |
| `src/features/FileHeader/FileHeaderSidebarSettingsSubmenu.tsx:94` | Indent-lines section separator | keep with reason | Uses the shared dropdown separator token with native separator semantics and hides the decorative rule from the accessibility tree. | None.            |

Verdict totals: **0 fix**, **2 keep with reason**, **0 abstract**.

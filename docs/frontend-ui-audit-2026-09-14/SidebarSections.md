# Sidebar sections UI audit

| Line                                                                            | Element                        | Verdict          | Reason                                                                                                                                                          | Suggested change |
| ------------------------------------------------------------------------------- | ------------------------------ | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `src/scaffold/NavigationSidebar/connectors/sections/useSidebarSections.tsx:410` | Create/rename dialog           | keep with reason | Shared Modal supplies focus management, Escape handling, and shared footer buttons; submission is disabled for blank names and serialized while saving          | None             |
| `src/scaffold/NavigationSidebar/connectors/sections/useSidebarSections.tsx:429` | Section name                   | keep with reason | Shared Input with accessible name, 80-character limit, and IME-aware Enter submission; Rust validates trimmed names                                             | None             |
| `src/scaffold/NavigationSidebar/connectors/sections/useSidebarSections.tsx:294` | Section header and native menu | keep with reason | Existing NavigationMenu row-action renderer owns the shared icon button; Tauri native menus use the shared popup lifecycle and are a genuine non-React boundary | None             |

Verdict totals: **0 fix**, **3 keep with reason**, **0 abstract**.

Reviewed the changed production TSX and control paths: no new raw button/input JSX, native DOM button creation, or substitute clickable div/span controls. Existing sidebar grouping and section headers are reused. No new colors, pixel dimensions, or per-site button styles. New labels are translated in all 13 navigation locales.

Native visual inspection was not performed: the user's repository instructions require explicit opt-in to desktop UI control. JSDOM interaction tests cover sidebar lifecycle and drag dispatch, not actual native menu appearance or theme/viewport layout.

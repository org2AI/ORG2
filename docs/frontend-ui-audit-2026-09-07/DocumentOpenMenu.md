# DocumentOpenMenu UI audit

Paths below are relative to `src/modules/WorkStation/CodeEditor/Panels/EditorMainPane/content/CodeViewerContent/`.

| Line                            | Element          | Verdict          | Reason                                                                                                                               | Suggested change |
| ------------------------------- | ---------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| `DocumentOpenMenu/index.tsx:47` | Application menu | keep with reason | Uses shared Dropdown options, placement and keyboard behavior; loading and failure are disabled menu rows                            | None             |
| `DocumentOpenMenu/index.tsx:97` | Open in trigger  | keep with reason | Uses Button mini sizing and theme styles, with accessible name and expanded state; no new size/color literals                        | None             |
| `views/BinaryView.tsx:88`       | Header placement | keep with reason | One shared slot covers the document preview branches, including preview error/unsupported content; no per-format toolbar duplication | None             |

Verdict totals: **0 fix**, **3 keep with reason**, **0 abstract**.

D1–D5 reviewed. No cross-file design-system sweep candidate. Browser/web mode hides the local launcher. Unsaved spreadsheet edits disable launch. Actual desktop layout/theme/keyboard checks were not run: user preferences disallow desktop control without explicit opt-in. The component tests verify demand loading, stale completion, platform fallback and dirty state using a mocked Dropdown, not the real popup's rendering.

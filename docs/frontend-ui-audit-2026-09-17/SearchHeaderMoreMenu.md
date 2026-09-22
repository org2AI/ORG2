# Search header more-menu UI audit

| Line                          | Element               | Verdict          | Reason                                                                                                                                                          | Suggested change |
| ----------------------------- | --------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `SearchHeaderMoreMenu.tsx:30` | Ellipsis and dropdown | keep with reason | Reuses FileHeaderMoreMenu, including its shared trigger, action rows, keyboard handling and submenus                                                            | None             |
| `SearchHeaderMoreMenu.tsx:50` | Display settings      | keep with reason | Shared editor atoms control line numbers, wrapping and active-line highlighting in SearchEditorDocument; unsupported minimap and Git Blame controls are omitted | None             |
| `SearchHeaderMoreMenu.tsx:49` | Sidebar settings      | keep with reason | Reuses the requested standard global sidebar preferences; the search surface remains sidebar-free                                                               | None             |

Verdict totals: **0 fix**, **3 keep with reason**, **0 abstract**.

Changed production JSX uses shared action controls, with no new raw buttons, form controls or clickable substitutes. The existing shared menu implementation was reused without modifying its pending unrelated edits.

## Performance guard

| Area               | Verdict | Evidence                                                                  | Change or reason kept                                                                                                 | Verification                                                                |
| ------------------ | ------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Background work    | keep    | Refresh calls the existing search owner; loading disables its menu action | Explicit refresh clears only the query deduplication key and uses the existing cancellation/listener replacement path | Refresh test verifies normal deduplication, explicit rerun and cancellation |
| Memory             | keep    | Search owns its existing two streaming listeners                          | Old listeners released on refresh and latest listeners released on unmount                                            | Refresh test verifies all four unlisten callbacks called once               |
| Scope/isolation    | keep    | Existing hook remains scoped to tab query/repository/options              | No additional search consumer, persistent cache or interval                                                           | Source inspection                                                           |
| Rendering/hot path | keep    | Three existing editor-setting atoms drive CodeMirror configuration        | Wrapping extension remains memoized; no scan or periodic task added                                                   | Typecheck; shared menu tests                                                |

Performance verdict: blocked for native CPU/RSS and visual measurement because desktop UI control was not authorized. No measured performance improvement is claimed.

## Verification

- `pnpm test src/modules/WorkStation/CodeEditor/Panels/EditorPrimarySidebar/content/SearchContent/useSearchContent/__tests__/useSearchExecution.refresh.test.ts src/modules/WorkStation/CodeEditor/Panels/EditorMainPane/content/SearchEditorContent/SearchEditorContent.test.ts src/features/FileHeader/FileHeaderMoreMenu.test.ts` — 9 tests passed
- `pnpm typecheck:fast` — passed
- Targeted ESLint on the six changed/new implementation and test files — passed
- `git diff --check` — passed
- Native app visual verification and CPU/RSS measurement not run

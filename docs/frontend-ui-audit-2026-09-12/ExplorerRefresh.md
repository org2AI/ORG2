# Explorer Refresh UI audit

Scope: moving the regular explorer refresh action from the file-tree section header to the existing three-dot menu. Reviewed changed markup and action wiring across D1–D5.

| Line                                                                                                 | Element                          | Verdict          | Reason                                                                                                                       | Suggested change |
| ---------------------------------------------------------------------------------------------------- | -------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `src/modules/WorkStation/CodeEditor/Panels/EditorMainPane/components/CodeEditorDefaultHeader.tsx:67` | Refresh menu action              | keep with reason | Reuses FileHeader's existing localized DropdownItem, icon sizing, keyboard semantics, loading guard, and menu-close behavior | None             |
| `src/modules/WorkStation/CodeEditor/Panels/EditorPrimarySidebar/hooks/useExplorerActions.tsx:52`     | Remaining section-header actions | keep with reason | Removes only Refresh; retains existing action configuration and shared header renderer without adding markup or styling      | None             |

Verdict totals: **0 fix**, **2 keep with reason**, **0 abstract**.

Verification: `pnpm typecheck:fast`, targeted ESLint on all seven changed source files, and `pnpm test src/modules/shared/components/FileHeader/FileHeaderMoreMenu.test.ts` passed (6 tests). Live visual verification was not run: user preferences prohibit computer control without explicit opt-in.

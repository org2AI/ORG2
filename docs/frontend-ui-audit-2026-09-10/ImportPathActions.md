# ImportPathActions UI audit

| Line                           | Element            | Verdict          | Reason                                                                                                                  | Suggested change |
| ------------------------------ | ------------------ | ---------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------- |
| useCredentialImport.tsx:321    | Source path button | keep with reason | Native inline button provides a truncated path hit area with accessible name, focus ring and independent reveal action. | None.            |
| useCredentialImport.tsx:333    | Folder icon        | keep with reason | Direct-child selectors scope visibility to its own link; opacity preserves layout.                                      | None.            |
| PathCopyOpenRow.tsx:53         | Path actions       | keep with reason | Existing Button controls keep keyboard access; CSS reveals them on hover/focus without JavaScript state.                | None.            |
| CliRawConfigFileEditor.tsx:190 | Config actions     | keep with reason | Existing action group reveals copy/open on hover or focus.                                                              | None.            |
| ConfigGeneralSection.tsx:90    | Workspace action   | keep with reason | Existing Button reveals on path-group hover or keyboard focus.                                                          | None.            |

Verdict totals: **0 fix**, **5 keep with reason**, **0 abstract**.

Reviewed changed controls only. Existing layout constants are outside this change. Desktop hover/focus and theme screenshots were not captured: computer control was not enabled.

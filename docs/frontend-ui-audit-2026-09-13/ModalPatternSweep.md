# Modal pattern sweep UI audit

Scope: SpotlightShell entry points, their form and selector content, plus standard Modal consumers with extra first-child body padding. This is an implementation sweep requested by the user, not an audit-only pass.

| Line                                                                                    | Element                                       | Verdict          | Reason                                                                                                              | Suggested change                                                                    |
| --------------------------------------------------------------------------------------- | --------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Sites below                                                                             | Duplicate body padding in 11 standard dialogs | fix              | Modal already provides p-3; additional outer padding misaligns content with shared header/footer chrome             | Removed only redundant outer body padding; retained card, grid, and control spacing |
| `src/scaffold/ModalSystem/index.tsx:439`                                                | Standard dialog headers                       | keep with reason | PanelHeader is the existing shared pattern for action/confirmation dialogs                                          | Keep; Spotlight breadcrumb headers belong to Spotlight form pages                   |
| `src/scaffold/GlobalSpotlight/palettes/AddWorkingDirectoryModalShell.tsx:58`            | Repository/workspace form headers             | keep with reason | SpotlightFormLayout owns the action path; all five SpotlightModalView form calls hide their legacy internal headers | None                                                                                |
| `src/scaffold/GlobalSpotlight/palettes/SessionCreatorPalette/index.tsx:55`              | Session creation                              | keep with reason | Uses shared header/body, clears inner padding, and defaults dropdownDirection to down                               | None                                                                                |
| `src/features/SessionCreator/components/WorkItemPickerModal/WorkItemPickerPanel.tsx:23` | Work-item and other searchable selectors      | keep with reason | PaletteBody owns search/navigation and list spacing; form body padding would double inset these lists               | None                                                                                |
| `src/features/CanvasShare/CanvasShareDialog.tsx:66`                                     | Padded content card                           | keep with reason | Border/background define an inner card requiring its own padding                                                    | None                                                                                |
| `src/engines/ChatPanel/components/SessionRawTranscriptDialog/index.tsx:29`              | Transcript scrolling layout                   | keep with reason | Explicit p-0 Modal body delegates spacing to custom flex/scroll content; not duplicate padding                      | None                                                                                |

Verdict totals: **1 fix** (11-site sweep), **6 keep with reason**, **0 abstract**.

## Fixed sites

- `src/features/SessionCreator/variants/ChatPanel/ScreenPickerModal.tsx:28`
- `src/scaffold/NavigationSidebar/connectors/SessionExportModal.tsx:108`
- `src/scaffold/ModalSystem/variants/Rename/index.tsx:74`
- `src/modules/ProjectManager/WorkItems/components/BatchPropertyDialog.tsx:171`
- `src/modules/ProjectManager/WorkItems/components/BatchQuickFieldDialog.tsx:125`
- `src/modules/ProjectManager/WorkItems/components/SavedViewsControl.tsx:262`
- `src/modules/ProjectManager/WorkItems/components/WorkItemContent/WorkItemHandoffNotice.tsx:147`
- `src/modules/ProjectManager/WorkItems/components/WorkItemContent/QuickActionsSection.tsx:278`
- `src/modules/ProjectManager/shared/components/ClaimIdentityModal.tsx:32`
- `src/modules/MainApp/Integrations/Skills/Table/ShareSkillDialog.tsx:72`
- `src/engines/ChatPanel/ChatHistory/components/RevertConfirmDialog.tsx:75`

## Verification scope

No persistence, async work, subscriptions, or dropdown behavior changed in this sweep. No further forced-up dropdown outlier was confirmed in the inspected modal flows; standard Select uses automatic viewport-aware placement. Legacy SpotlightModalHeader is hidden at current form call sites, so it is not a visible header violation.

Desktop visual verification was not performed because computer control is opt-in. These are source-level findings; shared Modal tests verify existing rendering behavior, not appearance at every viewport.

# Market connection UI audit

| Line                                                  | Element                                 | Verdict          | Reason                                                                                                                                  | Suggested change |
| ----------------------------------------------------- | --------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `src/features/MarketConnect/ConnectionDialog.tsx:134` | Connection dialog                       | keep with reason | Uses existing ModalSystem with its focus trap, Escape handling and footer; closing is blocked while a configuration mutation is active  | None             |
| `src/features/MarketConnect/ConnectionDialog.tsx:145` | Close, configure and disconnect actions | keep with reason | Shared Button props carry semantic importance, disabled and loading states                                                              | None             |
| `src/features/MarketConnect/ConnectionDialog.tsx:181` | Listing and model controls              | keep with reason | Shared Select, explicit accessible labels and the shared modal popup-layer constant; options come from native/backend purchase metadata | None             |
| `src/features/MarketConnect/ConnectionDialog.tsx:217` | Conflict and connection feedback        | keep with reason | Status/alert semantics distinguish configuration from successful model use; all new strings exist in the 13 locale dictionaries         | None             |
| `src/features/MarketConnect/ConnectionSettings.tsx`   | Settings entry                          | keep with reason | Reuses SectionContainer/SectionRow, Button and Select; does not duplicate modal scaffolding                                             | None             |

Verdict totals: **0 fix**, **5 keep with reason**, **0 abstract**.

Rendered component tests use the actual shared controls and ModalSystem. They prove compatible purchased-model configuration with file hashes, conflict refusal, and explicit unavailable-adapter behavior. The combined component/deep-link suite passes 12 tests. Targeted ESLint passes. These are DOM tests, not packaged-application computer-use evidence. Actual light/dark appearance, popup placement, keyboard navigation and complete desktop/browser flow remain to be inspected on the real surface before delivery.

Lifecycle: the root only loads dialog code after an authorization event. The dialog fetches metadata/config on open; settings reload only on mount or authorization/disconnection events. Listeners are cleaned up, and generation checks discard late loads after replacement/unmount. No polling loop was added. Real application idle/hidden memory and CPU have not yet been measured.

## Folder/launch controls follow-up

| Line                 | Element                  | Verdict          | Reason                                                                                                                       | Suggested change                                                                              |
| -------------------- | ------------------------ | ---------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| WorkspaceLaunch.tsx  | Launch button and errors | keep with reason | Reuses shared Button, native directory dialog, and four translated strings in all 13 locales; no terminal command/key input. | Verify in the packaged application, including cancel and missing client.                      |
| ConnectionDialog.tsx | Lazy launch section      | keep with reason | Appears only after configuration; expensive client discovery runs on click, not on app startup.                              | Combine the first-use configure/launch experience after native lifecycle acceptance.          |
| WorkspaceLaunch.tsx  | Success transition       | keep with reason | Opens the existing terminal surface without claiming a successful model request.                                             | Verify actual process startup and subsequent request before calling this end-to-end complete. |

# Modal dismiss UI audit

Implementation follow-up to the modal audit. Scope is this PR only.

| Line                                                                                                                                                                                                                               | Element                | Verdict          | Reason                                                              | Suggested change                    |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ---------------- | ------------------------------------------------------------------- | ----------------------------------- |
| `src/modules/MainApp/TeamInbox/components/SessionHandoffComposer.tsx:99`; `src/scaffold/NavigationSidebar/connectors/SessionImportExportModal.tsx:204`; `src/modules/WorkStation/Browser/ImportCookies/ImportCookiesModal.tsx:463` | Busy dismissal sweep   | fix              | Header X bypassed the existing busy dismissal policy at three sites | Use closable={!busy}                |
| `src/scaffold/ModalSystem/index.tsx:64`                                                                                                                                                                                            | Existing closure props | keep with reason | The shared primitive already exposes the necessary controls         | Retain its independent close routes |

Verdict totals: **1 fix**, **1 keep with reason**, **0 abstract**. The fix is implemented; multi-site patterns count once.

Bind header closability to the same busy state already used by the other dismissal controls in all three callers. Add rendered tests for blocked close controls and closure returning after the operation settles.

Users must wait for an in-flight operation to settle before closing through the header, consistent with each existing Cancel/Escape policy. This does not add cancellation or timeouts to the underlying requests. Native Tauri operations and visual checks were not run because computer control was not authorized.

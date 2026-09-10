# Dead modal paths implementation audit

Completion checklist: remove two unreachable dialogs and the unreachable import mode; preserve live export, route debug, shared auth helpers, and historical stored sessions; typecheck and export tests pass.

| Layer         | Coverage                                                                                                                      |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 1 Compilation | Full frontend typecheck and changed-file lint pass                                                                            |
| 2 Dead code   | Removed no-caller RemoteBranchDeletedDialog, no-opener legacy Login, export-only caller's import mode and producing helpers   |
| 3 Naming      | Live component and test renamed SessionExportModal; shared helper filename retained because export format terminology remains |
| 4 Semantics   | Removed mode/onImported from the export-only wrapper; shared Modal remains unchanged                                          |
| 5 Defaults    | Removed unreachable import fallbacks; default footer and export behavior preserved                                            |
| 6 Boundaries  | Shared auth helpers and live git error handling retained                                                                      |
| 7 Clarity     | Obsolete Login documentation and remote-dialog barrel example removed                                                         |
| 8 Wire        | Export format/version and serializer inspected unchanged; no native endpoint exercised                                        |
| 9 Init        | Global host no longer subscribes to false-only login atom; route debug remains live                                           |
| 10 Resolution | Export event-source resolution untouched; no backend resolver changes                                                         |

No migration, historical-data remediation, or new background work. Revert this commit to restore removed code. Existing imported snapshots are not deleted or modified. Tests exercise export UI/save dispatch; no native file picker/write verification was performed.

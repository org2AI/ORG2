# Consolidated Find ownership audit

Acceptance criteria: one visual card; explicit Session/File scope; focused scope → other available scope → closed keyboard cycle; unavailable scopes skipped; replacement stays bound to its editor; delayed highlighting retained; mounted targets and floating React roots disposed.

| Layer           | Review                                                                                       | Outcome                                                                         |
| --------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 1 Compilation   | Typecheck, lint, targeted tests                                                              | 26 tests, targeted lint, and the full typecheck pass in the isolated PR branch  |
| 2 Deduplication | ChatSearchBar delegates to FindCard; CodeMirror delegates to the same card                   | Shared presentation and a single Find shortcut dispatcher                       |
| 3 Naming        | FindTarget, FindScope, FindCardSearch                                                        | Names distinguish engine ownership from presentation                            |
| 4 Semantics     | Session means conversation search; File means one registered editor                          | No replacement operation exposed for session scope                              |
| 5 Defaults      | Focused scope opens first; one available target closes on next press                         | Explicit two-scope cycle; hidden/disconnected targets excluded                  |
| 6 Boundaries    | Coordinator accepts element/open/close callbacks                                             | It imports neither Jotai session atoms nor CodeMirror; engines retain authority |
| 7 Readability   | Session adapter and CodeMirror ViewPlugin own registration                                   | No DOM lookup pretending to be CodeMirror open-state authority                  |
| 8 Wire          | No RPC, schema, persistence, or serialization changes                                        | Not applicable                                                                  |
| 9 Init parity   | Regular Editor, Diff, and SearchEditorDocument all call findReplaceExtension                 | All register through the same plugin; programmatic panel opening adopts scope   |
| 10 Resolution   | Remember last focused target separately per scope, then choose a visible registered fallback | Switching back does not arbitrarily target another mounted file                 |

The UI registry is scoped to the current JavaScript document and retains only mounted targets. Cleanup drops targets, active/focused references and global listeners when empty. CodeMirror's search state remains authoritative for query/replace behavior. Its Panel lifecycle owns the floating React root, which is unmounted on close/destroy.

Compatibility: ordinary search keeps the 500 ms debounce. Explicit navigation/replacement flushes the pending query. Read-only files expose no replace UI. No backend or persisted format changes.

## Final refinements

Window-wide Find resolves a visible target even outside chat/editor focus. The outer split-view surface anchors both cards. Session metadata comes from the matching session record; Editor and Diff pass an optional file path whose basename is held in a CodeMirror facet. Multi-file search documents retain the generic fallback. Scope pill visibility follows split layout and visible editor availability. Replacement remains bound to its EditorView. No persistence, RPC, backend, dependency or wire changes. The pill uses regular sizing; no new compact-pill API is needed. Final verification commands and results are recorded in the pull request.

# Modal dead UI audit

Implementation follow-up to the modal audit. Scope is this PR only.

| Line                                                                   | Element                             | Verdict          | Reason                                                                           | Suggested change                          |
| ---------------------------------------------------------------------- | ----------------------------------- | ---------------- | -------------------------------------------------------------------------------- | ----------------------------------------- |
| `src/scaffold/NavigationSidebar/connectors/SessionExportModal.tsx:108` | Export-only modal                   | fix              | The only production caller selected export; import configuration was unreachable | Keep export UI and remove the dead branch |
| `src/scaffold/NavigationSidebar/connectors/SessionExportModal.tsx:108` | Export detail rows and shared shell | keep with reason | These remain part of the live exported-snapshot flow                             | Preserve                                  |

Verdict totals: **1 fix**, **1 keep with reason**, **0 abstract**. The fix is implemented; multi-site patterns count once.

Remove the two dead dialogs, legacy login host/atoms and obsolete docs. Specialize the live modal as SessionExportModal, remove import-only props, UI and persistence helpers, and keep export format/version and the working export flow unchanged. Preserve the live route-debug trigger and shared auth utilities.

This removes checked-in paths with no production trigger; out-of-tree consumers would need to migrate to the export-only component. Historical imported sessions are not deleted or rewritten. Existing export JSON retains format/version 1. Revert the commit to restore removed paths; no schema migration or destructive cleanup occurs. Native export was not exercised.

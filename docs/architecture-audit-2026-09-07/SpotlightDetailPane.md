# Spotlight detail panes architecture audit

Acceptance: one reusable pane, no hover IPC, two-row metadata without timestamps, structured multi-folder chips, row-aligned side positioning and centered placement below the complete footer.

| Layer          | Assessment                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------------- |
| 1 Compilation  | Typecheck and targeted tests run in the isolated branch; exact results in PR verification                           |
| 2 Structure    | Shared SpotlightDetailPane serves the generic row renderer and compact repo/workspace/branch/path peers             |
| 3 Naming       | detailFolders describes typed folder members; anchorSelector identifies the enclosing surface                       |
| 4 Semantics    | Row bounds determine side-pane vertical alignment; panel bounds determine horizontal clearance and footer placement |
| 5 Defaults     | Existing session-card placements remain unchanged; right-or-bottom and outer panel classes are opt-in               |
| 6 Boundaries   | Domain metadata stays in Spotlight; the generic hover primitive owns only geometry and lifecycle                    |
| 7 Readability  | Pure sidePanePlacement helper owns geometry; structured members replace a primary-path-only preview                 |
| 8 Wire         | Skipped: no backend, IPC, persistence, or schema change                                                             |
| 9 Entry parity | Both multi-folder producers supply folder names and paths; shared and compact rows use the same pane                |
| 10 Resolution  | Explicit metadata builds concise summaries; branch time-bearing descriptions/right labels are not used              |

The previous pane used whole-panel vertical bounds, making its position static. A separate square scroller clipped the rounded inner card shadow. The new outer surface owns clipping and decoration; trigger and panel geometry have separate roles.

No persisted data is modified. Reverting this PR restores prior hover behavior.

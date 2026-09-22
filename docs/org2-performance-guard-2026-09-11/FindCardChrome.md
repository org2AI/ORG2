# Find chrome lifecycle review

| Area                | Verdict | Evidence                                                             | Change or reason kept                                                                            | Verification                                               |
| ------------------- | ------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| Layout invalidation | keep    | Attribute-only observers on target ancestors and workbench flags     | No polling or subtree observation; observer disconnects on unregister                            | Maximize/restore, detached registration and disposal tests |
| Global shortcut     | fix     | Existing window listener resolves visible targets outside pane focus | Focused engine, active card, session, then standalone editor; listener removed with final target | Toolbar, terminal, hidden target and scope-cycle tests     |
| Overlay ownership   | keep    | Both engines anchor to the outer split-view surface                  | CodeMirror removes its overlay and unmounts its root on close                                    | Outer-anchor and cleanup tests                             |
| Pinned chrome       | fix     | Window-level controls yield while Find is active                     | Boolean external-store snapshot; layout reservation unchanged                                    | Session/file open, close and unregister tests              |

Performance verdict: bounded event-driven work with tested disposal. No runtime CPU improvement is claimed. Native visual and CPU measurements were not performed because computer control was not requested. Final isolated-branch verification is recorded in the pull request.

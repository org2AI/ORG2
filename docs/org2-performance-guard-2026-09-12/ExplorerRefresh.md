# Explorer refresh lifecycle review

Production path: CodeEditor state.refresh → EditorContent.onExplorerRefresh → CodeEditorDefaultHeader.onRefresh → FileHeader.onReload. The file-tree sidebar no longer owns a refresh spin hook. The underlying tree refresh implementation is unchanged.

| Area               | Verdict | Evidence                                                                                                                               | Change or reason kept                                                             | Verification                                            |
| ------------------ | ------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Background work    | keep    | FileHeader owns click-triggered cooldown; useRefreshSpin owns one animation frame and a 1200 ms completion timer, with unmount cleanup | Reuse the existing menu action; no new polling, listeners, or scan implementation | Source inspection; typecheck and lint passed            |
| Memory             | keep    | Existing spin persistence map capped at 200 entries                                                                                    | Supply repoPath so the default header's persistence key is repository scoped      | Source inspection                                       |
| Scope/isolation    | keep    | Callback and loading flag come from the same CodeEditor state instance                                                                 | Preserve loading guard and menu cooldown                                          | Source trace; existing menu suite passed (6 tests)      |
| Rendering/hot path | keep    | Adds callback/loading props; removes old header animation hook                                                                         | No new subscription or background computation                                     | Typecheck and lint passed; no runtime performance claim |

Lifecycle matrix: start/idle creates no refresh request; visible click uses the existing action; loading blocks further clicks; hidden state introduces no recurring work (a prior click's bounded completion timer may finish); unmount cancels owned animation frame and timers. Repository changes update the callback and persistence key. No auth, provider ingestion, network recovery, or sync logic changes.

Runtime measurements of visible/hidden idle and repeated mount/unmount were not run because computer control requires user opt-in. Static review found no additional recurring work. No CPU/RAM improvement is claimed.

Performance verdict: blocked for runtime measurement; implementation and static checks complete.

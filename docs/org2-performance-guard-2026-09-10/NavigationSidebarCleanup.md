# Navigation sidebar lifecycle review

| Area               | Verdict | Evidence                                                                                 | Change or reason kept                                                                         | Verification                                                                     |
| ------------------ | ------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Background work    | keep    | Reveal requestAnimationFrame retains cancellation on replacement and unmount             | One view setter replaces three; hydration and section reveal owners unchanged                 | New real-effect tests cover replacement, idle/no request, hydration and disposal |
| Memory             | keep    | Local view state is a finite union; diagnostic keeps its owner                           | Remove zero-tab field and unused context object; no growing structures or persistence changes | Source comparison; no memory-saving claim                                        |
| Scope/isolation    | keep    | Work-item enabled gate, local/cloud channel gates and org scope remain in the same hooks | Shared route mapping still unmounts inactive bodies                                           | Work-item, channel, org-switch and new route lifecycle tests pass                |
| Rendering/hot path | fix     | Multiple independently writable view fields represented mutually exclusive views         | One view key; no new subscription or polling owner                                            | Switcher, selection and routing suites pass; no runtime speed claim              |

| Lifecycle cell                                      | Evidence                                                                      |
| --------------------------------------------------- | ----------------------------------------------------------------------------- |
| Idle without reveal                                 | No animation frame or hydration scheduled                                     |
| Replaced reveal                                     | Only latest request applies view and organization                             |
| Unmount before frame                                | Frame cancelled; no queued view/org change                                    |
| Session → settings → standard                       | Each docked/hover path unmounts the previous body; no body on standard routes |
| Docked versus hover                                 | False/true visibility context retained through route changes                  |
| Work-item enabled/disabled and channel org switches | Existing surface/organization tests pass                                      |
| Native hidden/minimized/reopen CPU/RAM              | Not measured; no computer-control authorization                               |
| Provider ingestion and multi-instance transport     | Unchanged; no new compatibility claim                                         |

Performance verdict: **blocked** for native lifecycle measurements because computer control is not authorized. Typecheck, lint and automated lifecycle checks pass. The missing-jsqr errors were resolved by refreshing the already-locked local dependency installation. Native visible/hidden/post-close CPU/RAM cells remain unmeasured; no measured performance improvement is claimed.

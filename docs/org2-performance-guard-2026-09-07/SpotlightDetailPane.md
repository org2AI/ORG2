# Spotlight detail panes lifecycle review

| Area               | Verdict | Evidence                                                                                             | Change or reason kept                                                                     | Verification                             |
| ------------------ | ------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------- |
| Background work    | keep    | Existing delayed hover and close timers; one active pane                                             | No polling or hover IPC; hidden opening is suppressed                                     | Hover/unmount interaction tests          |
| Memory             | keep    | One active owner, anchor reference and geometry; visible row subscriptions                           | Reference cleared on dismissal; no added global result cache                              | Singleton and cleanup tests              |
| Scope/isolation    | keep    | Already-loaded local row metadata                                                                    | No cloud or provider identity cache                                                       | Source inspection                        |
| Rendering/hot path | keep    | One observer for active pane, row and panel, plus active-only resize/scroll/key/visibility listeners | All disconnected on close; inactive-trigger unmount does not cancel another owner's close | Resize, scroll, Escape and unmount tests |

Closed or hidden panes perform no repeated work. Multi-folder content reads existing workspace members; it does not scan folders or query Git. Keyboard focus support is opt-in with secondary placement.

Performance verdict: blocked — native visible/hidden CPU/RSS measurements and Tauri visual verification were not run. Desktop control requires explicit opt-in. Unit/interaction results support lifecycle correctness, not a measured runtime improvement.

# Start-page update removal performance guard

| Area               | Verdict | Evidence                                                  | Change or reason kept                                        | Verification                         |
| ------------------ | ------- | --------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------ |
| Background work    | keep    | Start page no longer calls useAvailableAppUpdate          | Removed duplicate update subscription; sidebar owner remains | Source inspection                    |
| Memory             | keep    | No update dismissal state or notice remains on start page | Removed component-local version state                        | Source inspection                    |
| Scope/isolation    | keep    | No new shared state or persistence                        | Sidebar and updater ownership unchanged                      | Diff inspection                      |
| Rendering/hot path | keep    | Utility builder returns three fixed actions               | No update condition, notice, filter or retained callback     | Focused start-page and utility tests |

Lifecycle: no update-specific work or state is created by the start page at mount, while active, idle or hidden, or across repeated open/close cycles. Network, identity and multi-instance handling are unchanged. No measured performance improvement is claimed. Desktop runtime validation was not run because computer control was not requested.

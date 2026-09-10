# Replay layout composition performance review

Verdict: pass for scoped composition change; no measured runtime gain claimed.

| Lifecycle                          | Evidence                                                                                                                                                                                               |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Active                             | Domain content, callbacks and panel props forwarded; no new work producer.                                                                                                                             |
| Event loading -> available         | Explicit eventWrapper object keeps wrapper presence stable; React DOM test verifies input node/draft survives and mount count stays one.                                                               |
| Hidden / collapsed / panel moves   | Existing WorkStationShell owns geometry and mounting; its implementation is unchanged. Lower shell is mocked in the new composition test, so native instance survival requires integration validation. |
| Empty -> populated diff            | Chrome-only and workstation branches intentionally remain distinct, matching prior behavior.                                                                                                           |
| Repeated open / multiple instances | No new timer, listener, shared cache or provider introduced; subtree unmount remains owned by existing callers.                                                                                        |

Do not infer reduced render cost from fewer lines or the memo wrapper. Existing callbacks/config objects may still change identity; runtime performance optimization is outside this PR.

# Modal lifecycle review

| Area               | Verdict | Evidence                                                             | Change or reason kept                                                       | Verification                           |
| ------------------ | ------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------- |
| Background work    | fix     | Legacy Login and import mode have no production opener               | Delete their unreachable OAuth/import work without touching shared services | Caller/writer sweep, full typecheck    |
| Memory             | keep    | Live export retains its existing preview state and cancellation flag | No new cache or resource owner                                              | Export loading/empty/save/cancel tests |
| Scope/isolation    | keep    | No persisted sessions are removed or rewritten                       | Delete only unreachable producing helper                                    | Diff review                            |
| Rendering/hot path | keep    | Export is the sole reachable mode                                    | Remove false-only login subscription and dead branch                        | Typecheck and modal tests              |

Lifecycle: no new work in app start/idle/hidden/active/closed states. Live export's preview cancellation cleanup remains unchanged. No network/account/instance policy changes. Historical data is preserved.

Performance verdict: pass for code retirement with unchanged live lifecycle, supported by caller review and automated tests. No CPU/RSS improvement is claimed.

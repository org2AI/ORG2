# Usage range lifecycle review

| Area            | Verdict | Evidence                                                         | Change or reason kept                                                                   | Verification                                         |
| --------------- | ------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Background work | keep    | No new timers, subscriptions, workers or scans                   | Dropdown owns existing positioning/listener cleanup                                     | Source inspection; panel tests                       |
| Memory          | keep    | Two draft strings and one applied interval                       | Draft discarded on cancel/outside close/apply; state released on unmount                | Panel apply/cancel test                              |
| Scope/isolation | keep    | Applied bounds join existing bucket/session scope and query keys | Existing generation guards reject stale responses; range change resets round pagination | Panel stale-response and API argument assertions     |
| Requests        | keep    | Draft edits remain inside picker                                 | Only Apply/preset changes parent query; existing deferred trend/round loading retained  | Panel test asserts no calls while editing/cancelling |

Lifecycle matrix: visible active editing creates no queries until Apply; idle/hidden introduce no new recurring work; repeated close clears draft; unmount retains request-generation invalidation. Offline/retry, authentication, account/endpoint switching, cloud sharing, ingestion and multi-instance ownership are unchanged.

Performance verdict: source and automated lifecycle checks pass; no CPU/RSS improvement is claimed. Real desktop visible/hidden measurement and native UI verification were not run because computer control was not authorized.

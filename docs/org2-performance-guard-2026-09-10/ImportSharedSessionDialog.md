# ImportSharedSessionDialog lifecycle review

| Area               | Verdict | Evidence                                     | Change or reason kept                              | Verification                           |
| ------------------ | ------- | -------------------------------------------- | -------------------------------------------------- | -------------------------------------- |
| Background work    | keep    | Submission uses existing pending-share queue | No new network, timers or subscriptions            | Queue tests and source trace           |
| Memory             | keep    | One overlay flag and form input state        | Close resets state; embedded form unmounts on back | Dialog tests and overlay source review |
| Scope/isolation    | keep    | Existing queue remains authoritative         | No identity/cache or transport changes             | Pending-share tests                    |
| Rendering/hot path | keep    | Form exists only for active import layer     | Embedded form avoids a second shell                | Embedded component test                |

Lifecycle matrix: closed has no embedded form; open enables the selected layer; back restores parent selection; close clears overlay state; submit parses and queues via the existing import boundary. No new work depends on visibility, offline/reconnect, provider or instance topology. Existing cloud resolve/import network behavior is unchanged and was not exercised against a live account.

Performance verdict: blocked for native overlay/listener and visible/hidden CPU/RSS measurement because computer control is not authorized. Twelve focused tests and full frontend typecheck passed. No measured performance improvement is claimed.

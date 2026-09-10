# ManualSpotlightCreator lifecycle review

| Area               | Verdict | Evidence                                           | Change or reason kept                                             | Verification                                   |
| ------------------ | ------- | -------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------- |
| Background work    | keep    | Host lazy-loads on a non-null request              | Child forms unmount on dismissal; existing overlay owns listeners | Three open/close cycles in host test           |
| Memory             | keep    | Two fixed manual draft IDs in existing capped maps | Drafts survive dismissal without sharing Agent keys               | Draft isolation test and map source inspection |
| Scope/isolation    | keep    | Organization context travels in request            | Late completion cannot navigate after unmount                     | Completion and routing tests                   |
| Rendering/hot path | keep    | Host observes request and Spotlight visibility     | No new polling or streaming loops                                 | Source review and host test                    |

Lifecycle matrix: closed/start/idle has no manual form; open mounts one form; dismiss and reopening regular Spotlight remove it; repeated cycles remain bounded; late completion does not navigate. Visible/hidden documents use existing form resources with no new recurring task. Network and identity behavior of existing create APIs is unchanged; account/endpoint switching while a form is open was not exercised. Draft payload shape is unchanged, with two additional fixed keys.

Performance verdict: blocked for native visible/hidden idle CPU/RSS and account-switch measurements because computer control is not authorized. Automated lifecycle tests and full frontend typecheck passed. No measured performance improvement is claimed.

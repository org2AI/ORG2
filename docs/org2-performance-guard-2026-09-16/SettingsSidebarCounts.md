# Settings sidebar counts lifecycle review

| Area               | Verdict | Evidence                                        | Change or reason kept                                                                  | Verification                                |
| ------------------ | ------- | ----------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------- |
| Background work    | keep    | No timers, listeners, requests or effects       | Counts derive synchronously from existing update/mock atoms                            | Source inspection                           |
| Memory             | keep    | Two module-level derived scalar atoms           | Fixed bound; no collections or retained session data                                   | Source inspection                           |
| Scope/isolation    | keep    | Existing Jotai store remains authoritative      | No persistence; dev count follows build-gated mock state                               | Production navigation tests                 |
| Rendering/hot path | keep    | Each badge subscribes only to its numeric count | Version changes that leave count unchanged do not rerender the sidebar navigation tree | Derived atom inspection and component tests |

App startup/idle: zero renders nothing. Active toggle/update change: push-driven invalidation. Hidden/offline: no new work. Unmount: React removes badge subscriptions. Remount: current store state is read. No account, network, provider or multi-instance resources are introduced.

Performance verdict: pass for bounded reactive counts and absence of background resources. No runtime CPU/RSS improvement is claimed. Native visual checks were not run because computer control was not authorized.

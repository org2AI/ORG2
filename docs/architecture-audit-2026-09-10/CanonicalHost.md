# CanonicalHost architecture audit

The authoritative source is the active tab in workstationTabsStateAtom, projected through activeWorkStationTabAtom and activeHostAtom. Previously AppShell copied the host into mutable activeStatusBarAppAtom in an effect, allowing consumers to observe stale chrome until that effect ran. The status-bar selector now derives synchronously from activeHostAtom; no second writer exists. Host visibility uses the existing isCodeMode/isBrowserMode/isProjectMode values directly.

The data status/chrome slot has no tab host, publisher, or production writer. Remove it from the status type, maps, and shared-panel callback registration. Keep simulator and workManagement header slots: they have independent live consumers. There is no persisted status-host state or historical data remediation. Snapshot activeApp still emits code/browser/project; it now follows the selected tab without waiting for React.

Covered layers: 1 compilation; 2 duplicate state and dormant branches; 3 status selector comments; 4 content host versus simulator/header ownership; 5 empty pool falls back to code; 6 tabHost imports atoms directly rather than the factory barrel; 7 one source of host selection; 8 snapshot shape and existing emitted values unchanged; 9 selection works before AppShell mounts; 10 status, callbacks and header use the same host. Rust, provider adapters and cloud protocols are out of scope.

Regression coverage: synchronous code/browser/project/start transitions across status/callback/header selectors; last-tab removal; independent stores. Existing rendered header, bottom-panel control and host-mount-policy tests cover retained behavior. See PR Verification for command outcomes.

## Lifecycle and performance guard

| Area               | Verdict | Evidence                                      | Change or reason kept                                                         | Verification                                |
| ------------------ | ------- | --------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------- |
| Background work    | fix     | AppShell effect was sole mutable host writer  | Remove effect; derived atom has no timer, request, worker or async completion | Synchronous store-transition regression     |
| Memory             | keep    | Fixed per-host maps; no new cache or queue    | Three live slots; existing host retention policy unchanged                    | Host mount-policy suite                     |
| Scope/isolation    | keep    | Selector reads the current store's active tab | No global mutable host mirror                                                 | Independent-store regression                |
| Rendering/hot path | fix     | Chrome subscribes to host projection          | Derive host without a React effect                                            | Header render suite and selector regression |

Cold initialization and empty pool are covered by the code fallback; active switching by store transitions; close by clearing the pool; multiple stores by isolation coverage. Hidden/reopened host retention decisions are unchanged and covered by the existing pure mount-policy suite. No background resource was added. Native visible-idle, hidden-idle, CPU/RSS and repeated UI open/close measurements were not run because desktop control is not authorized. No runtime performance improvement is claimed.

Performance verdict: blocked for native lifecycle measurement; source and automated invariant coverage are provided. This limitation is disclosed in the PR.

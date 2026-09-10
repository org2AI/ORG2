# WorkstationCloseOwnership

Retire the unused navigation, reorder, bulk-close and tab-bar contract from `useWorkStationTabs`. Its live programmatic removal now delegates to `closeWorkstationTabAtom` with the workspace key captured by the hook. Project deletion callbacks keep removal semantics without adding deleted content to recents. The project close control uses the existing `useCloseTabWithGuard`, including confirmation and registry-owned recent history, instead of maintaining a second prompt/projection mutation.

The authoritative source is `workstationTabsStateAtom`; `workstationLayoutAtom` is a compatibility projection. The prior hook used that projection to remove a tab, bypassing canonical resource deletion. The existing canonical store action removes Browser/Terminal resource records and persists the result. Host teardown remains owned by the existing resource owners. No new timer, listener, worker or teardown implementation is introduced.

Architecture layers 1–7: typecheck, real hook/store tests, removed duplicate mutation paths and unused contracts, named programmatic removal, existing close guards retained. Layer 8: persistence schema unchanged; tests read back resource storage. Layer 9: user dismissal and programmatic removal deliberately have different recent-history semantics; both use canonical close actions. Layer 10: captured session key prevents delayed programmatic removal from targeting the newly selected workspace. Rust/session resolver internals are outside scope.

Tests cover cancelled and confirmed dirty dismissal, recent history, deletion exclusion, Browser/Terminal record removal, repeated removal, and a delayed callback after session switching. No historical data cleanup is performed. Source revert restores the old hook behavior; resources intentionally closed during normal use must be reopened normally.

## Lifecycle evidence

| Area               | Verdict | Evidence                                                                  | Change or reason kept                               | Verification                                             |
| ------------------ | ------- | ------------------------------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------- |
| Background work    | keep    | Existing Browser/Terminal owners react to canonical resource records      | No extra polling or teardown owner                  | Store removal tests; native PTY/webview teardown not run |
| Memory             | fix     | Projection removal previously left global resource records                | Delegate to existing explicit close atom            | Browser/Terminal record and idempotence tests            |
| Scope/isolation    | keep    | Hook captures presented workspace key                                     | Delayed callback remains scoped to original session | Same-ID tabs across two session workspaces               |
| Rendering/hot path | keep    | Existing guarded close hook reads registry; no streaming or timer changes | Removed unused callbacks; no measured speed claim   | Real React hook tests and typecheck                      |

Lifecycle matrix: active removal and repeat removal tested; session switching tested; unmount performed by each hook test. Idle/hidden/focus-return behavior does not acquire new work. Network, auth, endpoint and external-provider transitions are unchanged. Native startup/shutdown and process counts were not measured because computer control was not authorized.

Performance verdict: blocked for native PTY/webview teardown and CPU/RSS measurement. State-level removal and session-isolation checks pass; no native performance claim is made. This limitation is disclosed rather than blocking the authorized PR delivery.

No JSX structure or styling changes; the frontend skill excludes type/control-flow work. Prompt behavior is tested with a mocked native dialog.

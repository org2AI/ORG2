# Shared hover card lifecycle review

| Area            | Verdict | Evidence                                                                     | Change or reason kept                                                              | Verification                                                   |
| --------------- | ------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Background work | keep    | Existing base owns delayed entry/exit and portal cleanup.                    | Wrapper adds no timers or requests; diary commit previews join existing singleton. | Action-dismissal and diary adapter tests.                      |
| Memory          | keep    | Only active content mounts; no new cache/registry.                           | Existing instance ownership retained.                                              | Deferred mounting, singleton replacement and missing-ID tests. |
| Scope/isolation | keep    | Domain IDs stay in adapters; portal selection uses instance ID.              | No data fetching moved into shared components.                                     | Current-prop update and cross-type replacement tests.          |
| Rendering       | keep    | Shared row/token components consume props; session loading remains deferred. | No eager Git/session queries.                                                      | Static import boundary and session lifecycle tests.            |

Lifecycle: closed content remains unmounted; entry starts the existing one-shot timer; click/unmount cancels pending entry; replacement releases old content; only the active portal owns its observer. Stash uses established PR right-start placement, avoiding the overflow clipping of secondary-pane placement. Existing placement-specific visibility behavior is unchanged. Auth, network, provider ingestion and multi-machine state are not modified.

Performance verdict: blocked for real-app measurements. Computer control is not authorized; live visible/hidden CPU/RSS, nested diary-menu pointer traversal and repeated live open/close checks were not run. No runtime improvement is claimed. Automated evidence and exact commands are recorded in the PR.

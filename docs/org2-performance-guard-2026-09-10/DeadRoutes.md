# Dead routes performance guard

| Area               | Verdict | Evidence                                                                                                                    | Change or reason kept                                 | Verification                         |
| ------------------ | ------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------ |
| Background work    | keep    | HoverSidebar timers are event-driven and cleared on unmount; route exception removal does not change callbacks or ownership | Preserved; removed pages cannot mount from the router | Source trace, targeted routing tests |
| Memory             | keep    | No cache, registry or buffer added; deleted test UI owned its local log/summary                                             | Remove exclusive pages only                           | Typecheck and caller sweep           |
| Scope/isolation    | keep    | No auth, endpoint, org or session identity mutation changed                                                                 | Native/mobile/OAuth routes kept                       | AuthGuard and router tests           |
| Rendering/hot path | keep    | Removed HoverSidebar's location subscription; remaining Jotai subscriptions and markup retained                             | No new active or idle work                            | Lint, typecheck, diff inspection     |

Lifecycle matrix: startup/direct URL/reopen cannot instantiate deleted pages. Active/idle/hidden/focus-return sidebar timer behavior is unchanged for retained routes; unmount still clears timers. Network/identity/org/session/source/transport behavior is unchanged. No new per-instance resources. No cache/coalescing/stale-result algorithm changed, so those tests are inapplicable.

Performance verdict: pass for the deletion-only resource delta, based on source ownership and tests. CPU/RSS, visual/hidden runtime and multi-instance measurements were not run; no measured performance improvement is claimed.

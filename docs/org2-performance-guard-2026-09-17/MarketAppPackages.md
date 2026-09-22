# Market App Packages resource review

| Area               | Verdict | Evidence                                                                                                                               | Change or reason kept                                      | Verification                                                                                                             |
| ------------------ | ------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Background work    | keep    | Catalog configuration is user initiated; metadata subprocess is bounded to 15 seconds/4 MiB and kill-on-drop; no added polling         | Reuse existing proxy lifecycle and authorization barrier   | Native close/restart measurements pending                                                                                |
| Memory             | keep    | Catalog bounds: 8 purchases, 64 models, 64 KiB; existing source bounds: 32 authorization connections and 32 credentials per connection | Metadata-only catalogs delegate to shared credential cache | Catalog bounds and cache refresh unit coverage                                                                           |
| Scope/isolation    | fix     | Alias resolves purchase/model/credential together; authorization replacement waits for readers and clears shared cache                 | Preserve one source owner and no extra token persistence   | Same-model distinct-Package HTTP route test; reauthorization/refresh tests; final native identity/revocation run pending |
| Rendering/hot path | keep    | Existing demand-loaded shared profile fetch/cache; local selection state; no new subscription/timer                                    | Shared controls and bounded catalog generation             | Focused UI and typecheck; actual native visible/hidden measurements pending                                              |

| Runtime cell                                         | Observed evidence                                                                                                                                                                                                                                 |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Configuration transaction and external edit          | Isolated filesystem tests cover original backup, unexpected edit refusal, switch away and restoration                                                                                                                                             |
| Alias and credential resolution                      | Loopback HTTP test verifies actual request model, destination and matching synthetic authentication                                                                                                                                               |
| Native visible idle / after Hide command, signed out | Main process sample: 0.0% CPU / 133536 KiB RSS visible, 0.0% / 139984 KiB after Hide command. AX did not independently confirm visibility; no active Package/proxy workload was present. These are samples, not a sustained performance benchmark |
| Native active request / continuation / restart       | Not run for final multi-Package binary                                                                                                                                                                                                            |
| Native post-close resources / identity switch        | Quit confirmed through native UI; exact Instance 89 process absent afterward. Identity switch with active Package credentials not run                                                                                                             |

Performance verdict: blocked. Required native measurements and provider calls have not run; native enrollment is waiting for the Cloud OAuth continuation repair. Compilation, metadata readback and unit tests are not evidence that native runtime or billing acceptance passed.

## Background enrollment continuation

The new path creates one foreground HTTP request (15-second deadline) and one
narrow auth-atom subscription per enrollment. It uses the existing single busy
operation and bounded 32-state callback deduplication set, adds no polling,
background retry, cache, process or file scan, and disposes the subscription on
success or failure. Identity invalidation aborts the request and cancels the
pending native proof; returning to the old identity cannot revive it. A normal
token refresh within the same identity remains valid. Hidden/visible transitions
do not launch work; an already requested authentication operation may finish
while hidden. Tests cover stale responses, failures, disposed subscriptions,
repeated callbacks and synchronous login completion. Real native lifecycle and
one-handoff UI measurements remain separate acceptance work.

## Native picker and retained source metadata

The native picker reuses the existing demand-loaded Market catalog cache and
in-flight sharing; no new poll, timer or scan is added. A profiles-changed event
invalidates the shared cache even while the picker is closed, without issuing a
closed-picker network request. Reopening performs a fresh read; subsequent opens
reuse the bounded cache. A rendered-hook regression first reproduced the stale
closed-picker state, then verified refresh and reuse after the fix.

Duplicate titles receive stable non-identifying ordinals while purchase IDs remain
the routing identity. The canonical composer reads the exact source's local recent
metadata through a scoped atom selector and retains the generic Market fallback
when history is absent. This projection adds no catalog fetch or retained token.
Native visible/hidden/close measurements on the final SDE execution build remain
pending; unit and type evidence do not establish a runtime performance result.

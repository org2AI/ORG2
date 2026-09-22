# Mobile session identity confirmation

## Outcome and ownership

Native sessions and non-Codex imported sessions open without `session/resolve`. Codex App mirrors still resolve to a persisted managed owner when present. Legacy Desktop preparation runs on successful roster discovery/refresh; modern Desktop keeps `session/open`. No persisted records, permissions, or wire schemas change.

The authoritative mapping remains `session_identity.rs::resolve_from_conn`: imported-history source/session ID → current native transcript binding + native code session. It only remaps Codex App sources. The phone's preparation predicate already selected that provider, but the route hook resolved every ID. Additionally, transport list-change invalidation cleared the identity cache while a one-shot WeakSet permanently disabled subsequent preparation.

The fix shares the Codex eligibility predicate at both entry points and replaces the one-shot marker with a bounded, client-owned preparation coordinator. There is no historical data pollution or cleanup.

Parallel review found a second retained-state boundary: a mounted hook could keep a successful unresolved mirror after the shared cache was invalidated. The hook now subscribes to the client cache generation via `useSyncExternalStore`; an online imported route rejects obsolete generations and reuses the shared lookup. Successful mounted results also require a fresh cache entry on subsequent renders. Offline history stays readable, and a route already canonicalized to a native ID stays fixed. The subscription is disposed on unmount/client change/canonical navigation; there are no new transport listeners or timers.

## Lifecycle

| Event/state                       | Policy                                                                                                                           |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Native/non-Codex open             | Mount chat immediately without a confirmation RPC; existing permission gates apply                                               |
| Codex discovery/refresh           | Prepare up to 8 distinct IDs; list publication does not wait                                                                     |
| Ready cached mirror open          | Reuse validated identity; subscribe/send/model use the same owner                                                                |
| Pending mirror open               | Join the existing promise; confirmation gate remains until owner is known                                                        |
| Failure/ambiguous/malformed owner | Do not enable writes; existing explicit retry/reconnect remains                                                                  |
| New roster during preparation     | Retain only the latest queued batch; at most 2 workers                                                                           |
| List invalidation/offline/close   | Generation guard invalidates/aborts flights; mounted imported views observe invalidation; late responses cannot repopulate cache |
| New roster after invalidation     | Permit preparation again, subject to the client budget                                                                           |
| Repeated invalidations            | At most 16 speculative attempts per fixed 15-second window; no scheduled retry                                                   |
| Hidden/stale scope                | Caller predicate prevents new queued work; later visible roster can prepare again                                                |
| TTL                               | Five-minute cached results expire lazily; next roster can prepare again and the next imported-route render revalidates           |
| Client/account/endpoint switch    | WeakMap is keyed by authenticated RPC client; no cross-client cache                                                              |

Budget exhaustion, more than 8 eligible rows, an expired cache with no subsequent roster event, and an immediately opened cold mirror can still require an on-demand confirmation. This is deliberately retained for correct write routing. This patch does not claim every mirror can always open instantly.

## Architecture checklist

| Layer                     | Verdict / evidence                                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 1 Compilation             | TypeScript and scoped ESLint pass; no Rust changes                                                                              |
| 2 Ownership/deduplication | One shared provider predicate, one preparation coordinator and invalidation generation per client                               |
| 3 Naming                  | `needsMobileSessionIdentityResolution` identifies remapping eligibility                                                         |
| 4 Semantics               | Identity remapping is separate from authentication, permissions, and transcript loading                                         |
| 5 Defaults                | Non-Codex IDs stay unchanged, matching current server adapter; unresolved Codex fails closed                                    |
| 6 Boundaries              | Provider policy stays in MobileRemote compatibility path; no shared domain mutation                                             |
| 7 Clarity                 | One-shot behavior removed and bounded refresh/retry policy documented in code                                                   |
| 8 Wire                    | Existing `session/resolve` request/response unchanged; WebSocket test inspects serialized request and invalidation notification |
| 9 Entry parity            | Prefetch and route gate share predicate; modern `session/open` remains unchanged                                                |
| 10 Resolver symmetry      | Same validated result carries sessionId and managed flag; canonical navigation preserves managed state                          |

## Performance audit

| Area               | Verdict | Evidence                                            | Change or reason kept                                                         | Verification                                            |
| ------------------ | ------- | --------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------- |
| Background work    | fix     | One-shot preparation failed after list invalidation | Event-driven coordinator; no timer/polling; 2 workers and fixed-window budget | Refresh, coalescing, budget, hidden/stale tests         |
| Memory             | keep    | WeakMap client scope, cache cap 32, pending cap 8   | Queued batch cap 8; only latest snapshot retained; mounted subscriber cleanup | Bounds, expiry, supersession, unsubscribe tests         |
| Scope/isolation    | keep    | Client identity and invalidation generation         | No persistent cache; existing abort/reject behavior retained                  | Client isolation, recovery, stale-response tests        |
| Rendering/hot path | fix     | Legacy gate unnecessarily blocked all providers     | Skip RPC at hook request-producing boundary                                   | Parent screen tests for native, Claude, Cursor, mirrors |

| Provider                 | Raw transition                                         | App/UI state                                                | Topology/boundary                               | Expected invariant                                          | Observed evidence                                                    |
| ------------------------ | ------------------------------------------------------ | ----------------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------- |
| Codex App                | No ingestion changes; native binding adapter inspected | Roster refresh, invalidation, opening, canonical navigation | Phone cache, mock WebSocket and rendered parent | Valid owner shared across actions; stale owner rejected     | Automated regression passes                                          |
| Native / Claude / Cursor | No ingestion changes                                   | Open legacy-capable Desktop session                         | Rendered parent and request-producing hook      | No redundant resolve request; read-only permission retained | Automated regression passes                                          |
| Actual connected Desktop | Existing roster                                        | Real iOS App restarted                                      | Simulator + dev frontend                        | Verify tapping screenshot session skips gate                | List visible; click tool fails with `noWindowsAvailable`; unverified |

Performance verdict: blocked for live interaction/CPU/RSS measurements because simulator click automation fails. Bounded work, cache isolation, and no-idle-timer invariants have automated coverage. No raw provider ingestion, multi-device, or production release validation claimed.

## Verification

- `pnpm test src/modules/MobileRemote/connection/mobileSessionIdentityCache.test.ts src/modules/MobileRemote/screens/SessionChatScreen.test.ts src/modules/MobileRemote/app/MobileRemoteProviders.test.ts src/modules/MobileRemote/connection/mobileRpcClient.test.ts src/modules/MobileRemote/app/useMobileSessionList.test.ts src/modules/MobileRemote/app/useMobileSessionIdentity.test.ts`
- `pnpm exec tsc --noEmit --pretty false`
- Scoped `pnpm exec eslint` for modified identity implementation and regression tests, `--max-warnings 0`
- Prettier and `git diff --check`
- Development webpack compilation succeeded; real iOS app relaunched and roster visually confirmed

No action controls added or changed in this patch; no new raw button/input sites. Prior unrelated working changes are preserved. The pull request isolates only the identity preparation changes.

## Parallel review follow-up

Three agents separately reviewed identity semantics, preparation lifecycle, and independent hook regression coverage. The retained mounted identity issue was reproduced as a failing test before the generation subscription fix. The independent suite covers invalidation without a parent rerender, TTL on next render without polling, route/client stale responses, offline recovery, canonical pinning, and explicit retry. Parent screen coverage additionally proves an invalidated imported view unsubscribes before switching to the new owner.

## Pull request isolation verification (2026-09-17)

The final identity patch was reapplied to current `origin/develop` in an isolated worktree. The six targeted test files above pass: 155 tests. Scoped ESLint with `--max-warnings 0`, Prettier, and `git diff --check` pass. This excludes the unrelated selected-round timing regression and all mobile appearance changes. Prior simulator observations above are historical; live connection interaction and CPU/RSS measurements were not repeated on this isolated branch.

# PR #850 integration review

## Acceptance criteria

Preserve the browser viewer absent from develop; resolve conflicts without restoring removed desktop code; preserve current lazy transcript loading, header geometry, auth-generation checks and organization identity ownership. Reduce unreachable browser code, validate owning boundaries, and disclose live verification gaps.

## Ten-layer review

| Layer | Result |
| --- | --- |
| Compilation | Update relocated layout/FileHeader/scheduling imports, current Button/RouterProvider/ChatPanelShell APIs, and removed simulator props. Run typecheck and production browser build. |
| Dead code and duplication | Browser notes had two read-only callers but retained a full mutation/composer implementation. Remove unreachable edit/reply/agent dispatch code and callback props. Keep one credential-generation predicate for refresh, rejection and profile enrichment. Remove the unused `isExploring` transcript contract. Reuse the current reload hook so eviction is awaited and navigation/failure guards survive integration. Remove the redundant 396-line i18n call checker in favor of the canonical checker, which understands fallback namespaces. Browser route callbacks share a small navigation hook that owns asynchronous router rejection handling, including parent-session breadcrumbs. Preserve develop's removed hosted-URL wrappers and legacy time formatters. |
| Naming | Notes remain `CommentThreadList`, now explicitly documented as read-only. Browser and desktop transcript adapters retain the same contract. |
| Semantic overloading | Auth identity means endpoint/account; credential generation additionally compares client configuration, tokens and expiry. Neither is interchangeable with organization selection or request epoch. |
| Defaults | Desktop simulator props default to native controls; browser explicitly owns replay and disables native subagents/composer. Read-only notes expose no mutation callbacks. |
| Boundaries | Move browser platform adaptation into the lazy `ChatHistory.tsx` implementation, leaving develop's lightweight entry intact. Browser routes write canonical organization selection; the authoritative membership projection derives Realtime scope. |
| Readability | Delete inactive editor/agent paths instead of retaining permission flags and no-op callbacks. Preserve shared chrome with an optional center-content slot for desktop Spotlight. |
| Wire | No backend/schema/IPC/dependency/lockfile changes relative to develop. Existing cloud RPCs and payload validators retained. Live authenticated requests not run. |
| Initialization | Desktop lazily initializes transcript/native registry; web uses its transcript adapter and bundled registry. Browser Realtime requires authenticated, confirmed membership before projecting scope. Test seeds through the real roster commit boundary. |
| Resolver symmetry | One strict generation comparison protects successful refresh, rejected refresh, profile writes and browser token resolution. Endpoint/account cache keys remain independent of token rotation. |

## Performance guard

| Area | Verdict | Evidence | Change or reason kept | Verification |
| --- | --- | --- | --- | --- |
| Background work | keep | `useCloudSessionEvents` owns one visible-only 30-second running-session safety poll; shared poller disposes on unmount | Retain push invalidation plus safety poll; retain visibility-aware bounded organization retries | Existing event and roster lifecycle unit tests |
| Memory | keep | IndexedDB snapshots capped at 12 sessions, 10,000 events per session and 24 hours | Cache deletion invalidates pending writes; opened histories still materialize in memory | Cache policy/storage/lifecycle unit tests |
| Scope/isolation | fix | Route attempted to write the now-derived active-org atom | Route writes canonical selector; membership/identity projection remains authoritative; consolidate credential CAS | Auth and route/roster integration tests |
| Rendering/hot path | keep | `ChatHistory/index.tsx` remains a lazy boundary; progress coalesced; old fetch completion guarded by generation/abort | Port adapter into lazy implementation; delete unreachable notes editor graph | Browser build, transcript/replay tests; no timing claim |

Visible/hidden polling, sign-out, account/endpoint switches, permission revocation, stale completion and cache invalidation have unit coverage. Live authenticated idle CPU/RSS, repeated open/close and cross-browser measurements were not run. Provider ingestion, raw-history transitions, dual-instance transport and Rust execution are outside this frontend integration's unchanged boundaries.

Performance verdict: blocked on live authenticated measurements. No measured speed or memory improvement is claimed.

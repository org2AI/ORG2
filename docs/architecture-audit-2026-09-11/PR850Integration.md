# PR850 integration architecture and lifecycle review

The repair preserves the browser cloud-session viewer while incorporating the current develop implementations. No Rust, domain persistence, public API, dependency, or lockfile change is introduced relative to the integrated base.

| Layer                | Coverage and outcome                                                                                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 Compilation        | Full frontend typecheck, lint, production web build, and affected tests are the integration gates; exact final results are recorded in the PR                                         |
| 2 Structure          | Use current direct imports after barrel removal; do not resurrect deleted desktop group-chat actions or onboarding layout; relocate tests to the owning directory's convention        |
| 3 Naming             | Use LoginCard, current header surface token, current replay control identifier, and current icon exports                                                                              |
| 4 Semantic ownership | Browser session search is a web adapter concern; transcript runtime and replay state retain their existing owners                                                                     |
| 5 Defaults           | Desktop sidebar chrome remains enabled and surface preferences remain effective by default; web explicitly disables native chrome and selects an opaque surface                       |
| 6 Boundaries         | Browser transcript adapter avoids desktop EventStore construction; desktop WebSocket connection creation remains in explicit desktop startup                                          |
| 7 Clarity            | Remove obsolete imports and preserve current shared component contracts instead of adding compatibility barrels                                                                       |
| 8 Wire               | Skipped new payload experiments: no wire/API change in the repair; hosted callback support remains a separate infra prerequisite                                                      |
| 9 Initialization     | Desktop startup explicitly initializes its WebSocket, including the test-mode E2E exception; Web initializes bundled tool rendering and has no desktop socket owner                   |
| 10 Resolution        | Preserve desktop pinned-chrome reservation and parent/member projection while retaining web transcript injection; keep develop translations and add only required missing viewer keys |

## Resource lifecycle

| Area               | Verdict | Evidence                                                                                              | Change or reason kept                                        | Verification                                               |
| ------------------ | ------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------- |
| Background work    | keep    | Open running-session owner uses a visible-only 30-second poll; request is single-flight and abortable | No timer or subscription added by conflict repair            | Cloud-event and Realtime-scope unit tests                  |
| Memory             | keep    | IndexedDB snapshots bounded to 12 sessions, 10,000 events each, 24 hours                              | Existing eviction and write-invalidation generation retained | Cache and cache-lifecycle unit tests                       |
| Scope/isolation    | keep    | Auth identity scopes cache keys; generation checks reject stale completions                           | Keep sign-out/account-switch cleanup above the auth router   | Cache policy and lifecycle tests                           |
| Rendering/hot path | keep    | Progress publication is throttled; browser transcript reads injected events                           | Keep desktop atom construction out of browser selector       | ChatContext and remote-surface tests                       |
| Search             | fix     | Removed desktop search API no longer supplies browser filtering                                       | Web-owned memoized tree filter; no recurring work            | Descendant, empty-result, and clear-query regression tests |

Native instances/provider ingestion are outside this repair. No claims are made for their runtime behavior. Visible/hidden authenticated browser CPU/RSS, live network reconnect, and deployed auth/create/join were not measured; desktop Computer Use is not authorized. Full histories still materialize in memory while open, as documented in the PR.

Performance verdict: blocked for live authenticated measurements; source inspection and unit evidence cover the retained lifecycle invariants, but cannot establish a measured runtime performance verdict.

# StationCaption implementation review

## Acceptance and ownership

AppShell and AgentStationTopHeader each select the current caption and independently decide whether its row is visible.

AppShell selects the caption once and passes the message and its existing visibility decision to AgentStationTopHeader. The frame and header now use the same visibility result. Keep user, assistant and thought channel notices and caption-toggle behavior.

Acceptance: replace all matching in-scope callers, preserve user behavior and persistence, pass focused tests and frontend checks, and keep changes isolated from unrelated working-tree edits.

| Line                                                            | Element          | Verdict | Reason                                                                                                                                                                                                                                                         | Suggested change                                  |
| --------------------------------------------------------------- | ---------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `src/modules/WorkStation/AppShell/AgentStationTopHeader.tsx:55` | Shared ownership | fix     | AppShell selects the caption once and passes the message and its existing visibility decision to AgentStationTopHeader. The frame and header now use the same visibility result. Keep user, assistant and thought channel notices and caption-toggle behavior. | Implemented in this change; no unrelated cleanup. |

## Architecture coverage

Layers 1–7: frontend compilation/lint, caller sweep, naming, distinct station/host meanings, defaults, ownership boundaries, and readability reviewed. Layer 8: no serialized format, IPC or storage-key change; no real wire dump was needed for this internal refactor. Layer 9: existing station entry points retained and focused tests exercise changed ownership. Layer 10: preserve caller-specific visibility/selection policies rather than forcing false symmetry. Backend initialization and account/model resolvers are outside scope.

## Lifecycle and performance

| Area               | Verdict | Evidence                                       | Change or reason kept                                                                                                                                                                                                                                          | Verification                        |
| ------------------ | ------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Background work    | keep    | No new polling, listeners, workers or requests | Existing owner and mount/cleanup rules retained                                                                                                                                                                                                                | Focused suites below                |
| Memory             | keep    | No new app-lifetime collections or caches      | State stays with current atoms/components                                                                                                                                                                                                                      | Diff inspection; no RSS measurement |
| Scope/isolation    | keep    | Existing station and store boundaries          | No shared cross-account/session cache introduced                                                                                                                                                                                                               | Caller sweep                        |
| Rendering/hot path | fix     | Common computation/config/action ownership     | AppShell selects the caption once and passes the message and its existing visibility decision to AgentStationTopHeader. The frame and header now use the same visibility result. Keep user, assistant and thought channel notices and caption-toggle behavior. | Focused tests; no timing claim      |

Applicable matrix: mount/unmount and station/visibility transitions at changed UI boundaries; existing online/offline, identity, transport and multi-instance ownership is unchanged. No provider ingestion or sync changes. Native Tauri pixels/CPU/RSS were not measured: Computer Use was not authorized. Performance verdict: blocked for live native measurement; no performance improvement is claimed. Automated correctness evidence is listed separately.

## Risks

This PR is based on `dev/station-pane-controls` (PR #1567) because both changes edit the header. Merge that PR first, then retarget this PR to develop.

A mismatch in parent/header props could affect caption spacing or notices. A rendered AppShell test with the real header verifies one selector call and aligned visibility, plus all three channel notices. No replay cursor, event payload, persistence or native webview behavior changes. Native pixels and runtime timing were not profiled. Rollback is a normal commit revert; no data migration or recovery is required.

## Verification

- `pnpm run typecheck:fast` — passed.
- `pnpm exec eslint --max-warnings 0 src/modules/WorkStation/AppShell/AppShell.caption.test.ts src/modules/WorkStation/AppShell/AgentStationTopHeader.test.ts src/modules/WorkStation/AppShell/AgentStationTopHeader.tsx src/modules/WorkStation/AppShell/index.tsx` — passed with zero warnings.
- `pnpm exec vitest run --config config/vitest.config.ts src/modules/WorkStation/AppShell/AppShell.caption.test.ts src/modules/WorkStation/AppShell/AgentStationTopHeader.test.ts` — 2 files, 9 tests passed.
- `git diff --check` — passed.

Focused suites may emit existing Vite/Sass/Jotai/React Router deprecation notices. Full Rust builds and native UI/CPU/RSS checks were not run; no backend code changed. Tests do not substitute for native visual verification.

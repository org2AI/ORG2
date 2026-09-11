# ReplaySidebar implementation review

## Acceptance and ownership

Code, Browser, Diff and Canvas replay surfaces independently bind the same sidebar atoms and duplicate width limits and setter wrappers.

Use one useSimulatorReplaySidebar hook in all four owners. Memoize the shared config for their existing content memoization. Keep the same atom identities, width persistence, limits, reset values and station-specific preferences.

Acceptance: replace all matching in-scope callers, preserve user behavior and persistence, pass focused tests and frontend checks, and keep changes isolated from unrelated working-tree edits.

| Line                                                                           | Element          | Verdict | Reason                                                                                                                                                                                                                                | Suggested change                                  |
| ------------------------------------------------------------------------------ | ---------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `src/modules/WorkStation/shared/SessionReplay/useSimulatorReplaySidebar.ts:13` | Shared ownership | fix     | Use one useSimulatorReplaySidebar hook in all four owners. Memoize the shared config for their existing content memoization. Keep the same atom identities, width persistence, limits, reset values and station-specific preferences. | Implemented in this change; no unrelated cleanup. |

## Architecture coverage

Layers 1–7: frontend compilation/lint, caller sweep, naming, distinct station/host meanings, defaults, ownership boundaries, and readability reviewed. Layer 8: no serialized format, IPC or storage-key change; no real wire dump was needed for this internal refactor. Layer 9: existing station entry points retained and focused tests exercise changed ownership. Layer 10: preserve caller-specific visibility/selection policies rather than forcing false symmetry. Backend initialization and account/model resolvers are outside scope.

## Lifecycle and performance

| Area               | Verdict | Evidence                                       | Change or reason kept                                                                                                                                                                                                                 | Verification                        |
| ------------------ | ------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Background work    | keep    | No new polling, listeners, workers or requests | Existing owner and mount/cleanup rules retained                                                                                                                                                                                       | Focused suites below                |
| Memory             | keep    | No new app-lifetime collections or caches      | State stays with current atoms/components                                                                                                                                                                                             | Diff inspection; no RSS measurement |
| Scope/isolation    | keep    | Existing station and store boundaries          | No shared cross-account/session cache introduced                                                                                                                                                                                      | Caller sweep                        |
| Rendering/hot path | fix     | Common computation/config/action ownership     | Use one useSimulatorReplaySidebar hook in all four owners. Memoize the shared config for their existing content memoization. Keep the same atom identities, width persistence, limits, reset values and station-specific preferences. | Focused tests; no timing claim      |

Applicable matrix: mount/unmount and station/visibility transitions at changed UI boundaries; existing online/offline, identity, transport and multi-instance ownership is unchanged. No provider ingestion or sync changes. Native Tauri pixels/CPU/RSS were not measured: Computer Use was not authorized. Performance verdict: blocked for live native measurement; no performance improvement is claimed. Automated correctness evidence is listed separately.

## Risks

Replay sidebar configuration affects four surfaces. Shared-state, reset, collapse, independent workstation dimensions, stable config identity, Canvas lifecycle/share and replay config tests pass. No native webview geometry code or station-position synchronization changes. Native visual drag/resize was not exercised. Rollback is a normal commit revert; no data migration or recovery is required.

## Verification

- `pnpm run typecheck:fast` — passed.
- `pnpm exec eslint --max-warnings 0 src/modules/WorkStation/shared/SessionReplay/useSimulatorReplaySidebar.test.ts src/modules/WorkStation/shared/SessionReplay/useSimulatorReplaySidebar.ts src/engines/Simulator/apps/canvas/CanvasApp.tsx src/modules/WorkStation/Browser/SessionReplay/index.tsx src/modules/WorkStation/CodeEditor/SessionReplay/index.tsx src/modules/WorkStation/Diff/SessionReplay/index.tsx` — passed with zero warnings.
- `pnpm exec vitest run --config config/vitest.config.ts src/modules/WorkStation/shared/SessionReplay/useSimulatorReplaySidebar.test.ts src/modules/WorkStation/shared/SessionReplay/ReplayShellLayout.test.ts src/engines/Simulator/apps/canvas/CanvasApp.test.ts src/engines/Simulator/apps/canvas/CanvasApp.share.test.ts src/modules/WorkStation/Browser/SessionReplay/__tests__/config.test.ts src/modules/WorkStation/CodeEditor/SessionReplay/__tests__/config.test.ts src/modules/WorkStation/Diff/SessionReplay/__tests__/config.test.ts` — 7 files, 23 tests passed.
- `git diff --check` — passed.

Focused suites may emit existing Vite/Sass/Jotai/React Router deprecation notices. Full Rust builds and native UI/CPU/RSS checks were not run; no backend code changed. Tests do not substitute for native visual verification.

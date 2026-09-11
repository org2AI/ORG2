# StationPaneControls implementation review

## Acceptance and ownership

My Station, Agent Station and pinned window chrome repeat the same chat visibility and maximize actions and button presentation.

Share StationPaneControls and action callbacks across all three owners. Preserve each owner’s visibility gates, both pane restore affordances, Settings control, pinned availability, and the Agent header’s static directional icon.

Acceptance: replace all matching in-scope callers, preserve user behavior and persistence, pass focused tests and frontend checks, and keep changes isolated from unrelated working-tree edits.

| Line                                                        | Element          | Verdict | Reason                                                                                                                                                                                                                                | Suggested change                                  |
| ----------------------------------------------------------- | ---------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `src/modules/WorkStation/shared/StationPaneControls.tsx:21` | Shared ownership | fix     | Share StationPaneControls and action callbacks across all three owners. Preserve each owner’s visibility gates, both pane restore affordances, Settings control, pinned availability, and the Agent header’s static directional icon. | Implemented in this change; no unrelated cleanup. |

## Architecture coverage

Layers 1–7: frontend compilation/lint, caller sweep, naming, distinct station/host meanings, defaults, ownership boundaries, and readability reviewed. Layer 8: no serialized format, IPC or storage-key change; no real wire dump was needed for this internal refactor. Layer 9: existing station entry points retained and focused tests exercise changed ownership. Layer 10: preserve caller-specific visibility/selection policies rather than forcing false symmetry. Backend initialization and account/model resolvers are outside scope.

## Lifecycle and performance

| Area               | Verdict | Evidence                                       | Change or reason kept                                                                                                                                                                                                                 | Verification                        |
| ------------------ | ------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Background work    | keep    | No new polling, listeners, workers or requests | Existing owner and mount/cleanup rules retained                                                                                                                                                                                       | Focused suites below                |
| Memory             | keep    | No new app-lifetime collections or caches      | State stays with current atoms/components                                                                                                                                                                                             | Diff inspection; no RSS measurement |
| Scope/isolation    | keep    | Existing station and store boundaries          | No shared cross-account/session cache introduced                                                                                                                                                                                      | Caller sweep                        |
| Rendering/hot path | fix     | Common computation/config/action ownership     | Share StationPaneControls and action callbacks across all three owners. Preserve each owner’s visibility gates, both pane restore affordances, Settings control, pinned availability, and the Agent header’s static directional icon. | Focused tests; no timing claim      |

Applicable matrix: mount/unmount and station/visibility transitions at changed UI boundaries; existing online/offline, identity, transport and multi-instance ownership is unchanged. No provider ingestion or sync changes. Native Tauri pixels/CPU/RSS were not measured: Computer Use was not authorized. Performance verdict: blocked for live native measurement; no performance improvement is claimed. Automated correctness evidence is listed separately.

## Risks

The main risk is chrome availability or icon drift across station modes and chat positions. Existing rendered tests and added dispatch/icon coverage pass. No persistence, IPC, native webview, or lifecycle policy changes. Native visual screenshots were not collected; this is intended to preserve appearance. Rollback is a normal commit revert; no data migration or recovery is required.

## Verification

- `pnpm run typecheck:fast` — passed.
- `pnpm exec eslint --max-warnings 0 src/modules/WorkStation/shared/StationPaneControls.test.ts src/modules/WorkStation/shared/StationPaneControls.tsx src/modules/WorkStation/AppShell/AgentStationTopHeader.test.ts src/modules/WorkStation/AppShell/AgentStationTopHeader.tsx src/modules/WorkStation/AppShell/PinnedWorkbenchChrome.tsx src/modules/WorkStation/AppShell/useWorkstationTrailingSlot.tsx src/modules/WorkStation/AppShell/useWorkstationTrailingSlot.visibility.test.ts` — passed with zero warnings.
- `pnpm exec vitest run --config config/vitest.config.ts src/modules/WorkStation/AppShell/AgentStationTopHeader.test.ts src/modules/WorkStation/AppShell/useWorkstationTrailingSlot.visibility.test.ts src/modules/WorkStation/AppShell/PinnedWorkbenchChrome.test.ts src/modules/WorkStation/shared/StationPaneControls.test.ts` — 4 files, 23 tests passed.
- `git diff --check` — passed.

Focused suites may emit existing Vite/Sass/Jotai/React Router deprecation notices. Full Rust builds and native UI/CPU/RSS checks were not run; no backend code changed. Tests do not substitute for native visual verification.

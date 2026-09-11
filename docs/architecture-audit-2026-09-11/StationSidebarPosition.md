# StationSidebarPosition implementation review

## Acceptance and ownership

The sidebar synchronization hook accepts the entire workstation panel controller although it needs only layoutMode. The proposed removal of its gated mirror would change native webview invalidation timing.

Narrow the hook contract to layoutMode and retain its existing Agent Station gate and effect timing. Document why the mirror is intentional. Add tests using the real BrowserSessionWebview component and a mocked native boundary to protect geometry-update behavior.

Acceptance: replace all matching in-scope callers, preserve user behavior and persistence, pass focused tests and frontend checks, and keep changes isolated from unrelated working-tree edits.

| Line                                                                        | Element          | Verdict          | Reason                                                                                                                                                                                                                                                                  | Suggested change                                  |
| --------------------------------------------------------------------------- | ---------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `src/modules/WorkStation/AppShell/hooks/useAppShellSimulatorPanelSync.ts:8` | Shared ownership | keep with reason | Narrow the hook contract to layoutMode and retain its existing Agent Station gate and effect timing. Document why the mirror is intentional. Add tests using the real BrowserSessionWebview component and a mocked native boundary to protect geometry-update behavior. | Implemented in this change; no unrelated cleanup. |

## Architecture coverage

Layers 1–7: frontend compilation/lint, caller sweep, naming, distinct station/host meanings, defaults, ownership boundaries, and readability reviewed. Layer 8: no serialized format, IPC or storage-key change; no real wire dump was needed for this internal refactor. Layer 9: existing station entry points retained and focused tests exercise changed ownership. Layer 10: preserve caller-specific visibility/selection policies rather than forcing false symmetry. Backend initialization and account/model resolvers are outside scope.

## Lifecycle and performance

| Area               | Verdict | Evidence                                       | Change or reason kept                                                                                                                                                                                                                                                   | Verification                        |
| ------------------ | ------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Background work    | keep    | No new polling, listeners, workers or requests | Existing owner and mount/cleanup rules retained                                                                                                                                                                                                                         | Focused suites below                |
| Memory             | keep    | No new app-lifetime collections or caches      | State stays with current atoms/components                                                                                                                                                                                                                               | Diff inspection; no RSS measurement |
| Scope/isolation    | keep    | Existing station and store boundaries          | No shared cross-account/session cache introduced                                                                                                                                                                                                                        | Caller sweep                        |
| Rendering/hot path | fix     | Common computation/config/action ownership     | Narrow the hook contract to layoutMode and retain its existing Agent Station gate and effect timing. Document why the mirror is intentional. Add tests using the real BrowserSessionWebview component and a mocked native boundary to protect geometry-update behavior. | Focused tests; no timing claim      |

Applicable matrix: mount/unmount and station/visibility transitions at changed UI boundaries; existing online/offline, identity, transport and multi-instance ownership is unchanged. No provider ingestion or sync changes. Native Tauri pixels/CPU/RSS were not measured: Computer Use was not authorized. Performance verdict: blocked for live native measurement; no performance improvement is claimed. Automated correctness evidence is listed separately.

## Risks

The gated mirror is deliberately retained to meet the no-webview-impact requirement. Tests protect silence during My Station edits, four forced resize ticks at 0/50/100/170 ms for Agent Station changes, no duplicate ticks on unchanged renders, inactive-tab suppression and unmount cancellation. Actual WKWebView pixels were not exercised; no native/webview source was changed. Rollback is a normal commit revert; no data migration or recovery is required.

## Verification

- `pnpm run typecheck:fast` — passed.
- `pnpm exec eslint --max-warnings 0 src/modules/WorkStation/AppShell/hooks/useAppShellSimulatorPanelSync.test.ts src/modules/WorkStation/AppShell/hooks/useAppShellSimulatorPanelSync.ts src/modules/WorkStation/AppShell/index.tsx` — passed with zero warnings.
- `pnpm exec vitest run --config config/vitest.config.ts src/modules/WorkStation/AppShell/hooks/useAppShellSimulatorPanelSync.test.ts src/engines/BrowserCore/BrowserSessionWebview.test.ts src/modules/WorkStation/AppShell/hostMountPolicy.test.ts` — 3 files, 17 tests passed.
- `git diff --check` — passed.

Focused suites may emit existing Vite/Sass/Jotai/React Router deprecation notices. Full Rust builds and native UI/CPU/RSS checks were not run; no backend code changed. Tests do not substitute for native visual verification.

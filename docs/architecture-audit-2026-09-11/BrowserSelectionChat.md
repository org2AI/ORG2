# BrowserSelectionChat implementation review

## Acceptance and ownership

The live browser status bar and Agent Station browser repeat DOM payload construction, add-to-agent submission and success feedback wiring.

Route both owners through sendSelectedElementToChat. Keep the existing formatter and make selection clearing explicit: My Station retains selection and Agent Station clears it after submission, before the success toast.

Acceptance: replace all matching in-scope callers, preserve user behavior and persistence, pass focused tests and frontend checks, and keep changes isolated from unrelated working-tree edits.

| Line                                                                    | Element          | Verdict | Reason                                                                                                                                                                                                                      | Suggested change                                  |
| ----------------------------------------------------------------------- | ---------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `src/modules/WorkStation/Browser/shared/sendSelectedElementToChat.ts:7` | Shared ownership | fix     | Route both owners through sendSelectedElementToChat. Keep the existing formatter and make selection clearing explicit: My Station retains selection and Agent Station clears it after submission, before the success toast. | Implemented in this change; no unrelated cleanup. |

## Architecture coverage

Layers 1–7: frontend compilation/lint, caller sweep, naming, distinct station/host meanings, defaults, ownership boundaries, and readability reviewed. Layer 8: no serialized format, IPC or storage-key change; no real wire dump was needed for this internal refactor. Layer 9: existing station entry points retained and focused tests exercise changed ownership. Layer 10: preserve caller-specific visibility/selection policies rather than forcing false symmetry. Backend initialization and account/model resolvers are outside scope.

## Lifecycle and performance

| Area               | Verdict | Evidence                                       | Change or reason kept                                                                                                                                                                                                       | Verification                        |
| ------------------ | ------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Background work    | keep    | No new polling, listeners, workers or requests | Existing owner and mount/cleanup rules retained                                                                                                                                                                             | Focused suites below                |
| Memory             | keep    | No new app-lifetime collections or caches      | State stays with current atoms/components                                                                                                                                                                                   | Diff inspection; no RSS measurement |
| Scope/isolation    | keep    | Existing station and store boundaries          | No shared cross-account/session cache introduced                                                                                                                                                                            | Caller sweep                        |
| Rendering/hot path | fix     | Common computation/config/action ownership     | Route both owners through sendSelectedElementToChat. Keep the existing formatter and make selection clearing explicit: My Station retains selection and Agent Station clears it after submission, before the success toast. | Focused tests; no timing claim      |

Applicable matrix: mount/unmount and station/visibility transitions at changed UI boundaries; existing online/offline, identity, transport and multi-instance ownership is unchanged. No provider ingestion or sync changes. Native Tauri pixels/CPU/RSS were not measured: Computer Use was not authorized. Performance verdict: blocked for live native measurement; no performance improvement is claimed. Automated correctness evidence is listed separately.

## Risks

Selection-clearing and feedback order must remain intact. Tests cover missing selection, both retention policies, one payload submission with URL/selector/dimensions, and failure before cleanup/feedback. No storage, native inspector, IPC or webview lifecycle changes. Native browser interaction was not exercised. Rollback is a normal commit revert; no data migration or recovery is required.

## Verification

- `pnpm run typecheck:fast` — passed.
- `pnpm exec eslint --max-warnings 0 src/modules/WorkStation/Browser/shared/sendSelectedElementToChat.test.ts src/modules/WorkStation/Browser/shared/sendSelectedElementToChat.ts src/modules/WorkStation/Browser/BrowserLayout/useBrowserStatusBar.ts src/modules/WorkStation/Browser/SessionReplay/index.tsx` — passed with zero warnings.
- `pnpm exec vitest run --config config/vitest.config.ts src/modules/WorkStation/Browser/shared/sendSelectedElementToChat.test.ts src/modules/WorkStation/Browser/SessionReplay/__tests__/config.test.ts` — 2 files, 8 tests passed.
- `git diff --check` — passed.

Focused suites may emit existing Vite/Sass/Jotai/React Router deprecation notices. Full Rust builds and native UI/CPU/RSS checks were not run; no backend code changed. Tests do not substitute for native visual verification.

# SharedFileFeedback UI audit

| Line                                                                 | Element                                          | Verdict          | Reason                                                                                                                                    | Suggested change                                                                            |
| -------------------------------------------------------------------- | ------------------------------------------------ | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `SharedSessionFileLink.tsx:30`; `SharedSessionFilesContext.tsx:74`   | Lazy fallback at both attachment entry points    | fix              | A null fallback leaves real clicks without feedback; both entry points belong to this feature                                             | Use a closeable loading shell at both sites without changing global component configuration |
| `SharedSessionFileViewer.tsx:186`                                    | Error and recovery                               | fix              | A lookup with no record differs from a failed request; retry should not require closing/reopening                                         | Distinguish pending upload from read failure and retry in place                             |
| `SharedSessionFileDialog.tsx:9`                                      | Shared Modal shell for both fallbacks and Viewer | abstract         | Three sites need consistent title, close behavior, and loading semantics                                                                  | Extract a feature-local shell using ModalSystem                                             |
| `SharedSessionFileViewer.tsx:193`; `SharedSessionFileViewer.tsx:227` | Retry and download actions                       | keep with reason | Shared Button with default secondary/default presentation preserves keyboard, disabled, and loading behavior without local button styling | Keep                                                                                        |
| `SharedSessionFileLink.tsx:18`                                       | File link                                        | keep with reason | Native anchor retains href and keyboard link semantics; in-app preview does not introduce a clickable div/span                            | Keep                                                                                        |
| `SharedSessionFileViewer.tsx:207`                                    | Image/PDF/text preview                           | keep with reason | Existing bounded dimensions, theme tokens, safe text, and iframe sandbox fit this feedback change                                         | Keep without expanding preview scope                                                        |

Verdict totals: **2 fix**, **3 keep with reason**, **1 abstract**.

## Scope and implementation boundaries

Implements F9 immediate loading feedback and in-place retry. Discovery, automatic upload, file access protocol, and quotas are unchanged. Assistant Markdown and `[file:…]` artifacts still upload automatically. The server has no per-file outbox status, so a successful lookup without a record is shown as not uploaded yet; it cannot identify quota, sender offline, or lost source bytes. Other exceptions retain the read-error state. Full outbox status requires a subsequent server contract.

## Architecture and lifecycle

Relevant ten-layer coverage: 1 compilation/regressions; 2 three shell sites share one component; 3/4 distinguish missing record from request failure; 5/6 do not reinterpret missing records as permission/execution errors; 7 understandable and recoverable feedback; 8 no wire change; 9 both entry points behave alike; 10 retry preserves identity, endpoint, and capability checks. Unrelated Rust/provider internals and canonical transcripts are outside scope.

| Area               | Verdict | Evidence                                                                           | Change or reason kept                                                      | Verification                                                                      |
| ------------------ | ------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Background work    | keep    | One request effect per mount/explicit retry; cleanup aborts it                     | No new polling, automatic retries, scans, or background subscriptions      | Rendered tests assert old signal abort on retry and current signal abort on close |
| Memory             | keep    | Only current file, error enum, and retry count retained; existing Blob URL cleanup | No app-lifetime cache; preview loads on demand                             | Source review; real RSS not measured                                              |
| Scope/isolation    | fix     | Catch and success share stillCurrent validation                                    | Stale identity/endpoint/capability errors cannot overwrite current results | Delayed old-capability rejection preserves current result                         |
| Rendering/hot path | fix     | Both Suspense entry points share a synchronous loading shell                       | Viewer stays lazy; unopened files are not read                             | Suspend actual dynamic import, click, assert loading/close at both entry points   |

Lifecycle: unopened means no file request; active mounts issue one request; close/unmount aborts; retry is user initiated; identity/endpoint/capability changes preserve guards. No new hidden/visible work or timers; source resolution, upload, secondary instances, and provider adapters are unchanged. Component tests are not desktop, multi-machine, or cross-provider acceptance.

## Verification

- `pnpm exec vitest run --config config/vitest.config.ts src/features/Org2Cloud/SharedSessionFileDialog.test.ts src/features/Org2Cloud/SharedSessionFileViewer.test.ts src/features/Org2Cloud/sharedSessionFilesClient.test.ts src/features/Org2Cloud/downloadSharedSessionFile.test.ts`: 4 files / 37 tests passed.
- `pnpm typecheck:fast`: passed.
- `pnpm exec eslint src/features/Org2Cloud/SharedSessionFileDialog.tsx src/features/Org2Cloud/SharedSessionFileDialog.test.ts src/features/Org2Cloud/SharedSessionFileLink.tsx src/features/Org2Cloud/SharedSessionFilesContext.tsx src/features/Org2Cloud/SharedSessionFileViewer.tsx src/features/Org2Cloud/SharedSessionFileViewer.test.ts`: passed.
- `pnpm check:i18n-keys`: all 15 locale catalogs present; zero new issues in all five categories.
- `git diff --check`: passed.
- Production components/diff inspected: new actions use shared Button; no raw button JSX, native button creation, clickable div/span/input bypass, or new form field. Mock buttons are test fixtures.

**Performance verdict: blocked.** Component tests establish request/cleanup behavior, but real Tauri visible/hidden/close CPU/RSS was not measured. Light/dark and narrow-window screenshots, native focus behavior, and full desktop E2E remain unverified. This English translation preserves those limitations and makes no new runtime-acceptance claim.

# Dev startup, identity, and shared login

## Invariants and root causes

Development previously inherited the bundled app identifier `org2ai.org2`.
The single-instance plugin therefore forwarded dev launches to the installed app
and exited. Both dev entry points now apply `tauri.dev.conf.json`; the embedded
identifier owns service-port and shared-data defaults even when
the binary is launched directly. Primary and numbered instance behavior remains
unchanged.

The dedicated dev identity intentionally shares the primary
`shared-service-auth.json` and `~/.orgii/sessions.db`, while numbered test
identities keep separate auth and data homes. Session-related files, settings,
and project data keep the same primary root by explicit user request.
Startup and focus return reload this store through the existing serialized queue.
A transient native identity lookup failure can be retried on focus return.
No database, settings, or history records are copied or deleted.

The old startup theme loader cleared its timeout before awaiting two animation
frames, which can stay paused in an occluded WKWebView. Its load error/timeout
paths also continued without establishing a fallback appearance. Startup HTML now
loads the canonical light stylesheet; the shared theme-swap loader replaces it
only after the selected stylesheet loads. The system preference is preserved.

## Lifecycle review

| Area               | Verdict | Evidence                                                                              | Change or reason kept                                                                                       | Verification                                                                          |
| ------------------ | ------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Background work    | fix     | Startup theme loading had an unbounded paint wait                                     | Reuse the 4-second CSS load limit and 250ms paint fallback; remove duplicate startup timers; add no polling | Tests with permanently suspended animation frames                                     |
| Memory             | keep    | One cached auth-store promise per WebView; old theme retained until replacement loads | Existing operation queue and focus single-flight retained; failed CSS replacement removed                   | Auth coalescing/retry tests and settled stylesheet-count tests                        |
| Scope/isolation    | fix     | One single-instance identity prevented concurrent dev and bundled startup             | Dev uses its own identity, service slot 100, while sharing the primary data root and login store            | Launcher, runtime, auth read/write/sign-out, and numbered-instance isolation tests    |
| Rendering/hot path | fix     | Cold startup could have no successfully applied selected stylesheet                   | Base light stylesheet precedes startup JS; successful-load-only replacement                                 | Fresh headless WebKit profiles for light, dark, failed dark CSS, and stalled dark CSS |

Start/direct launch uses embedded defaults. Idle, hidden, and focus behavior adds
no recurring work. The existing app/subprocess shutdown path is unchanged. Shared
login refresh and sign-out propagate when the other app synchronizes. Concurrent
refresh/write races between processes have not been stress-tested; the existing
write queue is per process.

## Architecture coverage

Covered all ten layers for the changed paths: compilation (1), shared helper
ownership and call chains (2), naming (3), reserved dev slot semantics (4),
primary/secondary fallback behavior (5), config boundary ownership (6), developer
clarity (7), serialized Tauri config (8), launcher/direct-launch initialization
parity (9), and frontend/Rust port and auth-path resolution (10). Network auth
payload schemas are unchanged; unrelated domains were not audited.

## Verification

On the isolated PR branch based on `origin/develop`:

- `node --test scripts/dev/tauri-dev-processes.test.cjs scripts/tauri/instance-profile.test.cjs scripts/tauri/run-with-features.test.cjs`: 19 passed
- `pnpm test src/config/runtimeInstance.test.ts src/features/Org2Cloud/config.test.ts src/api/http/auth/sharedAuthStorage.test.ts src/features/Org2Cloud/org2CloudAuthAtom.test.ts src/app/root/__tests__/useMobileRelayCloudAuthSync.test.ts src/util/core/init/themeInit.test.ts src/util/ui/theme/__tests__/swapThemeCss.test.ts src/app/root/__tests__/macosWindowStartupSurface.test.ts`: 95 passed
- `pnpm run typecheck:fast`: passed
- `pnpm exec eslint src/config/runtimeInstance.ts src/config/runtimeInstance.test.ts src/api/http/auth/sharedAuthStorage.ts src/api/http/auth/sharedAuthStorage.test.ts src/util/core/init/themeInit.ts src/util/core/init/themeInit.test.ts src/util/ui/theme/swapThemeCss.ts --max-warnings 0`: passed
- `git diff --check`: passed

During implementation:

- `cargo test --manifest-path src-tauri/Cargo.toml --lib infrastructure::dev_bundled_auth::tests -- --nocapture`: 4 passed; existing linker unwind-size warning remains
- `rustc --edition=2021 --test src-tauri/src/runtime_instance.rs -o /tmp/orgii-dev-runtime-tests && /tmp/orgii-dev-runtime-tests`: 6 passed
- `pnpm run check:test-placement`: passed
- `pnpm run tauri:dev --no-cache-guard`: compiled and reached backend readiness alongside the bundled app; separate native sockets and backend listeners were observed on ports 13946 and 13847
- The startup-watchdog suite passed 7 tests and failed 2 unrelated source-shape assertions that still search the pre-refactor Rust crate root for lifecycle handlers

- `cargo test --manifest-path src-tauri/Cargo.toml --test dev_shared_sessions -- --nocapture`: 8 passed, including two-process session persistence, read-back by both identities, and numbered-instance isolation

The screenshot evidence uses a clean headless WebKit browser profile, without
native Tauri IPC or login data. Light and dark render correctly; aborting or
stalling dark CSS leaves one light stylesheet with working layout and theme
tokens. These browser checks do not claim native cold-start visual confirmation.

## Risks and limits

Development shares the existing session database, related artifacts, settings,
and sign-out with the bundled app. Earlier `.orgii-dev` data remains untouched. Rollback is a source revert; primary data and auth stay
at their existing paths. Dark cold starts load one additional small base CSS file.
No dependency, database schema, or auth-file format changes are introduced.
SQLite WAL and its existing 15-second busy timeout handle file-level contention;
process-local runtime ownership is not a distributed lock. Dev and bundled
versions must remain schema-compatible when sharing the database.
Native visible/hidden CPU/RSS measurements, native cold-start theme confirmation,
Windows/Linux runtime behavior, cross-process token-refresh stress, live UI propagation, and simultaneous
active-session/background-worker ownership remain
unverified. Performance verdict: blocked for a complete native lifecycle verdict;
no runtime performance improvement is claimed.

## Dev icon follow-up

The dev Tauri config embeds an amber `<II>` icon. The native icon setter selects
that image by app identifier for startup and later preference reapplication,
so shared settings cannot make dev look like the installed app. No preference
write, new timer, listener, or background task is introduced. The existing
main-thread dispatch and image ownership remain unchanged.

- `cargo test --manifest-path src-tauri/Cargo.toml -p app_window --lib dock_icon::tests -- --nocapture`: 8 passed, including native image decoding and dev/primary/numbered selection across all preferences
- `node --test scripts/dev/tauri-dev-processes.test.cjs scripts/tauri/run-with-features.test.cjs`: 14 passed
- `node scripts/tauri/dev-icons.mjs`: regenerated desktop assets from the path-based SVG; 128px and 512px PNGs visually inspected
- The live Dock/taskbar was not inspected; Windows/Linux native behavior remains unverified

## macOS dev Dock name follow-up

The label comes from the bare Cargo executable name, independent of the native
icon. The dev identity now executes a sibling `ORG2 Dev` hard link before AppKit
startup. This is one bounded startup operation with no extra process retained,
polling, or listener. Its inode is shared with the compiled artifact; atomic
replacement refreshes the alias after rebuilds. Process identity, arguments, cwd,
environment, and inherited stdio survive exec, preserving existing supervision.
Packaged apps and numbered identities are excluded. A filesystem failure logs a
diagnostic and keeps the original launch. Live Dock tooltip and native hot-reload
cycles remain unverified without desktop UI control.

The frontend cleanup matcher is anchored to its exact Node process title so it
does not match the newly named native executable's absolute command path.

- `cargo test --manifest-path src-tauri/Cargo.toml --lib app::dev_process_name::tests -- --nocapture`: 4 passed, including real re-exec/PID preservation and rebuilt-inode replacement; existing linker unwind-size warning remains
- `node --test scripts/dev/cleanup-orphans.test.cjs`: passed using stub process enumeration and kill commands, with no real process signals
- `git diff --check`: passed

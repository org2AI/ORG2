# Desktop relay recovery

## Ownership and state transitions

The shared auth store owns durable Cloud credentials. The auth atom owns the
current frontend identity. The native relay supervisor alone owns connection
status and reconnect backoff. Market owner readiness remains a separate security
gate; completing a credential write does not grant Market access.

- App startup, auth changes and relay enablement publish current credentials.
- A server rejection requests a forced refresh, even if local expiry is fresh.
  A different token already rotated by another window can still be adopted.
- Equivalent auth hydration/profile updates do not notify or reconnect.
- Definitively rejected refresh credentials follow the existing guarded sign-out
  policy; transient network failures preserve the session and retry.
- Only a completed durable write may notify Rust. Logout, account replacement,
  feature disablement and unmount invalidate older frontend completions.
- Failed refresh/write/notification work uses one timer per mounted auth scope,
  with exponential delay capped at 30 seconds. Successful idle state has no
  retry timer. Connectivity repair intentionally remains active when hidden.
- Expired native credentials request refresh and enter backoff. The supervisor
  re-reads disk on the next attempt, recovering even if the auth notification
  was missed. Signed-out and invalid configuration states wait for a change.
- HTTP 401 is classified at the WebSocket error boundary. Refresh notifications
  cannot skip auth-failure backoff, preventing rapid refresh/reconnect feedback.
- Handshake deadline: 15 seconds. Registration deadline: 10 seconds. A WebSocket
  upgrade is not Online; a matching `desktop_registered` frame is required.
- Registered connections expire after 75 seconds without inbound traffic.
  Heartbeat, outbound writes and frame dispatch have bounded waits. Registration
  traffic cannot reset the registration deadline.
- Settings changes, completed auth changes and shutdown cancel connection
  attempts. Existing per-phone actors are dropped with the connection.
- Connecting retains the shared reconnect button. Native phase changes emit a
  status event and log phase/attempt only, without credentials.

No persisted schema, relay wire payload or public IPC signature changes. There
is no historical data migration or cleanup. Reverting the code restores the old
behavior without changing stored accounts, pairing or sessions.

## Regression coverage

| Boundary                | Cases                                                                                                                                                       |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared auth persistence | Market pending/failure does not block relay publication; Market's own gate still waits; stale writes remain rejected                                        |
| Frontend auth owner     | Native rejection forces refresh; concurrent signals coalesce; write/IPC failure retries; disable cancels retry; logout/switch rejects old completions       |
| Refresh transport       | Fresh-but-rejected token exchanges; another window's replacement avoids a second rotation; existing identity/endpoint and transient-failure tests           |
| Native connection       | Actual local HTTP 401; silent handshake; missing registration despite inbound traffic; Online liveness timeout; healthy registration stays connected        |
| Native supervisor       | Expired disk credentials recover after refresh without a notification; auth signals do not bypass backoff; disabling drops socket; shutdown reaches Stopped |
| Settings composition    | Connecting keeps an actionable reconnect control, existing duplicate-click guard retained                                                                   |

Run the targeted auth and settings Vitest files and the native
`api::mobile_bridge` tests. Native auth-store tests share a lock around the
process-wide test path override. Tests use local sockets and temporary stores;
they never rotate a real user's token or evict a production desktop connection.

## Architecture and lifecycle review

Reviewed compilation, call-chain reuse, names/readiness semantics, typed error
branches, Market/relay separation, wire compatibility, startup/manual-retry
parity and credential resolution in both WebSocket and pairing requests. No
LLM schema generation or unrelated provider/session lifecycle changed.

| Resource          | Bound and cleanup                                                          | Evidence                                                      |
| ----------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Frontend repair   | One in-flight sync and one backoff timer per auth effect                   | Hook regression tests; effect cleanup and current-auth guards |
| Native connection | One supervisor-owned connection; timed handshake/registration/I/O/liveness | Local transport and supervisor tests                          |
| Retry loop        | Existing capped backoff, no self-notifying refresh request                 | Notification-burst supervisor test                            |
| Phone actors      | Existing drop/abort ownership preserved                                    | Existing actor lifecycle tests                                |
| Market readiness  | Separate from durable publication; still awaited by Market actions         | Storage regression test                                       |

Automated tests establish bounded lifecycle behavior, not a measured CPU/RAM
improvement. A real iOS/Desktop reconnect, sleep/wake, proxy failure, and
cross-window account-switch run remain distinct runtime verification steps.

## Verification — 2026-09-18

Executed from the isolated repair worktree based on `origin/develop`:

```sh
node_modules/.bin/vitest run --config config/vitest.config.ts --maxWorkers=2 \
  src/api/http/auth/sharedAuthStorage.test.ts \
  src/app/root/__tests__/useMobileRelayCloudAuthSync.test.ts \
  src/features/Org2Cloud/org2CloudClient.test.ts \
  src/modules/MainApp/Settings/sections/__tests__/MobileRemoteSettingsSection.relayPreset.test.ts
cargo test --manifest-path src-tauri/Cargo.toml -p org2 --lib api::mobile_bridge -- --test-threads=1
node_modules/.bin/tsgo --noEmit --pretty false
node_modules/.bin/eslint src/api/http/auth/sharedAuthStorage{,.test}.ts \
  src/app/root/useMobileRelayCloudAuthSync.ts \
  src/app/root/__tests__/useMobileRelayCloudAuthSync.test.ts \
  src/features/Org2Cloud/org2CloudClient{,.test}.ts \
  src/modules/MainApp/Settings/sections/MobileRemoteSettingsSection.tsx \
  src/modules/MainApp/Settings/sections/__tests__/MobileRemoteSettingsSection.relayPreset.test.ts
node scripts/quality/check-test-placement.mjs
git diff --name-only --diff-filter=ACMR -z | node scripts/ci/check-changed-file-length.cjs
git diff --check
TAURI_CONFIG='{"build":{"devUrl":"http://localhost:2010"}}' cargo build --manifest-path src-tauri/Cargo.toml -p org2 --bin org2
```

- Vitest: **105 passed**. Native mobile bridge: **168 passed**, 3 existing
  local-history probes ignored because they require supplied transcript/image
  fixtures. All seven new native recovery tests passed.
- Typecheck, changed-file ESLint, test placement, file length and whitespace
  checks passed. The desktop executable and webpack frontend built successfully.
- Native linking reported the existing large unwind-table warning. The initial
  `--no-default-features` test attempt was blocked by an unrelated
  `dynamic_credentials` test referencing the feature-gated `register` function;
  the default production feature configuration above passed.
- Local setup reused the existing sidecar. The installed webpack-dev-server v5
  required a temporary, untracked adapter converting the older proxy object to
  an array. No dependency/config changes were included in the repair.
- Ran the repaired Desktop with the existing paired iOS simulator. Desktop
  showed Connected and the phone Online; the phone displayed the session roster.
  Disabling the UI switch produced Disabled; enabling it produced Connecting
  with an actionable Retry button, then Online within about one second.
  Subsequent full Desktop restarts also returned to Online automatically.
- Verified the changed production control uses the existing shared Button;
  no raw-button or substitute-clickable-element bypass was added. A full UI
  redesign audit was skipped for this single-component recovery-gate fix.

Limits: expired/rejected credentials and stalled peers were injected only in
isolated tests, never into the user's production account/network. iOS session
content navigation could not be exercised through the automation tool (it
reported `noWindowsAvailable` on simulator coordinate clicks); roster rendering
and Desktop connection states were verified. Sleep/wake, a real proxy outage,
and live cross-account switching were not exercised. No comparative CPU/RAM
performance claim is made.

The tested develop baseline also has the separate sidebar-unmount roster issue:
opening Desktop Settings can empty the mobile list; returning to the workstation
restores it. The previously prepared roster-lifecycle change is separate from
this connection repair and must be integrated for that behavior. It is not a
relay disconnect and was not hidden with a UI filter here.

## CI follow-up

The initial PR exposed gaps in the local checks: ordinary ESLint does not run
the type-aware promise rules, and `clippy --lib` does not lint test targets.
The effect/event entry points now explicitly consume sync rejections while
the sync operation retains retry ownership. The Market readiness promise is
returned through its existing completion branch. The native handshake fixture
asserts that bytes were received, and its ping handling uses one condition.
No lint rules or baseline allowances were changed.

The CI-equivalent checks now pass locally:

```sh
NODE_OPTIONS=--max-old-space-size=6144 node scripts/quality/typed-lint/check.mjs
node --test scripts/quality/typed-lint/*.test.mjs
# From src-tauri:
cargo clippy --workspace --all-targets -- -D warnings
```

Type-aware lint reports zero new/increased findings. The full workspace and
all-target Clippy check passes with warnings denied. The four focused frontend
test files above were rerun: 105 passed. Windows verification runs in CI;
these local checks ran on macOS.

# Cloud browser OAuth

This PR targets `develop` directly. It does not depend on the Market feature
branch, modify Market enrollment, migrate accounts, or publish an installer.
It uses the already deployed Cloud OAuth server and its public desktop client.

## Compatibility and rollout

- Existing stored sessions without `oauthClientId` retain GoTrue refresh.
- New sessions persist the public client ID alongside their own tokens, including
  across hydration and cross-window rotation. They refresh through `/oauth/token`.
- Official Cloud sign-in uses browser identity plus app-owned PKCE. Existing
  custom-endpoint code keeps its old login path; this does not introduce or claim
  released support for self-hosting.
- Billing opens the browser login page without transferring desktop tokens. A
  browser without a Cloud session may require one login.
- No identity administrator key, client secret, database change, or package
  dependency is added. The Cloud server configuration must remain available.
- Reverting the PR restores the old login flow. A session created with OAuth may
  require signing in again after downgrading to an older app that discards its
  OAuth client metadata. Existing legacy sessions require no migration.

## Architecture review

| Layer                       | Verdict | Evidence / decision                                                                                                                                                                          |
| --------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 Compilation               | keep    | Whole-repository TypeScript check and changed-file ESLint pass; no Rust changes in this PR.                                                                                                  |
| 2 Ownership and duplication | fix     | One `CloudOAuthFlow` owns the pending verifier, receiver, timer and subscription. Existing sign-in surfaces retain the shared hook.                                                          |
| 3 Naming                    | keep    | OAuth client ID denotes public refresh provenance; it is not an administrator credential.                                                                                                    |
| 4 Semantic boundaries       | fix     | Browser identity, desktop refresh and billing browser session have separate owners.                                                                                                          |
| 5 Defaults                  | keep    | Only official Cloud uses the new protocol; existing custom-endpoint code retains the previous entry path.                                                                                    |
| 6 Domain boundaries         | keep    | No Market grant, workspace or native enrollment code is included.                                                                                                                            |
| 7 Discoverability           | keep    | Controller is independent of UI/store; production adapter uses the instrumented application store.                                                                                           |
| 8 Wire                      | fix     | Exact endpoints, redirect and scopes; S256, single-use state, bounded response bodies, no token URL fragments or client secret. Real production exchange and read-only RPCs pass.            |
| 9 Initialization parity     | keep    | Settings, add/join org, share and other callers use the same sign-in hook. Actual macOS native button-to-browser-to-loopback-to-store acceptance also passes in an isolated numbered bundle. |
| 10 Resolver symmetry        | fix     | Tokens, expiry and client ID travel together through persistence and cross-window adoption. Endpoint/account changes invalidate pending work.                                                |

## Lifecycle and performance

| Area               | Verdict | Evidence                                                               | Change or reason kept                                                                                 | Verification                                                      |
| ------------------ | ------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Background work    | fix     | One pending ten-minute expiry, auth subscription and loopback receiver | Cancellation on replacement, expiry, browser-open failure, identity/endpoint switch and hook teardown | Controller cancellation, late-start, expiry and entry-point tests |
| Memory             | keep    | One attempt; 64 KiB maximum OAuth response                             | No polling or growing cache; verifier released on completion/cancel                                   | Duplicate-callback and fake-clock cleanup tests                   |
| Scope/isolation    | fix     | Captured endpoint, identity and attempt generation                     | Reject stale exchanges before commit; receiver state includes its exact port                          | Account/endpoint switch and mismatch tests                        |
| Rendering/hot path | keep    | No new component, render subscription or recurring refresh loop        | Uses existing app-lifetime OAuth listener; expiry remains active while hidden as security cleanup     | Source review and short macOS native visible/hidden idle samples  |

Real macOS acceptance used an unsigned local numbered instance built from runtime
commit `d75c685f3`, with production webpack assets, separate auth/data/history roots,
separate ports and updater disabled. The original app data was not changed.

- First sign-in from the actual App button opened system Chrome, completed GitHub
  account selection, returned through the native loopback listener and displayed
  the existing account profile. The callback listener closed after completion.
- Quit/relaunch restored the account without browser interaction. To exercise the
  real refresh path, the test changed only expiry metadata in this disposable
  instance's authoritative shared auth file while closed. On restart, the app
  renewed expiry and rotated both access and refresh tokens; user and public OAuth
  client provenance were unchanged. No runtime adapter or fabricated token was used.
- Local sign-out followed by a second App sign-in reused the Cloud session in
  system Chrome and completed with **zero browser login/consent clicks**.
- Four two-second-spaced samples each observed native-process visible idle CPU
  at 0.0% / RSS 75.0–76.1 MiB and hidden idle CPU at 0.1–0.3% / RSS 113.1–120.7 MiB.
  These short debug-bundle samples are a lifecycle check, not a performance
  improvement, total WebKit memory measurement, or long-running memory benchmark.
- Quit removed the native process and released callback, IDE and proxy ports.
  Controller tests cover cancellation, expiry, duplicate callback, account/endpoint
  invalidation and late completion; native repeated login and restart cover the
  real integration. No new recurring work or unbounded retained state was added.

Performance verdict: pass for the changed OAuth resource lifecycle on the tested
macOS instance. Windows/Linux native UI acceptance, a second physical machine,
long-duration memory behavior, provider ingestion and sync topology were not
measured and are not claimed. No ORG2 installer was published.

## Executed verification

- `node_modules/.bin/vitest run --config config/vitest.config.ts src/features/Org2Cloud`:
  156 files / 1,474 tests passed before the final persistence regression was added.
- `node_modules/.bin/tsgo --noEmit --pretty false`: passed.
- `git diff --cached --name-only -- '*.ts' | xargs node_modules/.bin/eslint --max-warnings 0`: passed.
- `node_modules/.bin/vitest run --config config/vitest.config.ts src/features/Org2Cloud/org2CloudAuthAtom.test.ts src/features/Org2Cloud/useOrg2CloudSignIn.test.ts`:
  final persistence and sign-in entry-point regression checks, 25 tests passed.
- `git diff --check`: passed.
- Live production verification on 2026-09-17 UTC transpiled this branch's
  `CloudOAuthFlow` with TypeScript and ran it against the deployed Cloud config,
  Supabase authorization/token/userinfo endpoints and a temporary loopback server.
  Two browser navigations completed with no login or consent click. Each committed
  a verified session, refreshed successfully, read `get_cloud_profile` and
  `list_my_orgs`, and matched profile ID to token subject. Sessions were distinct,
  shared the same identity, and the first remained valid after the second login.
  Credentials stayed in harness memory; only boolean results were recorded.
- `node scripts/ci/run-unit-tests.mjs < <PR changed paths>`: 396 files /
  3,112 tests passed, one existing test skipped. This includes the real sidebar
  hook with the OAuth config boundary stubbed and verifies S256, receiver port
  binding, explicit click ownership and cancellation cleanup.
- `pnpm exec tauri build --debug --bundles app --no-sign --config <isolated numbered-instance config>`:
  passed with the numbered deep-link scheme, production frontend assets and updater
  disabled. The bundle was used locally only; no installer, tag or release was
  published. No organization or billing records were changed by acceptance.

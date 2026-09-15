# ORG2 Market connection module — integration audit in progress

Current integration base: upstream/develop cd08efbc4 (the chronological notes below include earlier-base observations). Product decision: ORG2 is the required desktop host; no separate Market connector application. This document records integration boundaries, not completed implementation or acceptance.

## Completion criteria

- Browser-selected workspace opens through the installed ORG2 application without terminal commands, downloaded credentials or manual endpoint entry.
- Claude Code, Claude Desktop, Codex and ORG2 each have truthful, independently verified connection results.
- Authorization, refresh and revocation are owned by the Market module. Plaintext reusable grants never enter the frontend or deep links.
- Existing configuration transactions, conflict detection, backups and restore are reused. Removing/disabling Market restores only Market-owned configuration and preserves ordinary credentials/profiles.
- Native credentials renew without rewriting a static expired token into clients or requiring repeated user reconfiguration.
- The common configuration/key-vault/proxy layer does not import Market wallets, listing or billing concepts. Integration is registered in the application composition layer.
- Module-off build/runtime and multi-instance isolation are tested. A successful helper test does not prove installed application behavior.

## Traced existing paths

| Layer                   | Evidence / decision                                                                                                                                                              | Remaining evidence                                                                              |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Compilation             | Clean isolated worktree created from current upstream                                                                                                                            | Rust and frontend checks after actual integration                                               |
| Ownership / duplication | Settings commands in src-tauri/src/harness_connections.rs; shared credential resolution in key-vault/src/harness_connections.rs; agent-cli/src/managed_config owns config writes | Wire Market into existing paths; do not build a second installer or config writer               |
| Naming                  | Wire targets claude-code / claude-app / codex / org2 need an explicit host mapping to claude_code / claude_desktop / codex; ORG2 is a host/session target                        | Exhaustive mapping and target tests                                                             |
| Semantics               | Browser authentication, workspace authorization, client configuration and successful model request are different states                                                          | Authoritative state machine and visible success receipts                                        |
| Defaults                | Current resolver only accepts API-key credentials, not rotating Market grants                                                                                                    | Explicit dynamic credential source; no silent static-token fallback                             |
| Domain boundary         | Market owns enrollment and refresh; host adapter invokes generic configuration transactions                                                                                      | No reverse dependency from key-vault or agent-cli into Market                                   |
| Developer clarity       | Independent Market Connector was superseded, not an additional supported installation                                                                                            | Remove obsolete product copy and standalone release references                                  |
| Wire data               | Proposed orgii://market/connect and orgii://market/authorized carry selection / single-use code with PKCE and state; infra PG authorization tests exist                          | Rust-to-Console interoperability, account scope, and replay verification                        |
| Initialization          | Existing useDeepLinkHandler owns Tauri cold/warm deep-link dispatch                                                                                                              | Register module through this owner; test cold launch, running app and secondary instance        |
| Resolver symmetry       | key-vault resolver already keeps endpoint/model/credential coherent; direct config copies a static key, which is insufficient for refresh                                        | Dynamic source must supply coherent workspace/agent/endpoint/token and preserve them on restart |

## Integration shape

A Market module exposes begin, complete, status, disconnect and a dynamic workspace credential source. Native secure storage and the HTTP exchange live behind that module. The application registers deep-link and Settings entry points plus an adapter to the existing harness configuration API. Common configuration machinery stays unaware of payments and Market identity APIs.

For external clients, reuse the existing ORG2 managed proxy so short-lived workspace credentials can refresh in the native process. The local proxy URL is a transport owned by ORG2; its upstream remains the real HTTPS Market workspace endpoint. It must never fall back to a user's unrelated direct provider account when Market is revoked or unavailable. Claude Desktop needs its existing distinct adapter, not the Claude Code adapter renamed.

Direct native configuration currently rejects apiKeyHelper conflicts and writes static API credentials. Simply importing a Market access token into KeyVault and applying this path would regress expiry. The current test receipt also binds credential revision; normal renewal must not be misrepresented as a fresh user-selected provider configuration requiring repeated paid probes. Preserve verification of the selected endpoint/model, while treating authorized token rotation separately.

Disconnect first retires the module's managed selection using existing conflict-aware restore. Grant cleanup cannot erase other KeyVault accounts or overwrite files modified outside ORG2. App quit and module disable must not leave clients falsely reported usable while their local proxy is stopped.

## Product flow and removable boundaries

The website offers installation of ORG2 when needed, then opening the selected workspace in ORG2. The application asks for Market authorization, applies the selected client configuration and verifies the connection. Browser dispatch alone is never a connected receipt. The three product actions remain Connect Claude / Connect Codex / Open in ORG2; the Claude action distinguishes installed Code and Desktop targets internally and offers a choice when both are available. No separate installer, npm package, terminal step or pasted base URL belongs in this flow.

| Owner                                    | Responsibility                                                                                                                      | Removal behavior                                                                                  |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Market Rust crate                        | Authorization proof, credential storage, renewal, workspace selection and revocation                                                | No imports from the generic configuration crates; removable from the application dependency graph |
| Application composition adapter          | Register the Market deep-link namespace and Settings entry; connect the credential source to existing native configuration services | A disabled module rejects its links explicitly and hides its entry points                         |
| Existing managed configuration and proxy | Transactional changes, backup, conflict checks, restore and request forwarding                                                      | Continues supporting ordinary provider accounts without Market                                    |
| Cloud infra                              | Ownership and entitlement checks, scoped grants, actual usage and settlement                                                        | No local paths or client configuration writes                                                     |

Disable/disconnect must finish conflict-aware restoration before dropping the credential source. If external edits prevent restoration, show the conflict and retain recovery metadata; never silently overwrite the user's changes. Removing the compiled module requires retiring its persisted managed selections first. A runtime toggle alone is not proof that removing the dependency builds.

## Verified status and remaining integration gaps

Remote upstream/develop was checked again on 2026-09-13 and still resolves to 018a34fff1147d18982b226fa499ea307a673a36. The Rust crate's five protocol and credential-namespace tests pass. These tests do not exercise OS keychain writes, a packaged application, native configuration or live requests.

- The crate is now an optional application dependency enabled by default. Native begin/complete/cancel/status commands and both main-window deep-link entry paths are registered. The client configuration adapter is still pending; authorization is explicitly not reported as a connected client.
- `harness_connection_apply` explicitly rejects managed routing for Claude Desktop and provider profiles. Desktop renewal needs a supported adapter before the Claude Desktop action can report ready.
- Native grant load/delete, serialized on-demand renewal and cancellation-safe enrollment persistence are implemented. A bounded metadata index supports discovery after restart. Connect the renewal owner to actual managed request forwarding. A single-use exchange must not be blindly retried after an ambiguous network failure.
- Infra now persists and signs native workspace/target scope across renewal. Its verifier denies scoped sessions by default; only selected-workspace read and compatible entitlement-token mint opt in. HTTP and PostgreSQL regression checks pass; production migration/deployment is still pending.
- Cold and warm links use the existing `useDeepLinkHandler` owner, without another listener or secret URL dedup set. Verify this on the packaged application and isolated secondary instance.
- Verify install/open, authorization, actual request, renewal, restart, revoke, disconnect, conflicting edits and module-off behavior separately. Windows remains unverified until tested on Windows.

### Native persistence boundary follow-up

`cargo test --manifest-path src-tauri/Cargo.toml -p market-connect` now passes 10 tests; `git diff --check` passes. New coverage rejects malformed identity, changed workspace/owner/target and untrusted endpoints, allows recovery of an expired access token only while its renewal grant remains valid, and rejects late enrollment results after cancellation or a new attempt. Enrollment stays exclusive during HTTP redemption. Persisting an enrollment grant is only exposed through the enrollment owner's state check.

| Area               | Verdict | Evidence                                                                                                              | Change or reason kept                                                    | Verification                                            |
| ------------------ | ------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------- |
| Background work    | keep    | No polling/timer introduced by the crate                                                                              | HTTP remains explicitly invoked; renewal coordinator pending             | Source inspection; application idle measurement not run |
| Memory             | keep    | One pending approval and one exchange marker                                                                          | No app-lifetime growing registry                                         | Overlapping enrollment test                             |
| Scope/isolation    | fix     | OS-store namespace includes instance, authority, identity, workspace and target; restored content must match metadata | Reject wrong-scope records and retired authorization before store writes | Namespace, restore and late-completion tests            |
| Rendering/hot path | pending | Crate is not yet wired to Tauri                                                                                       | OS-store calls must run off the async executor in the host               | Native application verification not run                 |

Performance verdict: blocked for application-level acceptance until the production host is wired and measured. Crate tests are not evidence of working desktop renewal or actual OS-store round trips.

### Application composition and renewal follow-up

The native coordinator serializes equivalent accesses, writes a spent marker before rotating the one-shot refresh secret, persists the replacement before returning access and stops subsequent consumers after an ambiguous failure. There is no retry loop or timer. The final portion of the fixed login lifetime does not trigger renewal for every request. A canceled request cannot leave a replayable old secret on disk after dispatch. The production host installs the Rustls provider in bootstrap; standalone tests now install the same provider explicitly.

The app defaults to the `market-connect` Cargo feature. With it disabled, the same IPC surface returns `market_module_disabled` and an empty disabled status, without importing the crate. Both feature-enabled and feature-disabled root application checks pass after staging the repository-built sidecar. Metadata index records are bounded to 32 and 32 KiB; native status reads actual secure-store validity and reports `authorization_saved` or `reauthorization_required`, never client connectivity. New toast strings cover all 13 existing locales.

Verification so far: 15 Rust crate tests pass; 4 Market Vitest deep-link tests pass; `pnpm typecheck:fast` and targeted ESLint pass. The first root `cargo check -p org2 --lib` stopped because the clean checkout had not built its required `org2-pm` sidecar. The repository `prepare-sidecars.cjs --profile debug` build completed successfully, and root checks subsequently passed. No installed-app acceptance or production rollout is claimed.

Remaining for this feature: actual managed credential-source integration, Desktop adapter support, native Settings status/restore UI, real OS-store round trips, and packaged-app lifecycle acceptance. Overall pricing and local-rollout work remains tracked in the infra audit.

Caller cancellation is now also covered: renewal runs in an owned task holding the coordinator lock through blocking store writes and final commit. Dropping the caller cannot free the lock while a keychain operation is still running. Begin/cancel host commands also run off the async executor so an OS-store operation holding the enrollment lock cannot stall the UI thread. This change still requires real app lifecycle measurement before a performance pass.

### Workspace credential boundary

Native code now requests the selected workspace from the real Market authority and obtains the short-lived gateway credential through the entitlement-token endpoint. It checks response identity, workspace, entitlement, target compatibility, fixed gateway origin and expiry before handing credentials to a native caller. The wire token prefix is `og2t.v1`, even though existing comments call workspace-bound claims “og2ws”; the implementation was checked against the actual token signer. The common managed proxy still needs its dynamic credential adapter and selection UI. These helpers alone do not prove live forwarding.

Infra scope regression evidence: full PostgreSQL suite 186/186 passed with zero skipped; Console 220/220 passed; identity/API suite 16/16 passed. Native grants cannot fork or authorize broader grants; rotation retains scope and rejects transferred workspace ownership. Native refresh logout retires its family without revoking the browser login. Scope migration is required before backend deployment. Real application and Chrome acceptance remain pending.

### Dynamic managed proxy integration

The application now registers a Market implementation behind a generic dynamic credential source interface. The managed proxy validates its local proxy token before resolving any rotating credential. The Market source restores the native login, mints and caches an entitlement-bound gateway credential, and uses Bearer authentication for Claude and Codex. Sources are registered at app composition; common config-writing crates do not import Market. An unknown source namespace fails closed, including when the feature is compiled out.

`market_connection_apply` reuses the existing checked, non-forcing managed-config transaction with expected file hashes. It currently supports Claude Code and Codex. The selected profile contains only owner/workspace/target/entitlement metadata, never the rotating bearer. This command configures the client; it does not prove a successful model request. Settings UI, Desktop and ORG2 launch paths, and actual machine acceptance are still required. A native disconnect command now restores only its still-selected profile before removing the grant/index record.

The cache is bounded to 32 login owners and 32 selected entitlement credentials. Credential operations run as owned tasks so canceled callers do not release cache ownership during a renewal/store commit. Reauthorization takes the same owner lock, retires caches, and holds that lock through the new secure-store write. No idle timer is introduced. Root compile checks passed before the final test additions; the three Market source root unit tests passed. Additional proxy and restore tests are running after the disconnect implementation. Runtime idle and shutdown measurement remains unverified.

Disconnect uses a new generic `restore_if_selected` transaction in agent-cli: the expected selection comparison and non-forcing restore share the target lock. It refuses to undo a newer selection or externally modified file. The Market command holds the source coordinator while restoring, deleting only the matching native grant and index record, and retiring cached credentials. If restoration fails, stored authorization stays available for recovery. If a later OS-store or index write fails, report that stage rather than falsely reporting complete disconnect. Runtime tests must still exercise these actual failure states.

Latest checks after proxy/disconnect integration: `cargo test -p org2 --lib cli_managed_proxy::tests` passes 10 tests; `cargo test -p agent_cli source_disconnect_refuses_to_restore_a_newer_selection` passes its regression; `cargo check -p org2 --lib --no-default-features` passes. The native workspace crate passes 17 tests. These are separate test scopes; none is reported as a live model request or packaged-app acceptance. All commands used `--manifest-path src-tauri/Cargo.toml` from the isolated worktree.

### Native connection UI

The root now lazily opens a shared ModalSystem dialog after native authorization. It lists purchased entries and backend-provided compatible models, takes current configuration hashes before applying, shows configuration-only status, and offers conflict-aware disconnect. Existing saved selections reopen as configured only when their metadata matches the requested identity/workspace/target. A Settings entry loads native saved connections and reopens or reauthorizes them; listeners dispose on unmount and late responses are generation guarded. New text covers all 13 locales.

Four rendered DOM tests use actual shared controls/modal for configure, conflicts, unavailable adapters and reopening/disconnecting the exact saved profile. The prior combined dialog/deep-link run passed 12 tests before the fourth dialog case was added. Typecheck, targeted ESLint and native application check passed. A production frontend build completed; an actual macOS application bundle build is now running for computer-use inspection. UI audit: 0 fix, 5 keep with reason, 0 abstract. Full installed-app flow and performance measurements remain unverified.

Known product gaps remain visible: workspace display names/local folder selection, automatic client launch, Claude Desktop and ORG2 target wiring, improved recovery buttons, and website replacement of the legacy client-install flow. Pricing tiers, remaining listing simplification, manual rollout, and PR review deliverables remain tracked in the infra plan. This UI milestone does not supersede those requirements.

Packaging found a baseline mismatch: Rust Tauri is pinned to 2.11.1 while the frontend API requested 2.10.x. The frontend dependency and lockfile now resolve API 2.11.1; unrelated package ordering was preserved. Tauri's version check subsequently passed and a fresh debug app bundle build is running. Latest frontend typecheck and targeted ESLint pass. Four dialog-render tests pass. User Chrome Vince profile and the existing `/listings` preview were inspected via computer use; that preview is still the earlier local pricing fixture, not proof of the new native integration.

## Current acceptance snapshot (2026-09-13, packaged application)

- Refetched `upstream/develop`; no new commits beyond the inspected base were returned.
- `cargo test -p market-connect --lib`: 17 passed after the workspace options DTO change.
- `cargo check -p org2 --no-default-features --lib`: passed with Market disabled. This verifies compilation, not runtime restoration of a previously selected Market profile.
- `pnpm exec tauri build --debug --bundles app`: frontend and Rust compilation succeeded; release-identity signing failed because the configured Developer ID certificate is absent on this host.
- `pnpm exec tauri bundle --debug --bundles app --no-sign`: local acceptance bundle succeeded. This is not a signed distribution artifact.
- Computer use opened the built app and observed its workstation UI. It did not verify a Market connection or a model request.
- The primary application identifier shares `shared-service-auth.json` independently of `ORGII_HOME` (see `src/api/http/auth/sharedAuthStorage.ts`). The acceptance process was quit after observing that existing sign-in and cloud synchronization were active. Future isolated acceptance must use a separate compiled application identifier, not only a different data directory. Do not clear the primary user's auth store to isolate a test.
- Claude Code/Codex configuration composition is implemented; automatic workspace launch, Claude Desktop and ORG2 session adapters, production native endpoint rollout, and end-to-end renewal/revocation remain incomplete.

The previous chronological notes describe intermediate states. This snapshot does not supersede the remaining product-plan checklist or claim production readiness.

### Isolated packaged-app verification follow-up

A second local debug build used the compiled identifier `org2ai.org2.marketacceptance` and product name `ORG2 Market Acceptance`, with updater artifacts and distribution signing disabled only through command-line overrides. Build and bundling passed. Computer use observed `My workspace` and `Login` instead of the primary user's signed-in organization; the process was then exited. This confirms the acceptance isolation approach, not Market authorization.

The Console's matching local connection page was exercised in Chrome with a synthetic database-backed purchase. Clicking Claude Code displayed the opening instruction; no native authorization callback or completed model request was observed. The browser-to-native dispatch still needs investigation and must not be reported as end-to-end success. The production native endpoints and matching signed desktop release remain rollout prerequisites.

### Protocol registration check

macOS Launch Services reported the isolated acceptance bundle as the `orgii` handler, and the generated bundle lists both `orgii` and `yorgai`. The installed `/Applications/ORG2.app` uses the older identifier `yorg.orgii`; the development source uses `org2ai.org2`. After the check, both protocol defaults were restored to the installed app, and `orgii` was read back as `yorg.orgii`. A test bundle must not silently remain the user's protocol handler.

Chrome's page console contained no error and the page reached only its opening state. Native receive/authorization remains unverified. The current evidence does not establish a bug in the Tauri event plugin: its registered `RunEvent::Opened` listener emits the deep-link event and records the initial URL. Investigate browser/native handoff using an isolated registered bundle before changing event ownership or adding another listener.

## Modularization follow-up — required ORG2 desktop

Fetched `upstream/develop` again: it now points to `cd08efbc4`. Compared its changes against the integration base; navigation and session-launch callers moved to `useAppNavigate`, and dependency/security/pricing updates also landed. They have not yet been incorporated into this dirty integration worktree. The earlier “no newer commits” observation is historical, not current.

The connection architecture has three owners:

| Owner                                                  | Responsibility                                                                                  | Excluded responsibility                                             |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Market website/backend                                 | Purchase, workspace entitlement, browser authorization and scoped grant issuance                | Local client configuration and application installation             |
| Optional native `market-connect` module + Market UI    | Authorization/renewal, selection metadata, workspace credential source, disconnect coordination | Generic client configuration formats and ordinary KeyVault accounts |
| Existing ORG2 managed configuration/proxy/session host | Conflict-aware config switching, backups/restore, proxy forwarding and client launch            | Market pricing, wallet and entitlement policy                       |

A concrete coupling was found in the new proxy integration: it selected Bearer authentication by comparing the provider name to `market`. That branch is now removed. `Destination` declares `Authentication`, and the Market source requests Bearer; the generic proxy understands the authentication mode, not Market identity. Ordinary static providers keep protocol-default authentication, including Azure header behavior. The regression exercises a differently named dynamic source so renaming/removing Market cannot control that behavior.

“Removable” means the module can be compiled out and ordinary configuration remains independent. It does not mean deleting a crate while a client still points at its local proxy is safe. Before disabling an active module, restore only its still-selected configuration through the existing conflict-aware transaction, then revoke/remove its native authorization. External edits must stop restoration instead of being overwritten. Runtime disable/restart acceptance is still pending.

The intended user flow is install ORG2 once → recharge/purchase on the website → open ORG2 → choose a local workspace and target → use the existing launcher. No extra connector package is part of the normal flow. Current code configures Claude Code/Codex but does not yet complete folder selection/launch; Claude App/ORG2 adapters and a compatible signed release remain unfinished. These are explicit implementation and acceptance tasks, not claims of working one-click onboarding.

Performance scope of the authentication-boundary change: it adds a small enum to the existing destination/context and one synchronous branch at request construction. It introduces no new cache, retained credential, polling, timer, task or subscription. Existing owned renewal tasks and limits are unchanged. This is a code-level lifecycle assessment; packaged-app idle/shutdown and renewal measurements remain pending.

Authentication boundary verification: `cargo test --manifest-path src-tauri/Cargo.toml -p org2 --lib cli_managed_proxy::tests` passed 11 tests, zero failed/ignored. The suite verifies source-declared Bearer for both proxy protocols and preserves ordinary Anthropic/OpenAI/Azure authentication headers. This is a unit regression, not a paid model request or full-app acceptance. Log: `/tmp/org2-market-modular-auth-tests.log` (local evidence, not a committed artifact).

After the authentication change, `cargo check --manifest-path src-tauri/Cargo.toml -p org2 --no-default-features --lib` passed. Module-off runtime/disconnect acceptance remains pending.

## Workspace/client launch implementation

The configured connection now offers a native folder picker and opens the selected installed Claude Code/Codex in ORG2's existing terminal surface. It reuses the CLI registry, launch-command formatter, managed TUI session creation, terminal store, and navigation surface. It sends no model prompt. Missing binaries, invalid folders, canceled dialogs, changed configuration and session-creation failures do not degrade into an unbound client.

A preflight-only approach was insufficient: the global config could change before the child reads it. A generic managed-config launch helper now freezes the current proxy generation under the same configuration/target locks. It writes an owner-only session directory with generated Codex or Claude settings, returns only directory/argument metadata to the frontend, and injects `CODEX_HOME` or `CLAUDE_CONFIG_DIR` into the existing terminal environment. Claude additionally receives the explicit settings file and user-only settings source. No native grant or upstream credential is serialized. Switching global configuration rotates the proxy token; this copy cannot silently bind itself to the new selection.

Normal terminal release cleans only its validated session profile. Preparation failure/cancellation retires the created TUI session; failed native profile construction removes its partial directory. Retained profile count is bounded at 256 with no polling/cleanup timer. Crash cleanup, retained-session resume, CLI-version-specific project/config precedence and packaged-app shutdown still need actual verification; the count limit is not a substitute for lifecycle acceptance.

Verification after this implementation:

- Market frontend suites: 21 tests passed, including rendered native-folder/start/error/cancel controls and preparation failure/selection changes.
- `cargo test --manifest-path src-tauri/Cargo.toml -p agent_cli managed_config::`: 50 passed, 0 failed/ignored, including frozen generation, private file permissions, targeted release, external edit rejection and existing restoration tests.
- `cargo check --manifest-path src-tauri/Cargo.toml -p org2 --lib`: passed.
- Targeted ESLint: passed. Full TypeScript checking initially exhausted Node's default 4 GiB heap. A rerun with 12 GiB identified a launch-result literal-type error (fixed) and a SearchInput test type error outside this change; verification is being rerun. Do not report full typecheck passed yet.

This is implementation plus local automated verification. Actual installed-client startup, account/model request, OAuth callback, Windows, production release and the rest of the infra product plan are not complete. Upstream navigation integration to `cd08efbc4` is still required before review.

Final checks for this launch increment: all 42 tests in the Market, CLI terminal command and SearchInput component scopes passed. Full `NODE_OPTIONS=--max-old-space-size=12288 pnpm exec tsc --noEmit` passed after correcting the launch literal type and narrowing the two distinct SearchInput test renderers instead of passing a union of component types. The SearchInput test typing adjustment is outside the Market runtime change and needs separate scope review when preparing commits/PRs. `NODE_OPTIONS=--max-old-space-size=12288 pnpm run build` passed. The CLI environment wrapper was executed through a real POSIX shell with spaces, apostrophes and command-substitution text in the path; the literal path was preserved and the inherited directory overridden. Windows quoting has automated string checks only, not Windows execution evidence.

Snapshot environment is also applied at the actual launch command after shell startup, so a shell RC file cannot reset the captured config directory before the client starts. This changes only commands that opt into the new wrapper; ordinary launches remain unchanged. Lifecycle/performance assessment: no new polling or recurring task; registry discovery is click-triggered, snapshots are bounded, and normal terminal release removes the owned profile. Crash/abandonment retention remains an explicit runtime acceptance item.

### Terminal release ordering

The existing terminal close action parked the TUI session before closing its PTY. With session-owned configuration files, this could remove a running client's settings. Release now follows the native `close_pty` acknowledgement; native close is idempotent and kills/reaps the child before returning. An unavailable host or failed close retains the native profile for exit/recovery instead of assuming termination. The ordinary terminal state teardown remains unchanged.

Three new atom-level regressions verify delayed close, failed close, unavailable native host, and that a caller cannot override the managed `ORGII_SESSION_ID`. Together with the current Market suites, 24 tests passed. This verifies release ordering, not crash cleanup or every descendant process in a packaged app.

## Latest integration checkpoint

The independent SearchInput test typing fix and native connection implementation are now local commits, rebased onto `upstream/develop` at `cd08efbc4`. The dependency lock was installed frozen, including upstream security updates. The new workspace launch follows the shared `useAppNavigate` wrapper, preserving the upstream navigation-completion error handling.

After integration: 50 tests across Market, terminal lifecycle/command formatting, SearchInput and shared navigation passed; full TypeScript check, root Rust check and production frontend build passed. Normal commit hooks also passed lint, staged type checking and scoped Clippy. Local commit creation is not a release or PR completion claim. Packaged cross-application authorization/request, lifecycle/Windows acceptance, release marker/signing, remaining infra/product work and final PR deliverables remain open.

## Packaged application and launch handoff checkpoint

The rebased native acceptance bundle built successfully with the independent
`org2ai.org2.marketacceptance` identifier. Computer use observed `My workspace`
and `Login`, confirming that this run did not inherit the primary application's
sign-in. Chrome's local synthetic buyer page still reached only the opening
state. Foreground testing was interrupted by user activity; native authorization
receipt and a real model request remain unverified. Both protocol handlers were
restored to the installed application's `yorg.orgii` identifier. The isolated
process was then stopped; no production deployment was performed.

The workspace launcher now releases its prepared session when terminal creation
fails, or asks the existing terminal lifecycle owner to close a created terminal
when tab insertion fails. After tab ownership transfers, a navigation failure
retains the profile. The six WorkspaceLaunch tests pass, including all three
failure boundaries. This additional frontend change is newer than the acceptance
bundle and has not yet been exercised in a rebuilt application.

## Seller authorization receiver foundation

The Market native crate now owns a loopback seller callback receiver for the
existing fixed Claude/Codex authorization destinations. It validates provider
origin, callback URI, PKCE challenge shape, deadline and state before listening;
callbacks validate host, origin, path, state and unique code/error parameters.
Responses contain no authorization code and disable caching/referrers. Callback
receipt is one-shot; denial, timeout and cancellation close the listener.

The crate suite passes 21 tests, including real loopback HTTP rejection/replay,
denial, timeout, port contention and cancellation checks. Clippy passed before
the final cancellation test was added. This adds the existing workspace Axum
dependency to the Market crate; no new version or external service is introduced.
The receiver is not yet wired to seller enrollment, browser authorization, or
completion APIs. Seller GUI onboarding remains incomplete and the old Console
CLI fallback has not been represented as fixed by this foundation alone.

## Native seller enrollment state machine

Added strict `orgii://market/seller/connect` selection parsing and a native-only
PKCE/state owner targeting the fixed `/seller/accounts/authorize` Console page.
Only provider and region enter the selection link. Duplicate callbacks, unknown
parameters, competing attempts and expired approvals are rejected; cancellation
retires late completion. The Market crate passes 25 tests. This owner is not yet
registered in the application deep-link dispatcher and its Console page is still
to be implemented, so no seller connection button is advertised as working.

## Seller native redemption transport

The seller redemption now POSTs its proof to the fixed Console endpoint with an
eight-second deadline, no redirects and the existing bounded response reader.
Its native-only grant rejects general login/refresh credentials, mismatched
provider/region/state, substituted Market origin and expiry expansion. No Debug
or Serialize implementation exposes the credential through IPC. The Market crate
passes 28 tests, including grant substitution and lifetime checks. Actual HTTPS
redemption from the packaged application remains unverified; the host dispatcher
and complete provider workflow still need wiring.

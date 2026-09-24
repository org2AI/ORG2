# Instance storage isolation

## Problem and authoritative boundaries

Dual-desktop attachment verification exposed two independent violations of the same data-home ownership boundary:

- Scratchpad writers used a UID-wide operating-system temporary tree. Each desktop's housekeeping compared every directory in that tree against only its own session database. A valid file owned by another profile could therefore be classified as an orphan and deleted.
- The frontend auth writer selected a Tauri bundle-identifier store, regardless of `ORGII_HOME`. Market repeated that rule; mobile relay always selected the primary identifier. Reusing an identifier with a fresh data home could hydrate a previous account before test login.

Observed evidence: one isolated desktop's housekeeping reported four orphan-directory deletions under the legacy global root. The log omitted directory names, so ownership and recoverability cannot be reconstructed. Its initial cloud log also referenced an organization outside the newly created test accounts. The before/after cloud inventory kept all 3,498 pre-existing session rows unchanged; this does not prove absence of local filesystem effects.

## Design

The session database and temporary writers/cleanup now share `app_paths::orgii_root()`. The default scratchpad/hosted-Kiro/MCP temporary root is `<data-home>/tmp`. An explicit `ORGII_TEMP_ROOT` remains caller-owned configuration and must not be shared by independent databases. No legacy global tree is migrated, traversed or deleted. Orphan cleanup does not follow workspace/session directory symlinks.

One native resolver owns the auth storage profile. Frontend storage, Market and mobile relay use its path:

| Runtime home                | Auth location                          | Legacy browser migration |
| --------------------------- | -------------------------------------- | ------------------------ |
| Primary default             | Existing primary app-data file         | Allowed                  |
| Dedicated dev default       | Existing primary app-data file         | Allowed                  |
| Numbered default            | Existing identifier app-data file      | Allowed                  |
| Custom home, any identifier | `<data-home>/shared-service-auth.json` | Disabled                 |

The comparison uses path components without resolving symlink aliases. An explicit alias is conservatively treated as a custom home. The returned path is absolute so Tauri LazyStore and native file readers cannot interpret a relative path differently. The native initialization command atomically publishes a private empty JSON file if no store exists; it never overwrites an existing store. Disk initialization runs on the blocking pool, outside the main thread. This avoids LazyStore reload failing before the first login. Native failures do not fall back to the primary account. Startup clears unverified browser auth if durable auth initialization fails; focus synchronization can retry. The debug bundled-login importer rejects custom homes before reading any legacy WebKit database. The test-only mobile path override is no longer a production environment override.

The new typed IPC response is `{ path: string, allowLegacyMigration: boolean }`. Frontend/native versions ship together. There are no remote protocol, database-schema, cloud-quota or transcript changes.

## Compatibility, historical state and rollback

Existing primary/dev and default numbered installations keep their auth files. Custom-home users sign in again; old identifier auth is neither copied nor deleted. Previously polluted browser state is not migrated. Existing custom-home auth files remain authoritative; this change does not infer or erase historical account ownership.

Old absolute scratchpad links continue to name their original files while those files exist. New writes use the profile root. Recreated hosted Kiro homes may require new setup; retained profile temp files are no longer subject to operating-system temp eviction. Existing housekeeping/session deletion remains responsible for cleanup. This change does not add a disk-size cap.

Keep old profiles and legacy temp trees intact. Do not downgrade and run independent profiles concurrently: old binaries restore the global sweep and identifier-based login behavior. Stop isolated instances before rollback; retain the profile for re-upgrade. No destructive historical cleanup or credential migration is included. The four earlier deletions cannot be claimed recovered.

## Architecture audit

| Layer             | Coverage                                      | Finding and resolution                                                                                                             |
| ----------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 1 Compilation     | Rust + TypeScript                             | Targeted tests, typecheck and command registration verification                                                                    |
| 2 Deduplication   | Auth readers and test helper                  | One native auth resolver; E2E scratchpad helper delegates to app_paths                                                             |
| 3 Naming          | Temporary storage ownership                   | Replace UID-wide descriptions with profile ownership                                                                               |
| 4 Semantics       | Identifier versus data home                   | Identifier controls default compatibility; custom home controls isolation                                                          |
| 5 Defaults        | Default/custom/failed resolution              | Preserve known default sharing; no primary fallback on errors                                                                      |
| 6 Boundaries      | Frontend/native/mobile                        | Auth path is native-owned; session database owns cleanup scope                                                                     |
| 7 Discoverability | Resolver and lifecycle documentation          | One documented location policy, explicit rollback constraints                                                                      |
| 8 Wire            | New local IPC                                 | Typed camelCase response; no remote wire changes                                                                                   |
| 9 Initialization  | Primary/dev/numbered/custom and direct launch | Shared resolver applies to every reader; API AppHandle initialization precedes relay startup; legacy importer rejects custom homes |
| 10 Symmetry       | Auth read/write and scratchpad create/delete  | Same path authority in each pair; source-level isolation regressions                                                               |

All ten layers were reviewed within the changed storage boundary. Provider ingestion, transcript reconciliation and cloud epoch semantics are outside this PR's implementation scope.

## Performance guard

| Area               | Verdict | Evidence                                      | Change or reason kept                                                   | Verification                                                              |
| ------------------ | ------- | --------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Background work    | fix     | Global orphan scan used a local ownership set | Scan only profile temp; skip symlinks                                   | Native cleanup regression and desktop acceptance                          |
| Memory             | keep    | No new cache or retained collection           | One existing single-flight auth store promise                           | Auth coalescing/retry regressions                                         |
| Scope/isolation    | fix     | Identifier store bypassed data-home isolation | Central native profile and disabled custom-home legacy migration        | Native file fixtures, frontend writer/hydration tests, desktop acceptance |
| Rendering/hot path | keep    | No presentation changes or periodic IPC       | Profile lookup occurs once per initialization, retry only after failure | Typecheck and desktop startup                                             |

This PR does not change polling cadence or add timers. It does not establish a new performance claim for immutable attachment capture. The previous 32 MiB capture/read benchmark's memory peak and the unavailable real-provider continuation cell remain open in PR #2135.

## Verification

Desktop acceptance uses owned data homes and non-secret local auth markers; it is not a real-account/provider share-session continuation test. No new UI controls are introduced, so screenshots are not useful evidence for the path-policy changes.

Automated checks on macOS:

```sh
cd src-tauri
cargo test -p app_paths
cargo test --lib infrastructure::shared_auth_paths::tests -- --test-threads=1
cargo test --lib infrastructure::housekeeping::tests -- --test-threads=1
cargo test --lib api::mobile_bridge::org2_cloud_auth::tests -- --test-threads=1
cargo test --lib market_connection::owner::tests -- --test-threads=1
cargo test --lib infrastructure::dev_bundled_auth::tests -- --test-threads=1
cd ..
pnpm exec vitest run --config config/vitest.config.ts src/api/http/auth
pnpm typecheck:fast
pnpm check:typed-lint
pnpm check:boundaries
pnpm check:circular
pnpm check:test-placement
git diff --check
```

These passed: **80 Rust tests** (36 + 4 + 15 + 5 + 16 + 4), **35 frontend tests**, typecheck, changed-file ESLint, typed-lint (no new/increased findings), dependency boundaries, circular-dependency and test-placement checks. The only changed TSX lines are bootstrap comments; there are no changed rendered controls, button/input bypasses or UI-layout changes.

Cargo dependency changes reuse existing workspace dependencies: the path crate drops its unused production `libc` dependency and uses `tempfile` only for isolated test fixtures; the runtime E2E helper depends on `app_paths` instead of duplicating its layout. No package versions changed. The desktop's existing `tempfile` dependency implements atomic auth initialization.

Strict Rust lint also passed:

```sh
cd src-tauri
cargo clippy -p org2 -p app_paths --lib --tests -- -D warnings
cargo clippy -p e2e-test --bin e2e-test -- -D warnings
```

### Desktop evidence and limits

Executed `python3 /tmp/org2-isolation-verification-acceptance/run.py` on macOS against current-code WebDriver builds. The private runner uses the repository's WDIO and dual-instance harnesses, fresh homes, empty credential seeds, mock-provider setup and a dedicated fixture workspace. It invokes production auth storage and cleanup paths; it does not contact a real model or establish real-account token verification. Non-secret auth markers and the existing offline/skip-login setting are test preconditions.

| Boundary                                        | Observed result                                                                                                                 |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Reused application identifier, fresh data home  | An earlier run's home retained its marker; the new home initialized as empty JSON and did not inherit it                        |
| Frontend auth writer → file → cold startup      | Both instances persisted distinct markers through the production serialized writer; each cold boot restored only its own marker |
| Legacy bundled login import                     | Native command rejected both custom homes before reading the legacy WebKit tree                                                 |
| B orphan sweep with A file and a symlink into A | B deleted one owned orphan; A's bytes remained unchanged; the symlink target was not traversed                                  |
| Repeated B sweep                                | Zero further scratchpad evictions; A's bytes still unchanged                                                                    |
| Post-close                                      | Both owned native PIDs were absent; temporary webpack/Tauri config changes were restored                                        |

Neither final-instance log contained an auth-initialization failure or a vanished-organization message. Housekeeping logs recorded one owned scratchpad deletion followed by zero; other reported cleanup counters were zero. These observations concern these fixtures, not all historical files.

**The whole WDIO script failed**, after the functional cells above, because the resource-sampling precondition expected both windows to be visible and one reported `hidden`. No resource numbers from that phase are accepted. Earlier attempts also encountered WebView IPC timeouts after browser refresh; the cause remains unresolved. Full process cold boots were used for the successful restoration cells. Attempting to run the same bundle identifier concurrently was rejected by the existing macOS single-instance gate; the gate was not weakened. Identifier reuse was verified across consecutive runs with different homes instead.

The local webpack-dev-server version also rejects the tracked object-form proxy configuration. The private runner temporarily adapted it to array form and restored it afterward; that unrelated setup fix is not in this PR. WebDriver's initial `no window` handshake retries are visible in the run log. This is native/IPC integration evidence, not a passing rendered core UI suite.

**Performance verdict: blocked** for full share-session acceptance. Current-code storage ownership and cleanup cells passed on macOS, but the visible/hidden resource phase did not establish its visibility precondition. Windows/Linux execution, long-duration resource behavior, real-provider continuation, and PR #2135's attachment-capture memory peak remain unverified. The implementation adds no periodic work and makes no measured performance-improvement claim.

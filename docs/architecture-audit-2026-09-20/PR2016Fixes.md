# PR #2016 follow-up: managed credential profiles and token sync

## Problem and authoritative boundary

Native CLI credentials live in Codex `auth.json` or Kiro SQLite `auth_kv`; the Vault keeps a separate encrypted record. Replaying a launch snapshot could overwrite a native rotation. Reading a reconstructed account HOME after reconnect could import the wrong generation. Unconditional health reset could also undo a manual disable. Fixes belong at profile initialization and guarded Vault writes, not at UI filters.

This PR depends on #2015's generation-aware Vault and token-sync foundation. Its review base is `fix/oauth-shared-refresh-token`.

## Resulting behavior

- Capture launch environment and credential generation from one selected key. Verify that key before profile setup, and run blocking setup outside the async executor.
- Credential generation 0 retains the existing account HOME. Explicit reconnect selects `credential-generations/<n>`. Finalization reads the actual launched HOME/CODEX_HOME and submits its launch generation, so an old child cannot overwrite a new login.
- Kiro initializes once under a nonblocking profile lock. Its marker means initialized, not token recency. Initialized profiles, including unreadable auth, are not reseeded. Token, expiry and client registration remain a coherent native bundle; placeholders never return to the Vault. Auth DB permission failures abort setup.
- Codex reconciles newer profile credentials before refresh/seeding, and seeding rechecks existing identity/expiry under a cooperating-writer lock. A delayed launch cannot replay older credentials over a newer profile. OAuth retry cannot change credential generation while retaining the old HOME.
- Share only native history directories across generations: Codex `sessions` and Kiro `.kiro/sessions/cli`. Auth files and SQLite databases stay separate. History retains the existing scope of one Vault account record; it is not reclassified by provider identity. Conflicting history directories fail without deletion or replacement.
- Kiro stale-lock cleanup uses the selected HOME, validates session UUIDs, and treats only ESRCH as proof that a Unix process is gone.

## Architecture coverage

All ten architecture layers were covered: compilation; live caller/callee reachability; generation/initialization semantics; account and credential identity; generation-zero/default compatibility; Vault/profile/runner responsibilities; honest concurrency comments; token JSON/SQLite payloads; launch/retry/finalize parity; and Codex/Kiro/auth/history symmetry. No whole layer was skipped. Windows runtime and full rendered application behavior remain unverified.

## Verification

Final delivery checkout commands and outcomes:

- `cargo test --manifest-path src-tauri/Cargo.toml -p key_vault --lib`: **470 passed, 1 ignored**.
- `cargo test --manifest-path src-tauri/Cargo.toml -p org2 --lib agent_sessions::cli:: -- --test-threads=1`: **539 passed, 9 ignored**.
- `cargo clippy --manifest-path src-tauri/Cargo.toml -p org2 -p key_vault --all-targets -- -D warnings`: **passed**.
- `git diff --check`: passed before commit; normal hooks also run.
- Native Codex **0.154.0**: `python3 docs/architecture-audit-2026-09-20/native_codex_history_probe.py --binary "$CODEX_BINARY"` passed. Two distinct CODEX_HOMEs resumed the same fixture rollout and `thread/read` returned its user and assistant content.
- Native Kiro **2.22.1**: `python3 docs/architecture-audit-2026-09-20/native_kiro_history_probe.py --binary "$KIRO_CHAT_BINARY"` passed again from the delivery checkout: session/new, process exit, then session/load from a different HOME. This checks an empty native session only. A separate content-prompt mock attempt timed out; Kiro message-content continuation is **not verified**.
- Native probes use temporary HOMEs and synthetic credentials with rejecting proxies. They do not use real provider OAuth; proxies are not an OS network sandbox.
- Producing-boundary regressions cover late sync after reconnect, disabled-key health semantics, incomplete/mismatched Codex credentials, raw Kiro JSON/env/legacy shapes, seed-once behavior including malformed DBs, native rotation followed by delayed seeding, and shared history file replacement with isolated auth.
- No additional frontend changes relative to #2015. Its frontend evidence applies to the shared dependency. No Tauri screenshots, Windows runtime, real provider OAuth or full-app CPU/RSS measurements were run.

## Lifecycle and performance

| Area               | Verdict | Evidence                                                          | Change or reason kept                                                                                      | Verification                                        |
| ------------------ | ------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Background work    | fix     | Profile setup does blocking file/SQLite work                      | Bounded setup uses spawn_blocking; locks fail immediately; no new timer/poller/subprocess in production    | Runner inspection and formal CLI tests              |
| Memory             | keep    | No added in-memory cache                                          | Per-launch snapshot released after run; generation directories are durable auth/history state, not a cache | File fixtures; no cleanup of historical credentials |
| Scope/isolation    | fix     | Late child finalize and delayed seed formerly shared account auth | Capture generation and actual launch HOME; guard at Vault writer; separate auth directories                | Reconnect/late-write/raw profile regression tests   |
| Rendering/hot path | keep    | No new UI subscriptions                                           | No frontend changes beyond dependency                                                                      | #2015 frontend checks; rendered measurement not run |

| Provider | Raw transition                                                | App/UI state                       | Topology/boundary                   | Expected invariant                                                | Observed evidence                                         |
| -------- | ------------------------------------------------------------- | ---------------------------------- | ----------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------- |
| Codex    | Native-profile fixture rotation then delayed seed             | Unit fixture, live writer sequence | Local auth file to Vault            | No rollback; generation match required                            | Formal seed/reconcile/sync tests passed                   |
| Kiro     | SQLite token rotation and fresh generation with late old sync | Unit fixture, live writer sequence | Local auth_kv to Vault              | Old profile cannot overwrite new login; initialized auth retained | Formal Kiro adapter and Vault tests passed                |
| Codex    | Existing rollout read across two credential HOMEs             | Native app-server processes        | Local shared sessions directory     | User/assistant history remains resumable                          | Native content probe passed                               |
| Kiro     | session/new then process exit and session/load                | Native ACP processes               | Local shared sessions/cli directory | Native session identity remains loadable                          | Empty-session probe passed; content prompt mock timed out |
| Both     | Reconnect with active/visible/hidden app, then restart        | Rendered Tauri not run             | Full app lifecycle                  | Stable processes, CPU/RSS and visible history                     | Not measured; no full runtime performance claim           |

Performance verdict: **blocked** for full rendered lifecycle/CPU/RSS and Windows measurements; isolated boundary tests do not establish those cells. No cloud transport behavior was changed or claimed.

## Compatibility, risks and recovery

`fs2` moves from a macOS-only root dependency to common dependencies for profile locks on all desktop targets. Windows adds `junction` 1.4.2 so directory sharing does not require symlink privileges; Windows execution remains untested. Unix uses directory symlinks. No new database schema is added; the existing Kiro auth schema remains native-compatible. Generation defaults and private Vault fields are documented in #2015.

Native CLIs do not honor ORG2's locks. Overlapping refresh exchanges and the final content-check/atomic-replace window still exist across native processes. Expiry comparison cannot order equal-expiry access tokens with differing refresh tokens; the existing profile is conservatively retained. Native-provider token reuse/grace policy has not been established by these fixture tests. Initialized but broken Kiro auth surfaces a failure requiring reconnect instead of silently reseeding it.

No historical cleanup was performed. Generation directories are retained rather than risking credentials/history loss. Before downgrade, stop CLI runs and preserve the latest generation's credentials. Older builds use the generation-zero account path; reconnect there if required, without restoring spent tokens. Shared history stays in the account root. Never overwrite a conflicting history directory to recover startup; preserve its contents and resolve the conflict deliberately. No mandatory browser login is introduced for ordinary scan/import/refresh use.

# Paired desktop identity restoration

## Root cause and ownership

The currently running desktop's authenticated `initialize` response omitted `desktopName` and `desktopIdentity`. The installed mobile app already supports those fields but fell back to the stable pairing identifier when neither was available. Pairing credentials were not lost or corrupted.

The OS owns the display metadata. The desktop now collects native hostname, manufacturer model identifier and OS username and returns bounded optional fields through the authenticated bridge. No hardware UUID, serial number, home directory or Cloud account is collected. The Relay transports the response without new server schema or registration changes. Its `/v1/devices` labels describe phones and must not be reused as computer names.

The installed mobile client's paired-desktop inventory owns cached display metadata scoped by the original pairing ID. Successful initialization enriches that existing record; reconnect and old-server responses preserve known metadata. No pairing ID, credentials, permissions or stored historical records are rewritten by this desktop patch.

Dependency: the root desktop package now directly links the existing workspace `sysinfo` version for native queries; no new version is introduced. The lockfile only adds the existing dependency to the root package. Rollback removes the optional response fields, module and direct linkage; it does not require data migration.

## Lifecycle contract

- Successful authenticated initialization: collect native display fields off the async executor, sanitize and return additive optional metadata
- Invalid protocol/disabled feature: retain existing rejection, without disclosing metadata
- Missing or failed collection: initialize still works; absent data remains absent rather than fabricated
- Reconnect: recollect native values so hostname changes can refresh without an app-lifetime cache
- Read-only pairing: identity is readable; execution permissions are unchanged
- Offline/scope switch: installed client retains metadata in the existing pairing-scoped inventory; no new background work

Implementation scope is the current desktop plus the already-installed advanced mobile client from the relay-contract tree. Current-main mobile source consumes `desktopName` in the connection header but predates full device-inventory metadata support. Rebuilding iOS from current main would require a separate targeted consumer migration; this task does not rebuild or downgrade the phone app.

## Review

| Area | Verdict | Evidence | Change or reason kept | Verification |
| --- | --- | --- | --- | --- |
| Background work | keep | One native collection per valid initialize | No timers, scans, subprocesses or polling; off executor | sysinfo native implementation inspected |
| Memory | keep | Three optional labels, each at most 128 characters | No new cache or retained registry | Bounds and serialization tests |
| Scope/isolation | keep | Existing authenticated bridge and paired inventory | Original IDs/credentials unchanged; no cloud identity collection | RPC gating and installed-client scope tests |
| Rendering/hot path | fix | Missing wire fields forced identifier fallback | Restore identity at producing boundary, not UI-only substitution | RPC contract and existing consumer tests |

## Verification

- Installed-client suites in relay-contract: `pnpm exec vitest run --config config/vitest.config.ts` targeting `mobileDesktopIdentity.test.ts`, `mobilePairedDesktopPresence.test.ts`, `MobileRemoteProviders.test.ts`, `tauriMobileRemotePlatform.test.ts`, `DevicesTab.test.ts`: 91 tests passed across five files
- `cargo test -p org2 --lib api::mobile_bridge`: 101 passed, including the native initialized-response contract, metadata bounds, read-only responses and protocol rejection. Initial compilation identified a missing root-package dependency; the direct workspace linkage above fixed it
- `git diff --check`: passed
- No frontend files changed; post-rebase verification was scoped to the Rust producing boundary. The five previously recorded installed-client behavioral suites above passed
- `cargo build -p org2 --bin org2`: passed with the existing large `__eh_frame` linker warning. Current-tree desktop restarted; no old desktop instance left running
- Physical iPhone screenshot after automatic reconnect confirmed the online indicator and the native desktop hostname replaced the previous pairing UUID. Existing session workspace names remain visible. No new pairing or mobile reinstall occurred
- The physical Devices tab model/username detail line was not captured; source/RPC contract and installed-client component/persistence suites cover those fields, but are not a substitute for that final screenshot
- Windows/Linux native metadata and full visible/hidden CPU/RSS lifecycle not measured

Performance verdict: blocked for steady-state visible/hidden lifecycle measurements. The executable build and physical connected-name display passed; no full-app performance or sustained connection-stability improvement is claimed.

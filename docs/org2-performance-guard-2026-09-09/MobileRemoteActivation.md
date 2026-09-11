# Mobile Remote activation migration

## Scope and source

Port only the remote activation repair into the current ORGII working tree. Preserve the existing uncommitted settings redesign: automatic phone naming, collapsed Relay configuration, developer disclosure, and reconnect action. Do not copy the older worktree's component wholesale.

The settings JSONC file is authoritative for configuration. The Relay supervisor owns runtime connection status. Previously the file watcher discarded writes inside a leading-edge 500 ms window, so the supervisor could miss the final enabled snapshot. The settings page independently retained its initial status until manual refresh. Pairing alone does not establish an online desktop connection.

## Lifecycle contract

- Enable Remote: persist master enable, Relay enable, missing default endpoint and missing LAN token in one existing batch write. Preserve custom endpoint and credentials; do not enable LAN exposure.
- Pending save: reject duplicate activation. Failure: keep persisted state, show error, permit retry. Disable: change only master enable, preserving pairing and configuration.
- File burst: retain a bounded dirty marker and read final state after a fixed coalescing window. Ignore access/unrelated events; handle atomic replacement separately from deletion. Stop discards pending work.
- Relay transition: emit a payload-free invalidation after releasing the status lock. The mounted UI subscribes before hydration, serializes reads, rejects stale results and cleans up on scope change/unmount. Error retains known status and permits manual retry.
- No schema migration or historical pairing cleanup. Existing settings are read on startup; no credentials or pairings are deleted.

## Verification

- Five targeted frontend suites: 33 tests passed (settings disclosure/pairing, activation/failure/retry, event-driven status and settings persistence).
- Scoped ESLint and `git diff --check`: passed.
- Frontend development build from the current ORGII tree: passed.
- Post-rebase `node node_modules/typescript/bin/tsc --noEmit --pretty false`: passed.
- `cargo build -p org2 --bin org2`: passed (existing large `__eh_frame` linker warning).
- `cargo test -p settings --lib`: 14 passed, including actual macOS watcher burst/replacement/deletion and shutdown cases. Combined targeted count: 47 tests.
- `cargo clippy -p settings --lib -- -D warnings`: passed.
- Current-tree desktop and frontend launched; process working directories confirmed the current ORGII tree, with no old desktop remaining. Real settings-page screenshot confirmed no phone-name input, collapsed advanced configuration, and remote status **已连接** without toggling switches or re-pairing. Existing device records remained visible.
- Connected iPhone app launch via `devicectl` succeeded. Its resulting conversation list has not been visually confirmed.

## Performance review

| Area | Verdict | Evidence | Change or reason kept | Verification |
| --- | --- | --- | --- | --- |
| Background work | fix | Final settings writes could be discarded | Event-driven bounded coalescing; no added polling | Native watcher tests passed |
| Memory | fix | Raw notification channel was unbounded | One dirty marker and one deadline | Watcher burst/shutdown tests passed |
| Scope/isolation | fix | Late status reads could outlive settings scope | Cancelled generation, listener cleanup, existing credential-aware scope | Status hook tests passed |
| Rendering/hot path | fix | UI only read initial status | Single-flight event invalidation reads | Four hook tests passed |

Performance verdict: blocked for steady-state visible/hidden lifecycle measurements and phone reconnection confirmation. One startup settings-page observation was 30.4% CPU and approximately 1.06 GiB RSS; this is not an idle baseline or an improvement claim. Unit tests do not establish full-app idle performance or phone reconnection after restart. Concurrent desktops sharing one data home are not supported by this change.

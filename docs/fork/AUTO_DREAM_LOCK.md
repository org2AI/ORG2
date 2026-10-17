# Auto-Dream workspace memory — atomic lease upgrade

## Why

The original `.consolidate-lock` protocol wrote the process PID and then read it back. Two parallel tasks in the same process share a PID and could both believe they acquired the lock. On Windows the original PID liveness check always returned false, and mtime restoration was Unix-only.

## Changes (stacked after Branding PR #3)

- Add a distinct **permanent lock inode**: `{workspace}/.orgii/workspace-memory/.consolidate-lease`.
- Hold `fs2::FileExt::try_lock_exclusive` from before the legacy timestamp update until the RAII lease drops. This supplies OS-level advisory file locking across threads and processes on supported platforms.
- The old `.consolidate-lock` retains its previous timestamp+PID format so existing time-gates and persisted records continue to work.
- Replace Unix-specific timestamp rollback with cross-platform `std::fs::FileTimes`.
- Add eight-contender concurrency, same-process reentrancy, and subprocess lock exclusion tests alongside existing commit/rollback tests.

## Invariants / remaining work

1. Never remove or replace the `.consolidate-lease` file while another process may have it open. Keep its inode stable across app restarts; lock is released by the OS after process exit.
2. Only the RAII production entry point holds the lock. The timestamp/PID helper is now private; no product code should bypass the lease.
3. This change does **not** separate per-workspace `.orgii` memory from an upstream ORG2 instance opening the same project. Cross-product workspace metadata requires an opt-in compatibility/migration plan.
4. Crash consistency of the timestamp-based time-gate remains separate from exclusive ownership: a hard process crash may retain a too-recent timestamp; this will need a committed timestamp / in-progress marker split.
5. Run the included separate-process exclusion test on macOS Apple Silicon, Windows 11 and Linux; add *hard-kill/restart* tests and record successful results before shipping.

## Focused check

```bash
cd src-tauri
cargo test -p agent_core specialization::memory::workspace_memory::lock::tests
cargo clippy -p agent_core --all-targets -- -D warnings
```

**These are requested validation commands, not proof that CI has passed.**

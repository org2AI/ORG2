# Multi-session stall and crash-restart recovery

**Status:** source-level reliability changes awaiting CI and high-load reproduction. This is **not** a certified fix for every stall.

## Observed source-level failure paths

1. `DialogScheduler::WorkerTask::run` originally invoked `(msg.execute)()` **outside** `catch_unwind`. A synchronous panic in that factory ended the entire per-session Tokio worker; later queued work could be stranded.
2. The scheduler retained a sender forever but did not check whether its worker had died, so a session could remain unusable without constructing a new session.
3. Executor errors could surface as `agent:error` while a SQLite session record retained `running`, producing a misleading sidebar state.
4. Startup recovery used `?` on the first phase failure, skipping the later, independent `running`-to-`abandoned` cleanup. A bad auxiliary turn-intent table could therefore leave phantom running sessions across restarts.
5. Long-lived futures that never resolve, OS resource exhaustion, third-party provider timeouts, and database contention are **not proven** to be caused by any one of the above.

## Changes on integration PR #9

- Catch both future-factory and future-poll panics, returning a surfaced error without killing the session worker.
- Track the worker task; if it has ended unexpectedly, replace the receiver when the next item is enqueued. Explicitly discard orphaned in-memory messages rather than replaying potentially side-effectful tools.
- Reset queue counters, dedup and intent ownership on failed worker replacement; report the interrupted turn and persist `abandoned` best-effort.
- On ordinary executor failure without an already-terminal, stale, or user-intervention-owned intent, persist session `failed` to avoid phantom `running`.
- Attempt all startup recovery phases even after earlier errors, then aggregate/log failures.
- Add regression tests: synchronous factory panic followed by a succeeding turn; manually aborted idle worker replacement; failed executor clearing a durable `running` session.

## Safe checks for an existing installed app

**Do not delete `sessions.db`, its `-wal`/`-shm` companions, provider credentials, or entire app profiles to clear a stall.** The installed upstream ORG2 binary does not contain this fork patch.

1. Quit the affected app normally. Preserve a copy of its profile folder, ideally after all related processes have exited, before any repair. For upstream this is generally `~/.orgii/`; for the fork's production build the intended default is `~/.tp-agent-studio/`.
2. Check app logs for `[scheduler]`, `[StartupRecovery]`, `database is locked`, `agent:error`, provider timeouts and out-of-memory messages. Redact tokens, URLs with credentials, user prompts and private paths before sharing.
3. If the `sqlite3` command is installed, inspect **read-only** status counts, e.g. after quitting:
   ```sh
   sqlite3 "file:$HOME/.orgii/sessions.db?mode=ro" \
     "SELECT status, COUNT(*) FROM agent_sessions GROUP BY status;"
   ```
   Replace the path with the fork root if diagnosing a built TP Agent Studio. This does not edit or reset rows.
4. Capture exact app build version, OS, physical RAM, number of concurrently active sessions, provider/CLI type and whether creating a *fresh* session works.
5. Never force status changes with raw SQL on production user data. Recovery must use typed session lifecycle transitions and preserve terminal markers/Agent Org ownership.

## Acceptance matrix (pending)

- [ ] Reproduce simultaneous turns (1, 5, 20, 50) with real providers and separately with controlled local simulators.
- [ ] Verify a panic in the synchronous execute factory does not kill the worker or block later queued turns.
- [ ] Verify a killed/aborted worker is detectable, resets non-durable queue state, does not replay side-effectful tools, and accepts a fresh turn.
- [ ] Verify executor failure clears persisted `running` and emits one visible error event.
- [ ] Force auxiliary startup turn-intent recovery to fail and assert independent session status repair still runs.
- [ ] Test long provider timeouts, network disconnects, SQLite writer contention, high memory pressure, app close/kill/relaunch, and cancellation.
- [ ] Confirm macOS M4, Windows 11 and Linux CI, native E2E, side-by-side installation, app data isolation and successful rollback.
- [ ] Verify no automatic cloud login or upstream credential mixing (see `FORK_CLOUD_BOUNDARY.md`).

**Release gate:** Do not merge as a production release or publish installer until the above behavioral and security evidence is recorded. Source modifications alone are not proof that the user's currently installed app is repaired.

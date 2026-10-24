# TP Agent Studio — Provider / Tool / SQLite Fault Injection Lab

**Scope:** deterministic, offline reliability regression tests. All new tests exercise production scheduler or database *primitives* against synthetic callbacks or isolated SQLite fixture databases. No real model provider, external tool subprocess, production DB, account or token is needed.

## Test planner and review ownership

| Workstream / agent lane | Checklist | Evidence / gate |
| --- | --- | --- |
| Rust scheduler | [x] Slow provider callback while 5 neighbor Sessions complete | `slow_provider_future_isolated_from_five_neighbor_sessions` |
| Rust scheduler | [x] Explicit mock provider timeout while FIFO continues | `explicit_mock_provider_timeout_does_not_poison_followup_queue` |
| Rust scheduler | [x] Never-resolving tool future, abort and no replay of queued work | `never_resolving_tool_is_dropped_on_worker_abort_without_replay` |
| Rust scheduler | [x] Tool Error followed by healthy callback | `mock_tool_error_does_not_starve_following_job` |
| SQLite lane | [x] 5/20/50 writer contention through production serializer | `db::writer::fault_injection_tests` |
| SQLite lane | [x] WAL reader retains last committed snapshot during active writer | `reader_is_not_blocked_by_an_in_process_writer_transaction` |
| Team-lead QA gate | [x] Isolation from real user DB and lack of automatic replay reviewed in source | Read fixture path, executor flow and no-replay assertions |
| Team-lead QA gate | [ ] Rust compile and focused tests pass on CI | Verify job logs (not merely branch push) |
| Team-lead QA gate | [ ] macOS and Windows smoke / package compatibility | Cross-platform results needed |
| Release gate | [ ] Real provider/network/SQLite E2E and 30-minute soak | Separate acceptance track |

The workstream labels represent **review responsibility**, not independent human approvals or a claim that distributed execution agents were run.

## Focused commands

Run after dependency installation and compilation:

```bash
cd src-tauri

# Actual DialogScheduler, simulated Provider and Tool callbacks.
cargo test -p agent_core --lib session::scheduler::fault_injection_tests -- --nocapture

# Isolated SQLite WAL database, production process-wide mutex and IMMEDIATE transactions.
cargo test -p database --lib db::writer::fault_injection_tests -- --nocapture

# Combined synthetic multi-session FIFO, cancellation, abort and overload scenarios (PR #20).
cargo test -p agent_core --lib session::scheduler::stress_tests -- --nocapture
```

The repository's default CI Rust job runs workspace tests on macOS after all-target Clippy; its Windows job compiles the Rust workspace. A passing fast frontend check alone does not prove these Rust tests ran.

## What the tests validate

- **Slow provider:** one scheduler's awaiting callback does not stop five independent schedulers. The blocked session's own FIFO follow-up must remain queued until the provider callback is released.
- **Mock provider timeout:** an intentionally bounded `tokio::time::timeout` in the **test callback** returns a synthetic error; a queued follow-up still executes. This does **not** alter the production HTTP timeout policy.
- **Nonreturning tool:** `pending()` models a future with no completion. Explicitly aborting the owning scheduler task must drop it once, while a separate healthy worker still executes. The prior queue's contents are discarded rather than automatically replayed; only a fresh enqueue can create replacement work.
- **Tool error:** a synthetic failure from one maintenance-kind callback must not poison later FIFO jobs; the real production Turn's persistent error/approval rules remain a separate E2E acceptance task.
- **SQLite 5/20/50:** each test opens a fresh private `tempfile::TempDir` database; N OS threads share the actual in-process `with_sessions_writer` serialization and `begin_immediate` transaction helper. Verify exact per-session row counts and `PRAGMA integrity_check='ok'` after joining all writers.
- **WAL snapshot:** readers must see last committed data while a writer has an uncommitted transaction; readers should observe the new row after commit.

## Limitations and safety

- All synthetic scheduler callbacks use the **Maintenance** kind deliberately so scheduler error behavior can be tested without attempting to change the durable user-facing Turn state. Production Turn cancellation/approval semantics remain unverified by these tests.
- The SQLite file lives in a unique OS temporary directory. **Do not** substitute a path to the user's live `sessions.db` or reset the application's connection pool.
- A single global writer mutex only coordinates threads **inside one process**. Another app process may still contend on SQLite file locks and requires separate cross-process tests.
- Hard-stop or abort of a tool future does not guarantee that an external side effect did not already occur. These tests forbid automatic replay and do not add automatic recovery.
- A test passing on 50 synthetic workers or 50 small SQLite transactions does not certify real 50-agent load, provider costs/rate limits, 30-minute sustained reliability or all OS builds.
- The focused Rust tests are bounded by 10-second executor deadlines and 20-second per-writer waits; cold compilation may take much longer. A failing deadline should be investigated, not hidden by retries.

## Final acceptance still open

- [ ] Actual Rust compilation and unit-test pass evidenced by CI logs
- [ ] Rustfmt and Clippy warnings-denied pass on final branch HEAD
- [ ] Windows Rust compilation and Linux native verification
- [ ] Multi-process database contention with ownership and kill/restart tests
- [ ] Real provider/tool/SQLite fault injection and UI E2E smoke
- [ ] Sustained load for 1/5/20/50 real Sessions with memory, CPU, queue latency and SQLite instrumentation
- [ ] Human independent review, merge order, production package signing and release readiness

Related: [Multi-Session Stress Lab](MULTI_SESSION_STRESS_LAB.md) and [Fork Roadmap](ROADMAP.md).

# TP Agent Studio — Multi-Session Stress Lab

**Goal:** exercise the real Rust `DialogScheduler` with concurrent Session
workers under controlled, bounded loads. These are **synthetic, offline**
tests: no paid providers, actual tools, subprocesses or user credentials.

## Run

From the repository root:

```bash
cd src-tauri
cargo test -p agent_core --lib session::scheduler::stress_tests -- --nocapture

# One specific load profile, useful when debugging:
cargo test -p agent_core --lib session::scheduler::stress_tests::fifty_sessions_run_in_parallel_and_keep_fifo -- --exact --nocapture
```

A cold Rust compile can take significantly longer than the test execution.
Every scenario has a bounded 20-second in-runtime wait so a deadlocked
fixture fails rather than occupying CI indefinitely. Review the exit code.

## Test matrix

| Scenario | Synthetic load | Guarantee checked |
| --- | --- | --- |
| Baseline | 1 Session / 2 Turns | FIFO: second waits for first |
| Multi-5 | 5 Session workers / 10 Turns | Actual cross-session overlap; per-session FIFO |
| Multi-20 | 20 workers / 40 Turns | No cross-session serialization |
| Multi-50 | 50 workers / 100 Turns | All first Turns overlap, all second Turns drain once |
| Targeted cancellation | 5 active workers / 1 cancelled queued Turn | Cancellation stays within its Session |
| Worker abort | 2 workers, one force-aborted | Neighbor still finishes; lost work never replayed |
| Queue pressure | 1 busy worker, queue capacity 2 | Third pending message rejected; accepted work drains |

The concurrency tests use actual Tokio task scheduling and
`DialogScheduler::enqueue()`. A barrier ensures that every first job
has reached a suspended execution boundary before any is released.
Per-session atomic state confirms the second job cannot run early.
The scheduler catches panics, so violations are recorded explicitly
rather than trusting panics to escape.

## Important limitations

- Passing 50 **synthetic** Tokio jobs does **not** prove 50 real provider
  connections, high-token contexts or filesystem-changing tools are safe.
- No full-app frontend, sustained soak, process memory, real SQLite
  contention, tool effects, crash/restart or installer acceptance is covered.
- A crashed worker's abandoned queued jobs are **not replayed automatically**.
  Replaying side-effectful tool work could duplicate external actions.
- First-time Rust dependency compilation may dominate CI timing. Do not skip
  failed tests or raise timeouts merely to obtain a green status.

## Acceptance roadmap

- [x] Add synthetic 1/5/20/50 scheduler profiles.
- [x] Add targeted-stop isolation, dead-worker isolation and queue overload.
- [ ] Verify focused Rust tests pass on CI (macOS/Windows/Linux).
- [ ] Fault-inject slow/failed providers, network, tools and SQLite contention.
- [ ] Validate 50 genuine Sessions with CPU, RAM, file descriptor and
  latency telemetry over a 30-minute sustained workload.
- [ ] Verify full desktop shutdown/restart recovery and side-by-side
  fork profile isolation on macOS M4, Windows 11 and Linux.

See [Reliability roadmap](ROADMAP.md).

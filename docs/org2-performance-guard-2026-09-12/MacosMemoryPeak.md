# macOS memory peak sampling

## Failure and authoritative boundary

The macOS workspace test failed because it assumed that two raw `proc_pid_rusage(RUSAGE_INFO_V4)` fields form an atomic snapshot. Apple's XNU [`gather_rusage_info`](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/kern/kern_resource.c#L3348) reads the lifetime peak in its V4 case before falling through to V0. That later calls [`fill_task_rusage`](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/osfmk/kern/bsd_kern.c#L1249), which reads the current footprint. Concurrent allocations can therefore make the second field exceed the earlier peak.

A bounded native C probe reproduced this on macOS 26.2 / Apple M3 Pro: one thread touched a 64 MiB allocation while another made 100,000 V4 calls. In 1,236 samples the raw peak was below current, with a maximum gap of 16,408 bytes. The first pair was peak 950,584 / current 966,968. The process then joined its allocation thread and exited. This verifies the invalid test assumption independently of ORG2; the frequency is scheduling-dependent, not a benchmark.

Production path: `get_app_memory_snapshot_v1` → existing blocking snapshot worker → `build_process` → macOS `collect_effective_memory` → `effective_memory_from_rusage`. That conversion now returns `max(reported_peak, current)` when the OS reported a nonzero peak. The current footprint is itself an observation of the process lifetime, so it belongs in a known lifetime maximum. A zero peak still produces `None`, preserving the unavailable contract. The raw `rusage_info_v4` stays unchanged.

There are no persistence writes or historical records to clean. The IPC field and schema version stay unchanged. The existing UI describes this field as the lifetime peak, so the conversion restores that invariant without changing UI rendering or inventing a peak for unsupported metrics.

## Performance and lifecycle review

| Area               | Verdict | Evidence                                                 | Change or reason kept                                                                               | Verification                                                        |
| ------------------ | ------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Background work    | keep    | Existing demand-driven snapshot worker owns all OS reads | No new read, retry, timer, task, or polling cadence                                                 | Production call-chain inspection                                    |
| Memory             | fix     | Native peak/current counters are read at different times | One stateless maximum operation; no allocation, cache, or retained state                            | Deterministic reordered-counter fixture and live process conversion |
| Scope/isolation    | keep    | Conversion consumes one process's existing sample        | Birth token and process attribution unchanged; no cross-process or cross-instance aggregation added | Fixture asserts birth token and current value unchanged             |
| Rendering/hot path | keep    | UI receives existing schema-v2 fields                    | No component, subscription, streaming, or serialization-shape changes                               | Existing wire-contract tests                                        |

Visible/hidden/focus, online/offline, identity and endpoint switches, session deletion, and primary/secondary lifecycle retain the existing sampler behavior: this change owns no lifecycle resource. Only macOS V4 conversion changes; Linux and Windows implementations are untouched. No CPU or RAM improvement is claimed, and a new full Tauri lifecycle benchmark would not measure the changed integer operation meaningfully.

Architecture scope: compilation and production call-chain wiring, peak terminology, unavailable default, platform ownership, IPC compatibility, real-sample test parity, and field preservation were reviewed. Unrelated UI, agent/provider state machines, and session persistence were intentionally excluded from this focused fix.

## Verification

- Native C probe: reproduced the raw counter ordering violation and exited cleanly as described above.
- Deterministic regression covers peak below/equal/above current and zero/unavailable, while checking the current metric, process identity, breakdown, and raw sample remain unchanged.
- The existing live-process smoke test checks both positive native counters and the normalized production `AppMemoryProcess` invariant.
- `cargo test --manifest-path src-tauri/Cargo.toml -p perf_utils --lib`: **65 passed, 1 ignored** (the existing opt-in live-PID probe). This includes the conversion regression, live process smoke test, region walk, ownership, aggregation, and wire-contract tests.
- `cargo clippy --manifest-path src-tauri/Cargo.toml -p perf_utils --all-targets -- -D warnings`: **passed**. Both Cargo commands used an isolated target directory and `CARGO_BUILD_JOBS=2`.
- `rustfmt --edition 2021 --check src-tauri/crates/perf-utils/src/app_memory/platform/macos.rs`: **passed**.
- `git diff --check`: **passed**.
- No frontend source changed, so TypeScript lint/typecheck and UI screenshots are not applicable. Full workspace tests are left to CI; Windows/Linux execution was not repeated because their platform implementations are unchanged.

Performance verdict: pass for this bounded macOS conversion change. The production collector and live OS sample are covered; no runtime resource lifecycle changed and no performance improvement is claimed.

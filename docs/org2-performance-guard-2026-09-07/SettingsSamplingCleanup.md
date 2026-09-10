# Retired settings sampling lifecycle

| Area               | Verdict | Evidence                                                                                                          | Change or reason kept                                                                                     | Verification                                                      |
| ------------------ | ------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Background work    | fix     | detect_vpn spawned platform interface inspection; tool diagnostics spawned process inventory/ownership collection | Removed commands and exclusive implementations; prior turn removed frontend polling and fetch interceptor | Zero-reference sweep across src, src-tauri, scripts, tools, tests |
| Memory             | fix     | Tool-only diagnostic wire objects and virtual-memory descriptor field had no remaining consumer                   | Deleted Rust/TS types, exports, descriptor field, and fixture value                                       | Shared app-memory tests; typecheck                                |
| Scope/isolation    | keep    | App snapshot ownership and region/LAN callers still have live non-settings consumers                              | Shared collectors, cache keys, ownership rules, and region lookup retained                                | Source call-chain trace                                           |
| Rendering/hot path | keep    | No new frontend runtime path                                                                                      | Only unused types removed this turn                                                                       | 8 shared-memory tests passed                                      |

Lifecycle matrix: removed commands cannot initiate work from a rebuilt app in any visible/hidden, active/idle, signed-in/out, or open/closed state. They were request-triggered, not independently running background jobs. Retained samplers keep their previous lifecycle. No new CPU/RAM improvement claim, transport/identity change, or historical remediation.

Verification:

- `pnpm typecheck:fast` — passed
- `pnpm exec eslint src/hooks/perf/appMemorySnapshot.ts src/hooks/perf/index.ts --max-warnings 0` — passed
- `pnpm test src/hooks/perf/appMemorySnapshot.test.ts src/hooks/perf/runtimeMemoryStats.test.ts` — 8 tests passed
- `rustfmt --edition 2021 --config skip_children=true --check` on all five changed Rust source files — passed
- `git diff --check` — passed
- `cargo check -p perf_utils -p system_services --tests --offline` — passed without warnings after scoping descendant_depth and its collection imports to non-macOS consumers
- `cargo test -p perf_utils --lib --offline` — 64 passed, 1 ignored
- `cargo test -p system_services --lib network::lan_ip_tests --offline` — cancelled while waiting on the shared build lock after recurring app rebuilds; test body did not run

Real desktop lifecycle measurements and cross-platform builds not run. User requires explicit computer-control opt-in; changes are source-level deletions. Performance verdict: blocked for real desktop measurements; no GUI was exercised and no measured performance gain is claimed. Rust compilation and retained performance tests passed.

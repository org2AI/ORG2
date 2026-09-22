# Codex sleep import

The authoritative Codex JSONL contains `function_call(name=sleep, namespace=clock, arguments={duration_ms:45000})` and a matching `function_call_output`. Dispatch lacked a sleep mapping; wrapped calls also lacked duration extraction. The new source projection emits `await_output(command=wait_for, block_until_ms=duration_ms)` and preserves source identity, original duration, call ID, and output. Invalid durations remain generic diagnostics. No persisted source is changed or deleted; historical JSONL is normalized on its next read.

The existing title adapter now recognizes the sleep duration and both `Wall time 1.0 seconds` and `Wall time: 45.0141 seconds`. Actual elapsed time takes precedence, including interrupted sleeps; requested duration is the fallback. Single tasks use count-free labels in every locale; Simplified and Traditional Chinese wait labels omit spaces, including when multiple tasks retain their counts. No action controls changed.

| Area               | Verdict | Evidence                                                                   | Change or reason kept                                                                                       | Verification                                                          |
| ------------------ | ------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Background work    | keep    | Parser is synchronous projection; completed events do not enable countdown | No new timers, scans, subscriptions, I/O, or retries                                                        | Source inspection; completed render tests                             |
| Memory             | keep    | Constant fields per existing call; no added retained collections           | Existing transcript ownership unchanged                                                                     | Source inspection                                                     |
| Scope/isolation    | keep    | Native event and call IDs retained; no fabricated shell session ID         | No new cache or identity keys                                                                               | Raw JSONL regression                                                  |
| Rendering/hot path | fix     | Sleep dispatch and wall-time parsing fell through                          | Reuse existing wait presentation; existing countdown is visibility-aware and disposed on completion/unmount | Render tests for completed, interrupted, and missing wall-time output |

| Provider | Raw transition                | App/UI state      | Topology/boundary        | Expected invariant                                           | Observed evidence                       |
| -------- | ----------------------------- | ----------------- | ------------------------ | ------------------------------------------------------------ | --------------------------------------- |
| Codex    | Completed call/output fixture | Cold source read  | Local parser             | One wait event, unchanged identity and output                | Rust regression                         |
| Codex    | Qualified and wrapped sleep   | Parser invocation | Local wrapper/normalizer | Duration survives extraction; unrelated waits stay unchanged | Rust regression                         |
| Codex    | Existing completed event      | Static renderer   | Local presentation       | Waited label with actual elapsed duration                    | Seven rendering/localization cases      |
| Codex    | Live append/restart           | Live Tauri        | Desktop UI               | Correct hydration after reload                               | Not run; desktop control not authorized |

Validation:

- `cargo test --manifest-path src-tauri/Cargo.toml -p orgtrack_core --lib sources::codex:: -- --nocapture`: 103 passed, 3 ignored on the isolated branch
- `pnpm exec vitest run --config config/vitest.config.ts --maxWorkers 1 --minWorkers 1 src/engines/ChatPanel/rendering/adapters/TitleOnlyAdapter.codexWait.test.ts`: 7 passed (explicit worker limits avoid the local default min/max worker conflict)
- `pnpm exec eslint src/engines/ChatPanel/rendering/adapters/TitleOnlyAdapter.tsx src/engines/ChatPanel/rendering/adapters/TitleOnlyAdapter.codexWait.test.ts`: passed
- `pnpm exec tsc --noEmit --pretty false`: failed on the unrelated error below
- `git diff --check`: passed
- Normal commit hooks: staged oxlint, ESLint/Prettier, and scoped `cargo clippy` passed; `tsgo` reported only unstaged-file errors

Typecheck is blocked by an unrelated ref-type error in `src/components/SearchInput/SearchInput.test.ts:79`. No CPU/RSS improvement is claimed. No cache, scan, sync, or identity lifecycle was changed, so compaction, rotation, account switching, and multi-machine transport are outside this fix's coverage.

Performance verdict: blocked for full runtime verification (desktop lifecycle not exercised and repository typecheck has an unrelated failure). Source review found no additional background resource or retained-state growth.

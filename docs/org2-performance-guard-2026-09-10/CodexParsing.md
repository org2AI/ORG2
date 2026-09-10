# Codex command and output parsing

Scope: the Codex Desktop wrapper scanner, multiline shell decomposition, and output partitioning. These are synchronous helpers invoked by the existing transcript reader; no new cache, subscription, timer, task, or persistence format is introduced.

## Changes

- Borrow wrapper names, argument expressions, and command-line slices instead of constructing intermediate strings. Single-line commands skip the shell scan.
- Preserve heredocs, compound commands, continued pipelines, and incomplete quoted scripts as one invocation. Backslashes inside single quotes remain literal.
- Partition bounded read output with a forward iterator and byte offsets. Copy the final remainder directly instead of indexing every output line.

The scanner remains a conservative recognizer, not a complete JavaScript or shell grammar. Unrecognized complex shell syntax should remain an intact command. Existing exploration decomposition tests remain covered.

## Measurements

Local optimized Rust microbenchmark, extracted before/after helper implementations, counting allocations with the same allocator wrapper. Time is the median of five batches of 1,000 calls. Inputs and outputs were compared for the unchanged split/partition cases. Concurrent desktop/build activity makes small timing differences inconclusive.

| Case                                                          | Allocations before / after | Allocated bytes before / after | Time per call before / after  |
| ------------------------------------------------------------- | -------------------------- | ------------------------------ | ----------------------------- |
| Split 1,000 printf lines                                      | 1,012 / 9                  | 66,002 / 32,704                | 63.24 / 39.63 microseconds    |
| Extract one wrapper carrying those lines                      | 3 / 1                      | 19,102 / 128                   | 12.45 / 11.94 microseconds    |
| Partition 100,000 Unicode output lines after a 10-line prefix | 20 / 4                     | 6,094,320 / 1,900,080          | 1,971.85 / 44.97 microseconds |

The last case benefits particularly from avoiding a scan of the large final remainder. Allocated bytes are cumulative allocator requests, not peak RSS. No whole-app latency or CPU improvement is claimed.

## Performance guard

| Area               | Verdict | Evidence                                                           | Change or reason kept                      | Verification                                  |
| ------------------ | ------- | ------------------------------------------------------------------ | ------------------------------------------ | --------------------------------------------- |
| Background work    | keep    | Existing command handler owns synchronous parsing in blocking work | No scheduling/lifecycle change             | Call-chain inspection                         |
| Memory             | fix     | Per-call strings and full output-line vector                       | Borrow slices; eliminate line index        | Allocation benchmark; byte-exact output tests |
| Scope/isolation    | keep    | Helpers receive one caller-owned string; no shared mutable state   | No identity/cache change                   | Source inspection; repeat-read tests          |
| Rendering/hot path | fix     | Transcript parsing feeds canonical activity chunks                 | Preserve shell structure and reduce copies | Parser regression suite and microbenchmark    |

| Provider      | Raw transition                                  | App/UI state                     | Topology/boundary      | Expected invariant                                               | Observed evidence                               |
| ------------- | ----------------------------------------------- | -------------------------------- | ---------------------- | ---------------------------------------------------------------- | ----------------------------------------------- |
| Codex Desktop | Call, partial output, batched completion append | Parser reads before/after append | Local JSONL ingestion  | One command per heredoc; successful completion paired correctly  | Regression fixture, including two final rereads |
| Codex Desktop | Multiline command/output parse                  | Parser-only                      | Local normalization    | Quoted newlines, Unicode, CRLF, empty/truncated output preserved | Targeted tests                                  |
| Codex         | Rotation, compaction, turn windows              | Parser-only                      | Existing local readers | Existing reader behavior retained                                | Existing Codex suite                            |

Desktop rendering, remote synchronization, and other providers were not exercised; their code is unchanged. No destructive historical remediation is needed. Reloading source-backed history with the updated backend applies the new projection.

## Verification

- `cargo test --manifest-path src-tauri/Cargo.toml -p orgtrack_core sources::codex --lib`: 88 passed, 1 opt-in fixture test ignored
- The final isolated PR worktree reran the complete Codex suite after the continued-pipeline guard: 88 passed, 1 opt-in fixture test ignored.
- `cargo clippy --manifest-path src-tauri/Cargo.toml -p orgtrack_core --lib -- -D warnings`: passed
- `git diff --check`: passed

Performance verdict: pass for the local parser helpers. No desktop or cross-machine performance claim is made.

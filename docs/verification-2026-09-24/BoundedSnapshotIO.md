# Bounded immutable snapshot I/O

## Problem and ownership

The durable snapshot row is authoritative after first capture. The previous native path simultaneously held a complete file buffer, SQLite pages and a complete base64 response. The WebView then decoded another whole response. A three-file 32 MiB desktop scenario measured native RSS up to 585.0 MiB during reads. This was a real retained-memory defect, not a justification to stop publishing assistant outputs.

Capture now keeps the private OS snapshot handle, hashes it first and then fills a SQLite incremental blob through a 256 KiB buffer. Writing the hash before blob population avoids rebuilding the whole blob-bearing row in a subsequent metadata UPDATE. This uses two sequential passes over the same immutable handle, never a second read of the mutable source path. A new chunk RPC returns at most 256 KiB of raw bytes per request. The delivery worker reads sequentially into one size-bounded frontend array, rejects changed receipts and invalid chunk boundaries, verifies the full SHA-256, and checks lifecycle cancellation around IPC and hashing. It never returns to the mutable source path. Capture, chunk reads and acknowledgement/release transactions use a connection-local 2 MiB SQLite page-cache target and shrink/restore that policy before returning the exclusively borrowed connection to the pool.

The database receipt format and first-capture identity are unchanged. Startup atomically replaces the three quota-accounting triggers inside a savepoint, preserving existing rows and usage totals. The new triggers use captured status and recorded size instead of referencing the blob value, which otherwise forces SQLite to materialize `OLD.bytes` during release. Both old and new writers use the same status transitions, so older binaries can still operate on these receipts. Rolling back trigger definitions is optional for compatibility and restores the original memory cost. Enabling rusqlite's existing `blob` feature introduces no dependency version change. The new IPC command is additive; the legacy full-read command remains for compatibility and still allocates a full response. The active delivery worker uses only the chunk command. Rolling back the frontend/backend together preserves existing receipts. This does not reconstruct historical event-time file versions: capture still occurs at delivery handoff.

## Limits and tradeoffs

The 2 MiB setting is a SQLite page-cache target, not a total-process hard cap. SQLite operations, the OS allocator and WebKit still have their own working sets. The frontend retains up to the existing 32 MiB file limit; network upload still creates base64/JSON payloads and is not streaming. Hashing before insertion adds one bounded sequential read of the private snapshot. Sequential IPC increases request count and may increase transfer latency. Existing 256 MiB pending-byte and per-file limits remain unchanged. No production migration, cloud write, model call or historical cleanup is part of this performance patch.

## Lifecycle and architecture review

| Area               | Verdict | Evidence                                                | Change or reason kept                                              | Verification                                     |
| ------------------ | ------- | ------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------ |
| Background work    | fix     | delivery AbortSignal crosses snapshot reads             | stop after current IPC; no new timer or worker                     | cancellation regression                          |
| Memory             | fix     | complete native buffers and pool page cache             | bounded blob/IPC chunks; temporary cache policy covers release too | native chunk/cache tests and desktop measurement |
| Scope/isolation    | keep    | endpoint/user/org/session/path/revision selects receipt | preserve existing identity and immutable first capture             | wrong-scope, replacement and deletion tests      |
| Rendering/hot path | keep    | all SQLite work runs off the async/render thread        | no component changes or eager attachment previews                  | production IPC through real WebView              |

Architecture layers covered: compilation (1), resource ownership/deduplication (2), naming (3), snapshot/chunk semantics (4), absent/invalid/cancelled defaults (5), native/frontend boundaries (6), bounded helpers (7), additive IPC and unchanged database format (8), capture/read/release entry parity (9), and exact receipt/hash resolution (10). No action controls or form fields changed.

## Automated verification

- `node_modules/.bin/vitest run --config config/vitest.config.ts src/features/Org2Cloud/conversationFileSnapshot.test.ts src/features/Org2Cloud/conversationFileDelivery.test.ts src/features/Org2Cloud/sharedSessionFilesClient.test.ts` — 44 passed.
- `cargo test --manifest-path src-tauri/Cargo.toml -p org2 --lib shared_file_outbox -- --nocapture` — 20 passed, covering immutable capture, multi-chunk reads, hash/length/offset bounds, identity separation, lease/release, cache-policy restoration and persisted-trigger upgrade/reinitialization.
- `cargo clippy --manifest-path src-tauri/Cargo.toml -p org2 --all-targets -- -D warnings` — passed.
- `node_modules/.bin/tsgo --noEmit --pretty false`, changed-file ESLint and `git diff --check` — passed.

## Desktop measurement

The private WDIO harness uses an isolated macOS debug Tauri instance, sanitized provider environment, mock provider and offline login. The final run integrates the storage-isolation patch for safe testing; an earlier combined run also included the visible-startup patch. Those patches are removed from this PR. It captures three 32 MiB versions, overwrites and deletes the source, reads each receipt twice through the real frontend reader and native IPC, independently checks bytes/hash, acknowledges local delivery and verifies bytes are released. A 50 ms sampler observes the native process only; WebKit/helper-process memory and cloud transport are outside this measurement.

Final results from `python3 /tmp/org2-bounded-snapshot-runtime-complete/run.py` (private temporary harness, 1 spec passed in 101 seconds) follow below. Earlier 585.0 MiB baseline used the same host, file count and file sizes but a different debug build/process; absolute RSS differences are observations, not a controlled production benchmark. There is no physical two-machine or rendered remote-attachment acceptance claim.

## Investigation cells

The first chunked run still raised native RSS by approximately 64 MiB during capture. A statement-level review found the post-write `UPDATE sha256` rebuilding the row containing the 32 MiB blob. The final implementation hashes the private handle before INSERT; the repeat scenario verifies that this capture increase disappears. Settlement originally retained the general page cache, so the complete acknowledgement transaction now gets the same temporary cache policy as capture/read. A later run isolated a remaining 32 MiB release allocation to the quota trigger's `OLD.bytes` reference. A minimal SQLite experiment measured 32.0 MiB additional peak RSS with that reference and 0.0 MiB with status-only accounting, with identical zero usage after release. The final trigger upgrade removes blob-valued trigger arguments and is covered by a persisted-receipt/reinitialization test.

A combined rerun aborted before attachment phases because `tauri-plugin-webdriver-automation 0.1.3` panicked on `no pending script with that id`, then poisoned its pending-script mutex. This is an OPEN test-driver defect, not a passing run or evidence of attachment failure. Its external dependency was not patched in this PR. The earlier hidden-refresh scenario passed; subsequent memory-only runs use a separate isolated process without that refresh. All test-owned processes are stopped and temporary build configuration is restored afterward.

| Phase             | Native peak RSS (MiB) | Native ending RSS (MiB) | Elapsed (ms) | Mean native CPU (%) |
| ----------------- | --------------------: | ----------------------: | -----------: | ------------------: |
| baseline-idle     |                 244.3 |                   242.5 |        20008 |                0.05 |
| capture-0         |                 243.1 |                   243.1 |          213 |               93.90 |
| capture-1         |                 243.1 |                   243.1 |          221 |               90.50 |
| capture-2         |                 244.1 |                   244.1 |          215 |               93.02 |
| read-0            |                 244.8 |                   244.8 |         1448 |               89.09 |
| read-1            |                 244.8 |                   244.8 |         1467 |               88.62 |
| read-2            |                 245.1 |                   245.1 |         1491 |               88.53 |
| read-3            |                 245.1 |                   245.1 |         1488 |               89.38 |
| read-4            |                 245.1 |                   245.1 |         1493 |               89.75 |
| read-5            |                 245.1 |                   245.1 |         1461 |               89.66 |
| release           |                 245.5 |                   245.5 |           56 |               89.29 |
| post-release-idle |                 245.6 |                   245.4 |        20007 |                0.05 |
| hidden-idle       |                 245.8 |                   245.7 |        20007 |                0.15 |

All six 32 MiB reads matched the original hash after overwrite and deletion. Acknowledgement cleared stored bytes and retained uploaded receipts. Reads took 1,448–1,493 ms; the earlier whole-response baseline took 881–897 ms. The latency tradeoff is explicit. Capture/read/release stayed around 243–246 MiB, compared with the earlier 585.0 MiB read peak. Neither number includes WebKit; there is no claim about cloud-upload or total app memory. The quota trigger correction removed the remaining 32 MiB release step seen in the preceding run.

Performance verdict: pass for the measured macOS native capture/read/release/visible-idle/hidden-idle lifecycle. Physical two-machine acceptance, cloud transport memory, WebKit memory and other platforms remain uncovered.

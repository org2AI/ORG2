# Continuation file delivery: durable jobs and immutable capture

Date: 2026-09-24. This document supersedes the path-only handoff described in #2128 for the continuation-output path. It does not claim that replay capture, historical link resolution, cloud manifests, or production rollout are complete.

## Authority, cause, and invariant

The original publisher pushed body events, awaited file capability/read/upload, and only then allowed `coordination.finish`. Network and quota failures could hold or fail successful execution. #2128 separated transmission into a durable local queue, but kept only source path and event revision. A delayed retry could therefore upload a later version of that path.

The new producing boundary persists the body and then captures each automatically discovered output before completing the local durable handoff. The authoritative captured bytes and receipt live in `sessions.db.cloud_file_snapshots`. Upload workers read only these bytes, never the original path. The first committed receipt for endpoint/user, organization, cloud root, path, and event revision wins. Repeated publication, restart, source overwrite, and source deletion cannot replace it.

Assistant Markdown links, `[file:…]`, and shell artifacts still enter automatic collection. No write-tool allowlist or manual attachment is introduced. Original canonical/provider-native event text remains untouched.

## Capture contract and platform boundaries

- Capture one bounded regular file at a time, with the existing 32 MiB per-file limit. A process-wide semaphore owns capture concurrency. The blocking worker owns its permit until actual completion, including after caller cancellation.
- macOS uses `fclonefileat` on an opened descriptor: APFS copy-on-write bytes survive source replacement and concurrent later writes. Temporary names are private and removed through RAII.
- Linux uses `FICLONE`; the filesystem and temporary destination must support compatible CoW cloning. Unsupported/cross-volume capture records `atomic_capture_unsupported`. **There is no ordinary streaming-copy fallback**, because timestamps do not establish a coherent point-in-time version.
- Windows opens a read handle with only `FILE_SHARE_READ`, excluding incompatible write/delete access while copying. Busy sources fail explicitly. Windows/Linux paths require their own native runtime acceptance; macOS tests do not prove those platforms.
- Missing, invalid, oversized, unsupported, busy, or local-budget-exhausted capture persists a failure receipt. It does not turn provider success into failure or silently capture a different version later. A new delivery revision is required to deliver a replacement.
- Capture time is recorded. This guarantees bytes after capture, not that a delayed publication discovered the exact bytes at the earlier tool/event timestamp. This path captures at continuation handoff after body publication; event-time capture and historical provenance remain separate work.

## Storage, budget, and release

A new table is created alongside the existing outbox; no old table is rebuilt, no user history is scanned, and no existing journal is deleted. Receipts store capture state/time, SHA-256, size, and bytes. No credentials or transcripts are stored. Read RPCs verify the stored hash before returning base64 bytes.

Pending captured bytes have a local 256 MiB safety budget, separate from all cloud entitlements. It bounds this initial SQLite staging implementation, not the user's plan or number of files. Admission under the writer transaction prevents concurrent captures from exceeding it. Transactional triggers maintain a singleton byte counter, so each admission reads one row rather than aggregating an ever-growing receipt history. Existing bytes are never evicted to admit new captures. Budget exhaustion records failure; configurable disk budgets and sender management UI remain necessary before treating this as the full storage design.

Successful server confirmation releases local bytes in the same transaction that acknowledges the leased outbox job; the compact receipt/hash remains so repeated publication cannot recapture later content. A stale lease cannot release bytes. Retry/quota/cancellation retain bytes. SQLite may retain reusable freed pages; this is not a promise that the file shrinks immediately. The durable receipt ledger is history, not an in-memory cache; lifecycle/retention for its metadata remains open.

Capture failure retires the transmission task while preserving its failure receipt. Transient IPC/database errors propagate and retry; they must not be confused with a durable capture failure. A missing receipt for an older path-only job is explicit `not_captured`: no automatic historical recapture or source fallback.

The native 256-item IPC maximum remains a transient serialization bound, not a total attachment limit. The producer now submits one file per IPC, checks identity before the next capture, and wakes uploads after each durable handoff. This permits transmission to release staging bytes while the remaining outputs are captured. Captures are sequential per process. Database reads/hash/base64 work run off the render thread; file capture runs outside the sessions writer lock. Snapshot reads do not acquire that writer lock.

## Completion and lifecycle

Flow: publish body → signal readable body → capture/save receipts → persist file jobs → finish turn. Network upload is independent. Local journal persistence failure still keeps the same accepted turn in publication recovery, without provider re-execution or fabricated failure text.

Input files required for execution retain their existing dependency. Replay and explicit-comment file paths retain their existing readers; this PR does not claim to fix their historical byte semantics. The receiving path-based viewer can still select the latest remote revision; exact event-to-attachment projection is not implemented here.

The existing sync engine owns transmission start/stop, one file slot, lease arbitration, bounded drains, backoff, and wakeups. Empty queues do not poll. Hidden/offline/stopped/changed-identity consumers abort transmission and reject stale results. Captures already executing finish their local receipt under the original scope; they cannot upload under a new account. Tauri peer events cover windows in one application, not a cross-process bus.

## Architecture checks

| Layer               | Coverage                                           | Evidence or limitation                                                         |
| ------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------ |
| 1 Compile           | TS/Rust changes and tests                          | Final command outcomes recorded in PR                                          |
| 2 Structure         | Producer, outbox, capture, transport reader        | One capture store; injected reader reuses upload protocol                      |
| 3 Naming            | captured/uploaded/not_captured/capture_failed      | Capture failure is distinct from transport retry                               |
| 4 Semantics         | Event revision, capture time/hash, turn completion | No event-time or historical-original guarantee                                 |
| 5 Defaults          | Missing/corrupt/released/unsupported bytes         | No source-path fallback; no timestamp-only coherence claim                     |
| 6 Boundaries        | Disk/SQLite versus network versus execution        | Capture failure is file state; storage handoff failure is publication recovery |
| 7 Understandability | This contract and explicit platform limits         | No new sender status UI                                                        |
| 8 IPC               | Scoped snapshot read and capture_failed outcome    | Native and frontend ship together; cloud wire unchanged                        |
| 9 Initialization    | Shared outbox init calls snapshot DDL              | Production and isolated command tests use the same initialization              |
| 10 Resolution       | First receipt by full identity/resource/revision   | Matching receipt or explicit absence; never current source fallback            |

| Entry                     | Source of truth                             | Recovery                                                |
| ------------------------- | ------------------------------------------- | ------------------------------------------------------- |
| New continuation output   | First captured receipt plus durable outbox  | Idempotent publication                                  |
| Failed capture            | Durable failure receipt                     | New delivery revision; no rebinding                     |
| Interrupted network       | Stored immutable bytes and lease            | Bounded retry/restart                                   |
| IPC/database read failure | Existing receipt unchanged                  | Retry transport task                                    |
| Successful upload         | Server revision plus retained local receipt | Release local bytes; repeat remote lookup is idempotent |
| Historical path-only job  | No captured receipt                         | Explicit absence; no silent late capture                |

## Performance and verification matrix

| Area            | Verdict | Evidence                                 | Change or reason kept                           | Verification                                               |
| --------------- | ------- | ---------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------- |
| Background work | fix     | Source read removed from delayed upload  | Existing worker owns retry; no new timers       | Worker lifecycle and retry tests                           |
| Memory          | keep    | One capture slot and 32 MiB source bound | Bounded read/base64; not whole-batch bytes      | Size/admission tests; measured capture/read peak 463.1 MiB |
| Retained bytes  | fix     | 256 MiB local staging budget             | Transactional admission, release on leased ack  | Budget/no-eviction/release tests                           |
| Scope/isolation | keep    | Identity/org/root/path/revision key      | Stale leases cannot release another task        | Isolation and command tests                                |
| Hot path        | keep    | No streaming delta or UI changes         | Blocking capture/hash off async/render executor | Native tests; 32 MiB capture 228–515 ms                    |

| Provider                           | Raw transition                           | App/UI state             | Topology/boundary                       | Expected invariant                                         | Observed evidence                                                 |
| ---------------------------------- | ---------------------------------------- | ------------------------ | --------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------- |
| Normalized continuation            | Deliver, overwrite/delete, retry, reopen | Publisher/worker restart | Rust filesystem/SQLite and TS transport | Captured bytes remain identical; body finality independent | Focused native and frontend regression suite                      |
| ORG2/Claude/Codex original sources | create/append/compact/rotate/fork        | Live/old row/restart     | Real sender/cloud/receiver              | Correct capture and exact historical rendering             | not run; no provider compatibility extrapolation                  |
| Native desktop lifecycle           | visible/hidden/close/reopen              | Actual Tauri process     | CPU/RSS and resources                   | Stable idle and resource release                           | short macOS measurements collected; full acceptance still blocked |

**Performance verdict: fail** for the wider multi-instance isolation invariant; **blocked** for complete snapshot memory/provider acceptance. The user subsequently authorized isolated desktop instances and test-organization writes. Real macOS publisher/native/cloud/recipient checks now pass in both directions, including attachment-only HTTP 503, source overwrite/deletion, repeated publication, byte release, and two cold boots per instance. Short visible/hidden CPU/RSS and 32 MiB capture measurements are recorded in the [desktop verification report](../verification-2026-09-24/ContinuationFileSnapshots.md). Seeded events do not prove real-provider continuation: live provider attempts were blocked, and capture/read peak memory remains an open investigation. The final effect audit found startup auth outside the fresh test accounts and a cross-home scratchpad cleanup boundary; both instances were stopped. These require a separate isolation fix. No production deployment, manual historical cleanup, or PR merge occurred.

## Compatibility and rollback

Frontend and native must ship together; older native does not expose the new snapshot read command. The new additive table leaves old outbox rows intact. Rollback retains receipts/bytes; an old path-only consumer is unsafe for these jobs because it can reopen sources. Stop attachment transmission before downgrading to that consumer and preserve the profile for re-upgrade. No production deployment or downgrade is performed here.

The complete blob/ref/reservation architecture, exact historical IDs, replay migration, configurable local budget, failure-management UI, metadata retention, and cross-platform real-machine acceptance remain open. None is implied by the continuation snapshot tests.

## Commands and observed results

```sh
pnpm exec vitest run --config config/vitest.config.ts \
  src/features/Org2Cloud/org2CloudSyncEngine*.test.ts \
  src/features/Org2Cloud/conversationFileSnapshot.test.ts \
  src/features/Org2Cloud/conversationFileDelivery.test.ts \
  src/features/Org2Cloud/conversationFileOutbox.test.ts \
  src/features/Org2Cloud/syncSessionSharedFiles.test.ts \
  src/features/Org2Cloud/sessionSharedFileCandidates.test.ts \
  src/features/Org2Cloud/sharedSessionFilesClient.test.ts \
  src/features/Org2Cloud/SessionConversation/cloudConversationQueueAdapter.test.ts \
  src/features/Org2Cloud/SessionConversation/conversationTurnRunner.test.ts
cargo test --manifest-path src-tauri/Cargo.toml --lib \
  agent_sessions::shared_file_outbox -- --test-threads=1
cargo clippy --manifest-path src-tauri/Cargo.toml --tests -- -D warnings
pnpm typecheck:fast
pnpm check:typed-lint
pnpm check:boundaries
pnpm check:circular
pnpm check:test-placement
git diff --check
```

Frontend: **21 files / 263 passed**. Native macOS: **17 passed**, including the real capture/enqueue/read/ack command path, APFS overwrite retention, database reopen, source deletion, immutable failure receipts, corruption rejection, quota accounting, and stale-lease protection. Windows/Linux native acceptance is not inferred from these results.

Typecheck and changed-file ESLint passed. Typed lint: 1044 existing, zero new/increased. Dependency boundaries: three existing, zero new across 8874 modules. No cycles across 8130 modules. Test placement consistent across 633 directories. The first Clippy run found an unnecessary clone in a new test; it was replaced with `std::slice::from_ref` before the final run. Build caches and the ignored local PM sidecar symlink are not committed.

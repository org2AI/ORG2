# Session replay attachment scheduling isolation: implementation and verification

This implementation is the first step toward the design in [#2114](https://github.com/org2AI/ORG2/pull/2114): body synchronization no longer waits for attachment capability probing, backfill reads, or network uploads. This change does not implement a complete persistent attachment outbox, object storage, per-attachment UI, or quota management; production capacity is unchanged.

## Root cause and write boundary

The body uses locally normalized events as its source, submits the remote body through `Org2CloudSessionSync`, and writes to `org2CloudPushCursorsAtom`. #2111 moved body submission earlier, but `pushSession` still waited for attachments, and attachment backfill state forced body passes to probe capabilities and read the full history. One slow attachment could occupy a sender pass and affect later sessions or appended body content.

The body now only schedules attachment work and does not wait for it to finish. When the body is already clean, a pending-backfill marker triggers independent attachment work without affecting the body’s incremental-read strategy. The shared-file version marker remains an existing persistent cursor field; the storage format is unchanged. A task may mark an attachment complete only if the cursor it captured is still current; otherwise it remains pending for reevaluation in the next pass.

Tasks are owned by the existing sync instance, with at most two running at a time; no polling, timers, or in-memory wait queue were added. When all slots are occupied, the persistent backfill marker remains. When a slot is released and work had been deferred, the existing serial engine is notified to run another sync pass. Tasks that were not deferred do not trigger a new pass, and hidden/stopped states are not actively awakened. A cancelled task continues to occupy its slot until it actually ends, preventing repeated resets from causing uncontrolled real concurrency. Quota cooldown remains organization-scoped.

The lookup and upload RPCs accept an optional AbortSignal. Tasks are cancelled on reset, session retraction, downgrade to metadata-only, or when an organization/session leaves the local scope; identity, endpoint, run generation, and visibility are rechecked at async boundaries. A hidden window does not start new attachment work, and after an in-flight request ends it will not read or upload the next file. Capability probing continues to use the existing shared probe and 15-second timeout; cancelling one task must not abort probes used by other consumers. Attachment RPCs retain their 30-second timeout. Local history/file reads use the existing IPC and cannot be interrupted by AbortSignal; after cancellation, the task still occupies its slot until the read actually ends, and must not start a network upload afterward.

No history with missing body/attachments was deleted or modified; backfill still needs to be verified after upgrading the original publisher. A retraction request cannot undo a write already completed by the server; final permissions remain governed by server ACLs.

## Follow-up testing found no wake-up after a concurrency slot was released

The engine has no periodic polling. The previous assumption that “a later sync pass will happen naturally” could leave the third session’s pending-backfill cursor waiting until the user acted again. A new real-engine regression first reproduced the failure without a wake-up (3 attachment calls expected, 2 observed), then verified that releasing a slot automatically drains work for 3/7 sessions. The test freezes bootstrap/focus timers and waits for real async summary computation; it neither advances the clock nor manually invokes another pass, avoiding a timer-driven false pass.

The fix notifies the existing engine after the attachment task releases its slot in `finally`; the engine reuses its existing single-flight/coalescing mechanism. Persistent cursors remain the basis for discovering and completing tasks; one boolean only coalesces wake-up requests. Negative assertions were added for stopped/hidden states; no data cleanup or history-state migration was performed.

## Ten-layer architecture check

| Layer | Coverage | Result                                                                                       |
| ----------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 1. Compilation | TypeScript, relevant tests, lint | See commands below; Rust was not modified; current Rust and sidecar were built for desktop E2E                               |
| 2. Structure / duplication | Attachment call sites for replay, comments, follow-up input, and follow-up output | This change updates replay scheduling; explicit comments still require an available attachment reference, and follow-up execution retains its existing behavior. No claim is made that all entry points are unified. |
| 3. Naming | scheduleReplaySharedFiles / sharedFileJobs | The scheduling method returns void; the body does not wait for attachment tasks.                                                      |
| 4. Semantics | Body success and attachment completion | The states are independent; an old task cannot certify an updated cursor.                                                   |
| 5. Default branches | Quota, network, unknown capability, hidden, full slots, cancellation | Backfill remains pending; failures affect only attachment cooldown; pause reasons have diagnostics rate-limited to once per owner per minute.                        |
| 6. Domain boundary | Replay uploads and execution input | Follow-up input attachments and comment-submission semantics are unchanged.                                                           |
| 7. Understandability | Body submitted while files are paused | Code comments and this report explain the transition scope; per-attachment visible status is not implemented yet.                                         |
| 8. Wire protocol | Shared-file lookup and upload | Only the client cancellation signal is passed through; RPC names, parameters, and return data are unchanged. Wire-boundary tests cover cancellation, permissions, quota, and integrity.   |
| 9. Initialization / lifecycle | Existing sender owner, reset, prune, restart, hidden | The task set is bounded; cancellation releases a slot only after actual completion; persistent cursors support recovery.                                       |
| 10. Resolution consistency | The full / incremental / clean body paths | Missing attachments no longer force a full body read; attachments associated with incomplete incrementals are fully backfilled in the background and not incorrectly marked complete.                   |

## Performance and lifecycle

| Area               | Verdict | Evidence                                   | Change or reason kept                                   | Verification                                       |
| ------------------ | ------- | ------------------------------------------ | ------------------------------------------------------- | -------------------------------------------------- |
| Background work    | fix     | The original sender awaited attachments; at most two active tasks are now added | The body does not wait; existing passes trigger work, with no new polling; hidden state does not start work        | Body append continues while upload/probe is hung; visible passes resume after hiding    |
| Memory             | fix     | No wait queue; at most two active tasks             | A cancelled task holds its slot until completion; references are released afterward; the retry table retains its limit of 256     | Tests for concurrency, repeated passes, slots after reset, and late completion         |
| Scope/isolation    | fix     | Endpoint, identity, generation, organization/session, and AbortSignal  | reset/retract/metadata/prune cancellation; old cursors cannot write the completion state | Tests for account switch, reset, retraction, downgrade, prune, and old upload completion |
| Rendering/hot path | keep    | No React subscriptions or components changed                    | No UI rendering changes; per-attachment UI remains a future design item              | No rendering performance improvement is claimed                                 |

| Provider | Raw transition | App/UI state | Topology/boundary | Expected invariant | Observed evidence |
| ----------------- | ---------------------------------------- | -------------------------------- | ---------------------------------------- | ------------------------------------------ | ---------------------------------------------- |
| Native session-sharing entry point  | Append normalized events; no real raw provider file | Unit environment, not rendered UI              | Local event-source stub → real sender → RPC mock | A hung attachment does not block body append; old completion does not overwrite a new cursor | Passed; does not represent raw provider ingestion verification             |
| Cursor import entry point   | Append representative raw chunk fixture            | Engine pass, not a real desktop             | Import-source fixture → sender → RPC mock       | Body remains incremental during cooldown; attachments are fully backfilled after recovery       | Passed; Rust normalization is mocked, so end-to-end ingestion coverage is not claimed |
| All real providers | create/append/compact/rotate/delete      | Cold start, active window, hidden, second launch | Isolated A upload / B receive and cloud ledger           | Body and exact versions are readable, with no extra rewrites and resources released   | not run                                        |

### Isolated desktop follow-up testing

Final Core UI E2E result; **7 passing / 1 skipped**. Two separate desktop identities, data directories, WebView stores, and ports ran the current Rust/sidecar build. The test cloud was an isolated local PostgreSQL database with cloud-infra migrations 0001–0033 applied; real SQL was called through PostgREST and a fault proxy. Authentication used test JWTs; GoTrue/Realtime services were not run, and production was not written to.

- A→B / B→A; Normalized user/agent events went through production sharing, upload, sidebar open, and file-preview paths; the receiver had no source file, and the actual preview bytes matched.
- Attachment upload hung: the body sender pass returned in 126 ms; the receiver could see the body and the subsequent third event while the attachment request remained hung.
- Actual SQL quota of 1,000 file entries: the body pass returned in 123 ms, and the receiver could see the body and the append; old attachments remained previewable. Filler records were created only in a dedicated test organization and cleaned up in finally.
- After sharing was retracted, the real RPC rejected file reads and the preview showed an error; testing continued after test sharing was restored.
- Each of two accounts had two cold starts: identities did not cross, file IDs remained unchanged, and receiver previews remained readable. The entire test database ledger was checked before and after each scenario; no old rows were deleted or had permissions changed, event counts did not decrease, epochs did not increase, and no rewrite storm occurred.
- Visible and hidden for 20 seconds each: CPU time for the two native processes increased by 0.01/0.03  seconds and 0.02/0.01 seconds, with RSS around 167–206 MiB and declining. Only native processes were measured; **the WebKit renderer is not included**, so this does not represent whole-application performance.

Follow-up testing also corrected two test-observation issues: a user attachment is actually a span with role=link; refreshing the list is asynchronous, so the committed list cursor must reach 3 before clicking again, and an old row must not be used to trigger replay. The read-only E2E check now includes eventsCount; it did not inject import state or replace the production download path.

The environment’s webpack-dev-server 5 rejected the repository’s current object-form proxy; this run used a temporary local adaptation to an array form and restored it in finally, so it was not included in the PR. Logs retain CHANNEL_ERROR from the absent Realtime service, the test repo remote being unavailable, intentionally missing attachments, and orgtrack high-frequency-read warnings from rapid scenario switching; no claim is made that there were no WARN/ERROR messages.

**Performance verdict: blocked**: scheduling boundaries, body/files on both ends, and short native idle checks passed. Full WebKit resources, upgrades from older versions, raw-provider create/compact/rotate/delete, real Realtime reconnects, and history recovery by the original publisher were not covered. The real model-response test was not enabled and was explicitly skipped; normalized event fixtures do not count as provider-ingestion or full-lifecycle verification.

A full-history backfill may still read a large session; limiting to two tasks is not a byte-level memory budget. A persistent paginated outbox, immutable file snapshots, byte-budget management, and a unified owner for follow-up attachments remain future design work.

## Verification commands

- `pnpm exec vitest run --config config/vitest.config.ts src/features/Org2Cloud/org2CloudSessionSync src/features/Org2Cloud/org2CloudSyncEngine src/features/Org2Cloud/sessionSharedFile src/features/Org2Cloud/syncSessionSharedFiles.test.ts src/features/Org2Cloud/sharedSessionFilesClient.test.ts src/features/Org2Cloud/SessionConversation/cloudConversationQueueAdapter`; 22 files, 253 tests passed.
- `pnpm typecheck:fast`; passed.
- `CARGO_BUILD_JOBS=2 node scripts/tauri/prepare-sidecars.cjs --profile debug`; passed; WDIO built two isolated identities with `cargo build -p org2 --features webdriver`.
- `cd tests/e2e && pnpm test -- --spec ./specs/core/cloud-dual-instance-ui.spec.mjs --mochaOpts.grep "Shared session files across two desktop accounts"`; under the isolated local fixture/port/fault-proxy environment 7 passing / 1 skipped; using environment variables `E2E_SHARED_FILES_FIXTURE` / `E2E_SHARED_FILES_ARTIFACTS` / `E2E_ISOLATED_RUN=1` / `E2E_PROVIDER_MODE=mock`.
- Ran `pnpm exec eslint <changed-ts-files> --max-warnings 0` for the eight TypeScript files changed in this work and `pnpm exec oxlint -c src/.oxlintrc.json --max-warnings 0 <changed-production-files>` for the four production files.
- `pnpm check:circular`, `pnpm check:test-placement`, and `git diff --check`; results are recorded in the PR.

No database, configuration, quota, or persistent-format migration was made. Rollback requires only reverting the client code; pending markers remain recognizable by the #2111 backfill path. The download API is unchanged, and the new upload quota still does not apply to reads of existing files.

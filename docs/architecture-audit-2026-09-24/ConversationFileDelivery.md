# Durable continuation output delivery and execution finality

Date: 2026-09-24. Covers Share Sessions F5 and continuation-specific F6. No cloud deployment, history cleanup, or canonical/provider-native message edits.

## Authority, cause, and invariant

Previously, `cloudConversationQueueAdapter.plane.ts` published body events and awaited `syncSessionSharedFiles`. `conversationTurnRunner.ts` waited for publication before `cloudConversationQueueAdapter.ts` called `coordination.finish`. Attachment capability probes, disk reads, and network uploads therefore gated completion; quota/connectivity failures could hold or fail successful execution.

New flow: persist body → signal readable body → journal file candidates in local SQLite → finish execution. The sync engine owns independent uploads. Transmission failures change only attachment tasks. Assistant Markdown, `[file:…]`, and shell-generated files remain automatic delivery entries without manual attachment or a write-tool allowlist.

Journal persistence remains a required local handoff: disk-full/SQLite errors keep the same accepted turn in publication recovery, without pretending delivery succeeded, fabricating a failure tail, or rerunning the provider. Already-persisted body remains readable. Required execution inputs keep their previous pre-execution dependency.

## Storage and recovery

- Add `sessions.db.cloud_file_outbox` and a due index with `CREATE IF NOT EXISTS`; preserve existing tables/history. Production and isolated test startup initialize the same schema.
- Rows contain endpoint/user identity, organization, cloud root, source path/event revision, attempts, next-attempt deadline, lease, and outcome. No tokens, transcripts, or file bytes.
- Unique identity/org/session/path/revision makes publication retry and partially persisted batches idempotent. Existing remote revisions are acknowledged without duplicate upload.
- `BEGIN IMMEDIATE` claims one row with a five-minute UUID lease. Settling requires identity, row ID, and lease; stale consumers cannot acknowledge new claims.
- Success deletes only the local pending row. Source read failure remains pending instead of acknowledging availability.
- The 256-item IPC maximum bounds serialization, not total file count; all candidates are saved in batches. Claim reads one due row, not the entire queue.
- One upload per consumer; yield after 32 jobs. Leases coordinate windows/processes; a Tauri event wakes peer windows in the same application.
- Network/capability/access failures back off from five seconds to thirty minutes. Quota defers existing and new organization jobs for thirty minutes. Source-unavailable jobs also wait thirty minutes. Empty queues have no polling timer.
- Hidden/offline/signout/identity/endpoint/org changes and stop abort transmission. Aborted work retains its slot until it really ends. Visibility, connectivity, matching identity, startup, and enqueue notifications resume work. Removed organizations retain jobs; server ACL remains authoritative.

## Explicit limitations

This PR journals candidates, **not immutable snapshots**. Upload still reads the current source path, so later overwrite/loss can change or remove historical bytes. F2/F4 capture and stable-reference work remains open.

Replay retains #2119 scheduling/cursors and its existing read-failure readiness semantics. Only the new continuation worker consumes `sourceUnavailable`. Aggregate concurrency can be two replay tasks plus one continuation task, not one application-wide task.

No per-file management UI, reference GC, or cleanup control is added. Missing/revoked/unrecoverable sources keep metadata and back off. Guest reads still depend on #2123 / infra #147. Independent processes discover new jobs through startup/foreground recovery; Tauri notifications are not a cross-process bus.

## Ten-layer architecture audit

| Layer               | Coverage                                                        | Evidence/boundary                                           |
| ------------------- | --------------------------------------------------------------- | ----------------------------------------------------------- |
| 1 Compile           | TS checks/lint and Rust tests/Clippy                            | No claim that every repository test ran                     |
| 2 Structure         | Shared candidate upload function                                | Replay cursor not migrated                                  |
| 3 Naming            | outbox/sourceUnavailable/supported                              | supported does not mean bytes uploaded                      |
| 4 Semantics         | body persistence/journal commit/file availability/turn finality | Only durable local handoff gates publication completion     |
| 5 Defaults          | unsupported/read failure/quota/identity/storage failure         | No dropped jobs or transport-induced execution failure      |
| 6 Ownership         | SQLite/sync engine/turn finality                                | Worker never calls turn finish/failure                      |
| 7 Understandability | Recovery responsibilities and limits                            | No queue-status UI claim                                    |
| 8 IPC               | Three typed commands and camelCase/enums                        | Cloud protocol unchanged; no token persistence              |
| 9 Initialization    | Startup/test schema, command/router registration                | Isolated native command round trip and worker startup tests |
| 10 Resolution       | identity/org whitelist and lease compare-and-set                | Current endpoint scope; server authorization retained       |

| Entry              | Authority                    | Recovery/finality                                |
| ------------------ | ---------------------------- | ------------------------------------------------ |
| Output publication | Cloud body and local journal | Finish after journal, before upload              |
| Publication retry  | Same accepted runner/turn    | Idempotent push/enqueue; no second provider run  |
| Journal failure    | Accepted delivery retained   | Recovery pending, no false handoff               |
| Transfer failure   | Per-file durable task        | Independent backoff                              |
| Crash/new window   | Pending rows and leases      | Startup/peer wake; stale acknowledgment rejected |
| Body-only response | Cloud body                   | No journal IPC                                   |

## Performance and lifecycle

| Area            | Verdict | Evidence                                                | Change or reason kept                                                | Verification                                               |
| --------------- | ------- | ------------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------- |
| Background work | fix     | Upload leaves publishTail; timer only for pending tasks | Empty queue does not poll; visibility/online gating and stop cleanup | Virtual idle hour, hidden/offline/stop, peer cleanup tests |
| Memory          | keep    | One claimed file/timer; 32-job yield                    | No transcript queue; persistent pending rows not silently evicted    | 40-job drain test; real RSS unmeasured                     |
| Scope/isolation | fix     | Full identity/resource key plus lease                   | Identity/org change cancels; token refresh does not                  | Rust identity/lease and TS stale-result tests              |
| Hot path        | keep    | No streaming/UI edits                                   | Preserve original transcript text; no historical scan                | Producing-boundary automatic-link/original-text tests      |

| Provider                      | Raw transition                    | App/UI state                       | Topology/boundary              | Expected invariant                                      | Observed evidence                                                   |
| ----------------------------- | --------------------------------- | ---------------------------------- | ------------------------------ | ------------------------------------------------------- | ------------------------------------------------------------------- |
| Normalized continuation       | Completed output delivery         | Completion/recovery/worker restart | TS publisher/worker and SQLite | Automatic durable delivery independent of turn finality | Unit/state and native command tests                                 |
| ORG2/Claude/Codex raw sources | create/append/compact/rotate/fork | Real desktop/old row/restart       | Provider/app/cloud/recipient   | Complete automatic file delivery                        | not run; normalized tests are not provider/dual-instance acceptance |

**Performance verdict: blocked.** Ownership, stop conditions, memory bounds, and backoff have tests. Real Tauri visible/hidden/close CPU/RSS, dual-instance transmission, cross-process wakeups, and raw-provider lifecycle matrices have not run. No extra desktop windows, production deployment, or history cleanup.

## Compatibility, rollback, and history

Frontend and native ship together; old native lacks these commands and would leave publication recovery pending. Old clients ignore but retain the new table. Preserve the journal on rollback; older versions do not consume it, and re-upgrade resumes delivery. No promise of attachment recovery during rollback.

No historical scan/reupload or deletion. No session foreign-key cascade, avoiding confusion between cloud root and local session IDs; future reference reclamation belongs to F8. No cloud schema or entitlement change.

## Verification record

After integration of #2122:

```sh
pnpm exec vitest run --config config/vitest.config.ts \
  src/features/Org2Cloud/org2CloudSyncEngine*.test.ts \
  src/features/Org2Cloud/conversationFileDelivery.test.ts \
  src/features/Org2Cloud/conversationFileOutbox.test.ts \
  src/features/Org2Cloud/syncSessionSharedFiles.test.ts \
  src/features/Org2Cloud/sessionSharedFileCandidates.test.ts \
  src/features/Org2Cloud/sharedSessionFilesClient.test.ts \
  src/features/Org2Cloud/SessionConversation/cloudConversationQueueAdapter.test.ts \
  src/features/Org2Cloud/SessionConversation/conversationTurnRunner.test.ts
cargo test --manifest-path src-tauri/Cargo.toml --lib \
  agent_sessions::shared_file_outbox::tests -- --test-threads=1
cargo clippy --manifest-path src-tauri/Cargo.toml --tests -- -D warnings
pnpm typecheck:fast
pnpm check:typed-lint
pnpm check:boundaries
pnpm check:circular
pnpm check:test-placement
git diff --check
```

Frontend **20 files / 249 passed**; Rust **8 passed**. Typecheck, changed-file lint, Clippy, boundary checks (zero new), cycle check, test placement, and whitespace passed. Typed lint: 1044 existing, zero new/increased. Normal commit hooks passed.

Initial Rust build lacked a local sidecar; an ignored symlink fixed the environment without committing binaries. Early new tests corrected construction/order assumptions; expanded sync tests required a real empty-outbox IPC fixture response, preserving the idle no-periodic-pass assertion.

Coverage includes producing boundary, publisher, worker, replay/client regression, SQLite reopen, competing leases, CAS, quota inheritance, source recovery, and native commands. No layout changes: screenshots cannot establish persistence invariants. No desktop E2E or performance measurement is implied. English translation changes documentation only and does not rerun these earlier checks.

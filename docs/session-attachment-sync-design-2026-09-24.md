# Session and attachment sync: current flow and proposed design

Status: design for review, 2026-09-24 UTC. The body hotfix [#2111](https://github.com/org2AI/ORG2/pull/2111) is merged; merging does not prove client rollout or production recovery. This document describes the original design baseline. Later implementation status is tracked in [the end-to-end audit](architecture-audit-2026-09-24/ShareSessions.md). Queue, quota, storage, and UI proposals are not claims that they are deployed.

## Judgment and acceptance criteria

Quotas are reasonable. A cumulative organization limit of 1,000 file records is poorly matched to automatically shared artifacts. An attachment failure blocking the body is an incorrect failure boundary. Increasing that constant does not solve snapshots, lifecycle, observable state, or recovery.

1. Attachment capacity, connectivity, and source failures cannot block an otherwise authorized body. Body authorization or persistence failures remain explicit.
2. An event's attachment version is immutable; later local content cannot masquerade as an earlier artifact.
3. Body publication, attachment availability, and upload progress are independent, explainable states with clear recovery ownership.
4. Uploads have durable jobs, idempotent commits, authorization, quota reservations, and recovery. Success is not charged twice; cancellation does not leak reservations.
5. Idle/hidden clients do not scan all historical files or retain unbounded queues/caches/retries. New content and quota changes drive incremental work.
6. Deletion, revocation, cleanup, and rollback have verifiable semantics. Do not automatically delete referenced historical files to free space.

## Actual baseline flow

### Replay body and automatic files before the incident

1. The sender selects shareable local sessions and publishes metadata such as titles.
2. Normalized events yield user file references, assistant Markdown links, and successful write/edit artifacts. Ordinary reads alone do not create delivery. One scan retains the latest candidate per path, using event ID/time as revision. Assistant-delivered shell artifacts remain supported without a write-tool allowlist.
3. Query existing revisions in batches of 64. Read missing candidates from the sender's current path, up to 32 MiB per file; skip absent/unreadable sources.
4. Send base64 bytes through an RPC. The server checks content access, locks the organization, checks duplicate revision and COUNT/SUM limits (1,000 records / 1 GiB), then stores bytea in PostgreSQL.
5. The old sender waits for attachments before publishing body segments. Quota failure therefore leaves a visible title with no body for every recipient.
6. Recipients fetch bodies independently. File clicks resolve an ID or session/path and read through authenticated RPCs. Path lookup omits revision and chooses the newest upload, not an exact event snapshot.

Bodies already have segmented sync, cursors, object-storage offload, and plan quotas. Attachments use separate database-byte storage and hard-coded limits. Deduplication includes organization, uploader, session, path, and revision; it is not organization-wide content deduplication.

Source inspection found no production per-session/retention attachment reclamation path. Foreign-key cascades cover organization/account deletion, not session_id. This does not prove that no external production operations exist.

### Other entries

- Explicit comment files upload before comment submission replaces paths with cloud references; failure cannot claim availability.
- Continuation input events and assistant output publish body into the conversation plane before synchronizing files. File errors can still affect running/completion state. These entries should share attachment infrastructure while retaining their different business dependencies.
- A missing file required for execution may explicitly block that execution. Supplementary replay/output files cannot make already-published history unreadable.

### What #2111 changed

Publish bodies first and attempt files afterward. Record attachment failures independently and leave `sharedFilesVersion` pending. Ordinary errors cool down per session for five minutes; quota errors cool down per organization for thirty. Retry memory is capped at 256 entries and partitioned by identity/endpoint/organization/session, using existing sync triggers rather than a new timer. Retry scans the complete candidate set so old failures are not lost behind newer increments.

This is a hotfix, not the final design: no durable per-file outbox, remote status, changed quota, immutable capture, or lifecycle/GC. Attachment requests still extend the sender pass. #2119 subsequently separates replay scheduling; continuation isolation is proposed in #2128.

## Proposed data and execution model

### Ownership

- **Local event store:** authoritative events and pending body operations; retain the existing body protocol.
- **Local immutable snapshots/outbox:** captured bytes, hash, event association, identity/organization, attempts, and next attempt. Jobs reference durable snapshots rather than holding whole file batches in memory.
- **Cloud attachment_refs:** event ID, stable attachment ID, blob ID, display name, MIME, capture provenance, and availability. Reads require the owning session ACL; a hash is not a credential.
- **Cloud attachment_blobs:** organization-scoped hash, size, private object key, integrity, and lifecycle. Reuse physical bytes only after authorization; do not expose cross-organization deduplication observations.
- **Cloud quota_usage/upload_reservations:** committed plus unexpired reserved bytes. Object upload and database commit are not one transaction; use idempotent finalize and reconciliation.

Local jobs own transmission state; cloud references own availability. UI derives each state from its authority instead of inventing one “session synced” flag.

### Publication

1. Persist body independently and assign stable attachment identity. Capture at user selection or artifact delivery, preferably using original produced bytes or a source with proven version consistency. Capture failure records explicit state; never reopen later content and call it the historical original. Body publication does not wait for network upload.
2. Publish body with attachment IDs or an associated manifest. Recipients can read immediately and see pending/quota/missing state.
3. A dedicated worker pages through local jobs. Initially budget at most two uploads per instance, with server organization/user limits; do not materialize all files. Prioritize active/explicit delivery over historical backfill.
4. Server begin-upload checks ACL, metadata, and budget; reuse a verified authorized blob or atomically reserve capacity and issue short-lived upload credentials.
5. Send bytes to private object storage rather than JSON/base64 database RPC. Use bounded resumable chunks for larger files.
6. Finalize verifies trustworthy size/hash, object ownership, and current permission; idempotently commits the reference and settles reservation, then emits availability change.
7. Reauthorize exact-version reads. Immediate revocation requires an authenticated proxy; signed URLs have a documented revocation window until expiration.

Recover from failures before/after upload and finalize by querying server state. Do not blindly retransmit or classify every failure as retrying.

### Scheduling and recovery

Body and file queues have separate concurrency budgets. Body publishers register durable handoff without awaiting network/capability/quota requests. One profile-owned attachment coordinator controls uploads; multi-window/process contention needs explicit leases, not accidental duplicate loops. Task scope includes endpoint, account, organization, attachment ID, and captured version; server idempotency handles multiple devices.

Page jobs and bound local snapshot disk bytes. On budget exhaustion, pause capture with an explicit reason and preserve body delivery. Define queued/uploading/committed plus retry_wait, quota_blocked, source_missing, forbidden, and cancelled. Terminal failures must not be repeatedly awakened by generic timers.

Server idempotency, reservation expiry/release, and reauthorization are mandatory. New references and GC marking must be mutually safe. Recheck references after a grace period before physical deletion; failed deletion must not release actual usage prematurely. Reconciliation must expose discrepancies rather than overwrite counters blindly.

### Historical sources

A path and old event timestamp cannot prove the original bytes still exist. Restore a real versioned source if available. Otherwise mark the historical version unavailable/unverified; a separately shared current file records its actual capture time and must not claim original-event provenance.

Current source inspection proves a risk (late reads plus newest-path lookup), not that a specific user's file was replaced.

## User-visible behavior: paused files never block the body

| Scenario                                | Body                                           | Attachment/click feedback                                                              |
| --------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------- |
| Existing upload; new-storage quota full | Opens, pages, searches, copies normally        | Existing file previews/downloads; upload admission is not read authorization           |
| Upload paused for quota                 | Opens without quota/file requests              | Explain the pause and sender/admin recovery; never use recipient-local paths           |
| Pending/uploading                       | Opens normally                                 | Immediate explicit state, neither indefinite spinner nor ignored click                 |
| Missing source/historical version       | Opens normally                                 | Explain unavailability and source-side recovery; no silent newest-version substitution |
| One download fails/offline              | Cached body remains; body requests independent | Retry that download without full-body reload                                           |
| File permission revoked                 | Body evaluated under its own ACL               | Deny file read without exposing URL/cached bytes                                       |

For example: “Body synced · 2 attachments paused.” Body rendering cannot await file manifests/content. A failed manifest means unknown file availability, not a body load error. File availability changes update the file without rebuilding the timeline or losing scroll position. Body-specific permission/network/storage errors retain their own explanations.

### What quotas control

| Resource             | Purpose                                | Meter                                       | Exhaustion behavior                                                  |
| -------------------- | -------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------- |
| Stored bytes         | Retention/storage cost                 | Verified blob bytes plus live reservations  | Pause new bytes; allow authorized existing-blob references           |
| Upload bandwidth     | Ingress/processing/provider cost       | Actual bytes per period                     | Pause/throttle upload; no duplicate storage charge                   |
| Download bandwidth   | Egress cost                            | Actual bytes per period                     | Apply published file-download policy independently of bodies         |
| Requests/concurrency | Fairness and resource protection       | Requests/time, active uploads, reservations | Structured retry deadline/queue; bodies do not join file queues      |
| Metadata             | Many tiny/empty objects and index cost | Blob/ref/reservation counts and growth      | Separate configurable guard and alert, not a proxy for byte capacity |

Entitlements may expose these budgets, but quota is not authorization, sync correctness, or version consistency. The current 1,000-record guard does not prove physical storage exhaustion. Return structured resource/usedBytes/reservedBytes/limitBytes/retryPolicy fields; clients must not guess from HTTP 400 or strings. Never write attachment throttling into body sync failure state.

## Quota recommendations

| Dimension              | Baseline                             | Recommendation                                                                                |
| ---------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------- |
| File size              | 32 MiB                               | Retain as an explicit initial guard; revisit after object/chunk upload                        |
| Organization capacity  | Hard-coded 1 GiB                     | Server-configured entitlement with used/limit/reserved; not a universal fixed team limit      |
| Record count           | Reject at 1,000 accumulated versions | Separate abuse/metadata guard, sized with load evidence rather than marketed as file capacity |
| Traffic/requests       | No explicit separate model           | Meter ingress, egress, request rate; reuse/retry must not double-charge storage               |
| Body/file relationship | Separate hard-coded and plan systems | One entitlement API with independent budgets or guaranteed body reserve                       |
| Full capacity          | Old sender blocks body too           | Pause new file uploads; preserve bodies and existing reads; actionable admin entry            |
| Alerts                 | HTTP 400 observed                    | Configurable suggestions: 80% warning, 95% stronger warning, 100% admission pause             |

Illustrative only: 1,000 files averaging 25 KiB occupy about 24.4 MiB, roughly 2.4% of 1 GiB. A few dozen large files can consume the same budget quickly. Metadata cost still matters, but needs its own tests and alerts.

Do not invent a 10/100 GiB team allowance. Derive it from artifact rate × average size × retention × deduplication ratio, team size, storage/egress budget, then validate p95 size, peak requests, and metadata load. Raising a bytea/whole-organization aggregate limit alone does not provide scalable storage.

## Retry and lifecycle rules

- Transient/offline: jittered exponential backoff, network-return wakeups within rate/concurrency limits.
- Quota: wait for capacity changes, reclaim, or explicit retry with a low-frequency safety check; avoid one known-failing request per session.
- Authentication: wait for reauthentication; refresh preserves identity, account/endpoint switches revoke old execution authority.
- Forbidden/revoked: stop transmission and expose state; reevaluate on access change.
- Missing/too-large: explicit terminal reason rather than pointless timer retries.
- Hidden/idle: pause noncritical backfill; preserve durable jobs and reservations during bounded pause/resume.
- Server objects: revoked references deny new reads; GC only after no valid references and an explicit grace period. Expired unfinalized reservations govern temporary object cleanup.
- Never delete still-referenced history automatically. Admin cleanup previews affected sessions and retains a recovery window before physical deletion.

## Delivery sequence and verification

A. #2111 is merged; verify sender backfill and recipient reads after rollout. Emergency expansion is a separate operational decision, not the final fix.
B. Add configurable quota/usage APIs, independent states, local durable jobs, and shared upload ownership. Replace session-wide rescans; bound historical backfill separately.
C. Introduce private object storage and blob/ref/reservation; migrate bytea by copying and verifying hashes/sizes before switching readers/writers. Preserve old IDs and old bytes until references are validated. Roll back through a reader adapter without changing IDs.
D. Complete capture provenance, historical-reference resolution, GC, and budget management. The later audit prioritizes correct capture at the producing boundary before broad transport/history migration.

Required product regressions: a file RPC that never finishes does not delay readable body; zero new-upload budget still permits existing-file download; clicking a paused file gives immediate explanatory feedback.

Verify first publication, append, body success/file failure, restart, offline recovery, duplicate finalize, identity/endpoint changes, revocation, delete/restore, competing final-capacity reservations, and source overwrite/missing. Dual-instance evidence must prove raw sender ingestion, cloud commit, and recipient exact bytes/body, not merely exchange two preseeded databases. Measure visible/hidden idle, active/backfill peaks, and post-completion resource release.

## Ten-layer architecture coverage

| Layer               | Covered                                    | Limitation/conclusion                                               |
| ------------------- | ------------------------------------------ | ------------------------------------------------------------------- |
| 1 Compile           | Prior #2111 typecheck/233 tests/CI         | Proposed implementation not compiled by this document               |
| 2 Structure         | Replay, comment, continuation input/output | Shared owner with distinct input/output dependencies                |
| 3 Naming            | revision/sharedFilesVersion/quota          | Snapshot hash is distinct from protocol readiness                   |
| 4 Semantics         | synced/file/session/budget                 | Separate body receipt, reference availability, task, physical bytes |
| 5 Defaults          | missing/capability/400/quota/identity      | Explicit classification, not generic retry/empty state              |
| 6 Boundaries        | replay/files/execution                     | Supplementary files cannot block history                            |
| 7 Understandability | Empty activity versus missing body         | Explain state and recovery owner                                    |
| 8 Wire              | base64/bytea/hash/path lookup              | Exact-reference/object protocol proposed, not tested                |
| 9 Lifecycle         | boot/cursor/cooldown/reset                 | Durable ownership and resume required                               |
| 10 Resolution       | File ID versus latest path                 | No implicit new-version fallback for historical snapshots           |

This is a sharing design, not a repository-wide refactor. Proposed object protocols, costs, GC, and production recovery have not been implemented or measured by this document.

## Source references

- `src/features/Org2Cloud/org2CloudSessionSync.ts`
- `src/features/Org2Cloud/org2CloudSessionSync.pushPhases.ts`
- `src/features/Org2Cloud/sessionSharedFileCandidates.ts`
- `src/features/Org2Cloud/syncSessionSharedFiles.ts`
- `src/features/Org2Cloud/prepareSharedCommentFiles.ts`
- `src/features/Org2Cloud/SharedSessionFileViewer.tsx`
- `src/features/Org2Cloud/SessionConversation/cloudConversationQueueAdapter.ts`
- `src/features/Org2Cloud/SessionConversation/cloudConversationQueueAdapter.plane.ts`
- cloud-infra `supabase/migrations/0033_shared_session_files.sql`
- cloud-infra `supabase/migrations/0001_org2_cloud_schema.sql` and `0005_broadcast_and_storage_offload.sql`

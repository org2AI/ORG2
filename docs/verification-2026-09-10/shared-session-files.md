# Shared session files

## Problem and authoritative boundary

Shared transcripts and comments previously persisted sender-local paths without transporting file bytes. A teammate could read the session but could not open those paths. The authoritative fix is a private cloud file registry plus sender-side publication. Mentions do not grant access or turn a local path into a shared object.

## Implemented behavior

- Shared-session user file references, completed agent writes/edits, multi-file patches and explicit Markdown file/image outputs publish real bytes. Publication runs in the existing replay and conversation-delivery lifecycles. It does not scan unrelated workspace files or upload read-only tool results.
- Existing replay cursors receive one full-history file backfill when the backend advertises support. A persisted optional `sharedFilesVersion: 1` marker prevents repeating that read on idle/restart; normal event changes continue through the existing incremental path. Missing historical files cannot be reconstructed: the sender must still hold their bytes. No historical transcript/comment data is rewritten or deleted.
- File pills, output links, inline file links, code-block file actions, Edits and Inbox references use the shared-session source index. Shared file previews do not read a receiver's same-named local file. Comments are another entry point and carry immutable `orgii-file` IDs after preparation; there is no five-files-per-comment product rule.
- A source key includes session, uploader, path and event revision. Batch metadata lookup (64 records/request) avoids reading already-published files. Uploads are sequential. Repeating a source revision with different bytes is rejected; independent versions remain immutable. Unqualified paths written by multiple authors fail as ambiguous rather than opening another author's file.
- Source snapshots contain bytes at publication time, not a reconstructed historical version. A changed-during-read file is rejected. Missing/oversized source files produce no available-file record; replay can still sync. Network upload failures remain owned by the existing retry lifecycle and can delay replay or turn completion.
- Text previews are escaped UTF-8 up to 128 KiB. Images and PDFs use revocable object URLs; PDF rendering is sandboxed. Other files can be saved with the native dialog. Preview/native save behavior still requires packaged-desktop verification.

## Bounds, security and compatibility

Current transport is an authenticated JSON/base64 RPC backed by private PostgreSQL bytea storage, bounded to 32 MiB per file and 1 GiB/1000 immutable records per organization. These are transport/storage bounds, not limits on the number of files in a comment. Larger artifacts require a future chunked/blob transport. Base64 and decoded buffers create multiple bounded copies; 32 MiB does not imply a 32 MiB peak memory limit.

Every metadata lookup, upload and download checks discussion visibility plus full-content access. Known roots require full replay mode, and restricted roots require a replay-level grant for non-owners. Metadata-only grants and fully deleted roots cannot expose bytes. Rootless conversations retain their existing membership boundary. Revoked access blocks new reads, while downloaded bytes cannot be recalled. No public links or direct authenticated table access exist. SHA-256, ID, filename and size are checked at the client boundary. Account/endpoint changes discard stale reads and stop later writes; close aborts metadata/byte requests and releases object URLs. Sender paths are private index metadata visible only under session access.

The native capability additions enable bounded handle reads/stat and saving binary bytes. Existing filesystem scope rules still apply; the save dialog selects the destination. `frame-src blob:` permits the sandboxed PDF preview. No Rust implementation or public transcript/comment wire schema changed. The optional local cursor marker is backward-compatible; older desktops ignore it and may repeat a one-time file backfill after a downgrade/upgrade.

## Deployment and rollback

Apply infra migration `0033_shared_session_files.sql` before releasing the desktop. It adds one private table, four guarded RPCs, indexes and a capability flag while preserving prior flags. Unsupported backends skip automatic publication; explicit comment uploads fail visibly rather than claiming success. Old clients need upgrading to use the new links.

Rollback the desktop to stop publication, retaining cloud table/RPCs and bytes. Do not drop uploaded data for rollback. Abandoned uploads and old versions count toward quotas; no automatic retention/deletion or quota-management UI is added. Before reclaiming storage, inventory IDs/references/owners, export selected bytes and obtain authorization for narrowly scoped deletion.

## Architecture review

| Layer             | Coverage                                                                                     |
| ----------------- | -------------------------------------------------------------------------------------------- |
| 1 Compilation     | TypeScript, native JSON configuration and SQL migration checked; no Rust source change       |
| 2 Ownership       | One bounded reader, upload client, source registry and viewer; sync/delivery own retries     |
| 3 Naming          | Shared files distinct from replay segments, local file paths and comments                    |
| 4 Semantics       | Bytes belong to immutable records; session membership governs access; mentions grant nothing |
| 5 Defaults        | Unsupported/missing/ambiguous/denied files never fall back to receiver disk                  |
| 6 Boundaries      | Pure candidate/reference parsing; lazy IO; server ACL, version and quota enforcement         |
| 7 Discoverability | Explicit generic session publication and separate comment preparation                        |
| 8 Wire            | JSON/base64, SHA-256, optional cursor marker and capability flag; no replay hash rewriting   |
| 9 Entry parity    | User messages, agent outputs, Edits, shared conversation turns, comments and Inbox           |
| 10 Resolution     | Endpoint/account/source-session identity and author ambiguity checks                         |

All ten relevant layers reviewed; provider ingestion internals and Rust architecture were intentionally outside the change.

## Performance review

| Area                  | Verdict | Evidence                                                          | Change or reason kept                                              | Verification                                                    |
| --------------------- | ------- | ----------------------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------- |
| Background lifecycle  | keep    | Existing sync/delivery owner; no new poller or scanner            | One migration backfill per cursor, then normal dirty-event work    | Backfill regression verifies the next idle pass does not reread |
| IO                    | keep    | Sequential uploads, manifest batches <=64, durable revision dedup | Already-published sources do not reread bytes                      | 65-file batching and resume tests                               |
| Memory                | keep    | One bounded file upload at a time; viewer loads on click          | No app-lifetime file cache; object URLs revoked                    | Read bounds, abort and stale identity tests; RSS not measured   |
| Identity/isolation    | keep    | Live ACL plus endpoint/account guards                             | Close aborts lookup/download; source metadata is access-controlled | JSDOM lifecycle and PostgreSQL ACL tests                        |
| Hidden/idle rendering | keep    | Shared links and hover state do not read local files              | No network work solely from rendering a link                       | Code-path inspection and existing renderer regression suites    |

Runtime performance verdict: **blocked pending measurement**. Visible/hidden idle CPU/RSS, repeated native open/save, real authenticated HTTP transport, reconnect, two-account Tauri operation and screenshots have not been exercised. PostgreSQL/JSDOM tests are boundary evidence, not a dual-machine acceptance claim.

## Verification

Typecheck, changed-file ESLint and **153 tests across 18 files passed**. Native configuration JSON parsed successfully; SQL regression passed.

- `pnpm typecheck:fast`
- Changed-file lint: `pnpm exec eslint <all changed and new .ts/.tsx paths> --max-warnings 0` (paths enumerated from `git diff --name-only HEAD` and `git ls-files --others --exclude-standard`)
- Focused Vitest: file client/reference/read/publication/viewer tests, comment delivery, session sync, conversation queue, comment context, capabilities, Inbox, local images, user-message rendering and Markdown URL handling
- `pnpm check:circular`: three pre-existing cycles in SessionCore/slash-command and SessionHoverCard, reproduced on an isolated archive of the untouched base; no new cycle
- `git diff --check` and native JSON parsing
- Infra: `psql -h 127.0.0.1 -p 55439 -d shared_files_v4 -v ON_ERROR_STOP=1 -f scripts/cloud/test-shared-session-files.sql`

The SQL suite ran on isolated PostgreSQL 17 with Supabase auth/realtime shims, the real baseline and migrations 0024, 0027, 0031, 0033. It checks binary roundtrip, immutable retries, source/latest-version lookup, author isolation/ambiguity, member uploads, restricted/revoked/metadata-only/deleted/anonymous access, rootless conversations, removed membership, filename/size validation and count/byte quotas. Test transactions roll back. No production deployment or production data change has been performed.

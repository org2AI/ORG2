# Shared session files

## Problem and authoritative boundary

Shared transcripts and comments previously persisted sender-local paths without transporting file bytes. A teammate could read the session but could not open those paths. The authoritative fix is a private cloud file registry plus sender-side publication. Mentions do not grant access or turn a local path into a shared object.

## Implemented behavior

- Shared-session user file references, completed agent writes/edits, multi-file patches and explicit Markdown file/image outputs publish real bytes. Publication runs in the existing replay and conversation-delivery lifecycles. It does not scan unrelated workspace files or upload read-only tool results.
- Existing replay cursors receive one full-history file backfill when the backend advertises support. A persisted optional `sharedFilesVersion: 1` marker prevents repeating that read on idle/restart; normal event changes continue through the existing incremental path. Missing historical files cannot be reconstructed: the sender must still hold their bytes. No historical transcript/comment data is rewritten or deleted.
- File pills, output links, inline file links, code-block file actions, Edits and Inbox references use the shared-session source index. Shared file previews do not read a receiver's same-named local file. Comments are another entry point and carry immutable `orgii-file` IDs after preparation; there is no five-files-per-comment product rule.
- A source key includes session, uploader, path and event revision. Batch metadata lookup (64 records/request) avoids reading already-published files. Uploads are sequential. Repeating a source revision with different bytes is rejected; independent versions remain immutable. Unqualified paths written by multiple authors fail as ambiguous rather than opening another author's file.
- Source snapshots contain bytes at publication time, not a reconstructed historical version. A changed-during-read file is rejected. Missing/oversized source files produce no available-file record; replay can still sync. Network upload failures remain owned by the existing retry lifecycle and can delay replay or turn completion.
- Text previews are escaped UTF-8 up to 128 KiB. Images and PDFs use revocable object URLs; PDF rendering is sandboxed. The Download button saves directly to the operating system Downloads directory, with no save-location dialog. Exclusive file creation adds numbered suffixes for collisions; failed saves leave the preview visible. Text preview passed native macOS desktop verification; image/PDF behavior still requires packaged-desktop verification.

## Bounds, security and compatibility

Current transport is an authenticated JSON/base64 RPC backed by private PostgreSQL bytea storage, bounded to 32 MiB per file and 1 GiB/1000 immutable records per organization. These are transport/storage bounds, not limits on the number of files in a comment. Larger artifacts require a future chunked/blob transport. Base64 and decoded buffers create multiple bounded copies; 32 MiB does not imply a 32 MiB peak memory limit.

Every metadata lookup, upload and download checks discussion visibility plus full-content access. Known roots require full replay mode, and restricted roots require a replay-level grant for non-owners. Metadata-only grants and fully deleted roots cannot expose bytes. Rootless conversations retain their existing membership boundary. Revoked access blocks new reads, while downloaded bytes cannot be recalled. No public links or direct authenticated table access exist. SHA-256, ID, filename and size are checked at the client boundary. Account/endpoint changes discard stale reads and stop later writes; close aborts metadata/byte requests and releases object URLs. Sender paths are private index metadata visible only under session access.

The native capability additions enable bounded handle reads/stat and saving binary bytes. Existing filesystem scope rules still apply; Downloads additionally has an explicit scope and existence-check permission for collision handling. Writes use exclusive creation and never truncate an existing download. `frame-src blob:` permits the sandboxed PDF preview. The only Rust implementation change is debug-WebDriver macOS startup isolation; production startup and the public transcript/comment wire schema are unchanged. The optional local cursor marker is backward-compatible; older desktops ignore it and may repeat a one-time file backfill after a downgrade/upgrade.

## Deployment and rollback

Apply infra migration `0033_shared_session_files.sql` before releasing the desktop. It adds one private table, four guarded RPCs, indexes and a capability flag while preserving prior flags. Unsupported backends skip automatic publication; explicit comment uploads fail visibly rather than claiming success. Old clients need upgrading to use the new links.

Rollback the desktop to stop publication, retaining cloud table/RPCs and bytes. Do not drop uploaded data for rollback. Abandoned uploads and old versions count toward quotas; no automatic retention/deletion or quota-management UI is added. Before reclaiming storage, inventory IDs/references/owners, export selected bytes and obtain authorization for narrowly scoped deletion.

## Architecture review

| Layer             | Coverage                                                                                     |
| ----------------- | -------------------------------------------------------------------------------------------- |
| 1 Compilation     | TypeScript, native configuration, debug WebDriver startup and SQL migration checked          |
| 2 Ownership       | One bounded reader, upload client, source registry and viewer; sync/delivery own retries     |
| 3 Naming          | Shared files distinct from replay segments, local file paths and comments                    |
| 4 Semantics       | Bytes belong to immutable records; session membership governs access; mentions grant nothing |
| 5 Defaults        | Unsupported/missing/ambiguous/denied files never fall back to receiver disk                  |
| 6 Boundaries      | Pure candidate/reference parsing; lazy IO; server ACL, version and quota enforcement         |
| 7 Discoverability | Explicit generic session publication and separate comment preparation                        |
| 8 Wire            | JSON/base64, SHA-256, optional cursor marker and capability flag; no replay hash rewriting   |
| 9 Entry parity    | User messages, agent outputs, Edits, shared conversation turns, comments and Inbox           |
| 10 Resolution     | Endpoint/account/source-session identity and author ambiguity checks                         |

All ten relevant layers reviewed; provider ingestion internals were intentionally outside the change. The debug-only native startup change is limited to isolated WebView storage.

## Performance review

| Area                  | Verdict | Evidence                                                          | Change or reason kept                                              | Verification                                                    |
| --------------------- | ------- | ----------------------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------- |
| Background lifecycle  | keep    | Existing sync/delivery owner; no new poller or scanner            | One migration backfill per cursor, then normal dirty-event work    | Backfill regression verifies the next idle pass does not reread |
| IO                    | keep    | Sequential uploads, manifest batches <=64, durable revision dedup | Already-published sources do not reread bytes                      | 65-file batching and resume tests                               |
| Memory                | keep    | One bounded file upload at a time; viewer loads on click          | No app-lifetime file cache; object URLs revoked                    | Read bounds, abort and stale identity tests; RSS not measured   |
| Identity/isolation    | keep    | Live ACL plus endpoint/account guards                             | Close aborts lookup/download; source metadata is access-controlled | JSDOM lifecycle and PostgreSQL ACL tests                        |
| Hidden/idle rendering | keep    | Shared links and hover state do not read local files              | No network work solely from rendering a link                       | Code-path inspection and existing renderer regression suites    |

Runtime performance verdict: **bounded lifecycle checks passed; complete resource acceptance UNCOVERED**. Authenticated HTTP, two-account native text previews, repeated opens, source-removal faults and two cold boots per account passed. Sequential publication, durable deduplication and unchanged cloud event epochs were observed. Backend CPU/RSS sampling was collected, but does not attribute WebKit child-process memory or establish full visible/hidden idle baselines; no whole-app CPU/RSS improvement is claimed.

## Verification

Typecheck, changed-file ESLint and **162 tests across 19 files passed**. Native configuration JSON parsed successfully; SQL regression passed.

- `pnpm typecheck:fast`
- Changed-file lint: `pnpm exec eslint <all changed and new .ts/.tsx paths> --max-warnings 0` (paths enumerated from `git diff --name-only HEAD` and `git ls-files --others --exclude-standard`)
- Focused Vitest: file client/reference/read/publication/viewer tests, comment delivery, session sync, conversation queue, comment context, capabilities, Inbox, local images, user-message rendering and Markdown URL handling
- `pnpm check:circular`: three pre-existing cycles in SessionCore/slash-command and SessionHoverCard, reproduced on an isolated archive of the untouched base; no new cycle
- `git diff --check` and native JSON parsing
- Infra: `psql -h 127.0.0.1 -p 55439 -d shared_files_v4 -v ON_ERROR_STOP=1 -f scripts/cloud/test-shared-session-files.sql`

The SQL suite ran on isolated PostgreSQL 17 with Supabase auth/realtime shims, the real baseline and migrations 0024, 0027, 0031, 0033. It checks binary roundtrip, immutable retries, source/latest-version lookup, author isolation/ambiguity, member uploads, restricted/revoked/metadata-only/deleted/anonymous access, rootless conversations, removed membership, filename/size validation and count/byte quotas. Test transactions roll back. No production deployment or production data change has been performed.

## Desktop test setup

The shared-file scenarios extend the existing `cloud-dual-instance-ui.spec.mjs` core spec. Set `E2E_SHARED_FILES_FIXTURE` to a private JSON fixture and `E2E_SHARED_FILES_ARTIFACTS` to a disposable evidence directory. For the additional real-provider cell, set `E2E_SHARED_FILES_LIVE=1`, `E2E_PROVIDER_MODE=api-key`, `E2E_OPENAI_ACCOUNT`, `E2E_API_AGENT_TYPE`, and `E2E_OPENAI_MODEL` to an existing runnable API-key account and model. Put only that account in the isolated home before startup (temporary seed directories are excluded by the harness); do not clone OAuth refresh chains. Fixture fields are `supabaseUrl`, `webOrigin`, `anonKey`, `orgId`, and `users` (two distinct entries with `userId`, `accessToken`, `refreshToken`, `expiresAt`). Never commit credentials. Both users must be active members of the organization; configure its repository scope as `github.com/orgii/e2e-workspace` using the owner RPC and read it back.

The isolated backend used PostgreSQL 17 plus real PostgREST v12.2.12, with the repository's real SQL migrations. A localhost proxy forwards `/rest/v1` bytes unchanged and supplies CORS. JWTs are independently signed fixture identities verified by PostgREST. Auth seeding establishes a session; it does not test login or token refresh. No production Supabase data or deployment was used. Realtime, GoTrue and blob Storage daemons are absent; the test uses the rendered Team sessions refresh button. Inline replay tails and file RPCs are real; frozen replay segments and live notifications remain uncovered.

Source sessions are persisted through the native session command before their deterministic completed turns enter EventStore/SQLite. Those original four cells use deterministic completed turns. The additional real-provider cell below does not seed history or prewrite the output file. The sharing dialog, sync engine, filesystem read, authenticated upload, remote replay opening and file click all use production paths. Tests move the source files away while the receiver opens both user and agent bytes, preventing accidental receiver-local fallback. Native macOS screenshots use WindowServer capture of the process listening on the isolated backend port; the WebDriver plugin's SVG/DOM screenshots lose styles and are not accepted as native visual evidence.

Test setup corrections: atom-only sessions were removed by the authoritative directory refresh, so persisted fixtures are required. Raw macOS WebDriver executables also shared the default WKWebView store. Tauri 2.10's configuration conversion omits `data_store_identifier`; the debug-only startup now calls the WebView builder directly with a stable identifier derived from the isolated native home. Secondary builds preserve the exact primary binary for cold-boot tests.

A real upload probe exposed an empty extracted source path being resolved to the workspace directory. The path boundary now rejects empty values before applying the workspace root; a producing-boundary regression covers it. No cloud file record was created for the directory, and no historical cleanup is needed.

## Final desktop result

2026-09-10 final native run: **4/4 scenarios passed** in 1m37s (excluding native builds). Both app binaries were built from the worktree with `--features webdriver`. Two separate signed users, native homes, backend ports and WKWebView stores were checked. The same source files were unavailable locally while their cloud bytes rendered on the receiving account.

| Cell                              | Result                | Evidence                                                                                                                                                                                                                                                                   |
| --------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A → B user and agent files        | PASS                  | Real filesystem reads → authenticated uploads → receiver replay/file clicks; exact bytes; repeated open                                                                                                                                                                    |
| B → A user and agent files        | PASS                  | Same checks with roles reversed                                                                                                                                                                                                                                            |
| Source removed before publication | PASS, both directions | No available-file record; remaining files and replay still publish; expected missing-source diagnostic                                                                                                                                                                     |
| Owner revokes access              | PASS                  | Receiver RPC denied; reopening displays an error; owner restores the fixture share                                                                                                                                                                                         |
| Two cold boots per account        | PASS                  | Persisted identities, three sync passes each boot, immutable IDs and receiver text previews                                                                                                                                                                                |
| Fleet invariants                  | PASS for sampled run  | 23 snapshots across all three visible organizations: six pre-existing rows unchanged; exactly two scenario rows added; seven explained new-row/metadata timestamp changes; epochs stay 1, event counts stay 3; no deletion/access-mode downgrade                           |
| Native visual checks              | PASS, scoped          | Actual WindowServer screenshots: default light theme, text preview, user reference and denied state                                                                                                                                                                        |
| Full dual-instance protocol       | UNCOVERED             | Production Supabase/Realtime/GoTrue/Storage, reverse-direction live generation, /compact, owner/guest live forks, imported-cache wipe, old-build→new-build upgrade, non-text download/PDF/image, dark/narrow/loading states and complete process-family resource profiling |

The ledger's only modified session IDs belong to this run. Reboot metadata upserts and explicit drained sync passes prove liveness; constant epochs are not inferred from idle engines. The one INFO `retract reconcile: covering 1 background org(s)` line enumerates organizations with local push markers before reconciliation (`org2CloudSyncEngine.ts`); the ledger shows no tombstone, mode downgrade or epoch rewrite. The two initial epoch-1 replay writes are initial publication, not replacement of pre-existing history. See [cloud ledger](shared-session-files/cloud-ledger.json).

Log triage: missing-source warnings are the intentional reader fault. Realtime/presence channel errors are from the absent local daemon. Git default-branch/fetch errors come from the fixture's synthetic remote, which has no hosted repository. No startup watchdog, forced-splash or CRITICAL line occurred in the final run. Earlier setup attempts failed (missing prerequisite migrations, ephemeral fixture rows, default WebView storage, and screenshot capture); they are not counted as successful validation. An immediate cold-boot click in an earlier attempt raced replay hydration; the final test waits for the same rendered anchor to survive successive polls before the single click.

**Open defect outside this feature:** an empty imported cache (`eventCount: 0`) returns `timeRangeStart/timeRangeEnd: null`, while the existing RPC schema accepts optional strings, producing an output-validation error during import. The authoritative boundary is native cache metadata serialization versus `src/api/tauri/rpc/schemas/sessionCore.ts`; these paths are unchanged by this PR. Import subsequently loads the three real events and every file assertion passes, but this is a defect, not an error-free/full-protocol acceptance claim. It requires a separate cache-contract fix.

### Exact final desktop command

```sh
E2E_ISOLATED_RUN=1 E2E_ORGII_HOME=/tmp/orgii-shared-files-desktop/home-a-v9 E2E_ORGII_HOME_SEED_SOURCE=/tmp/orgii-shared-files-desktop/empty-home E2E_FRONTEND_PORT=21998 E2E_WEBDRIVER_PORT=24444 E2E_IDE_SERVER_PORT=13877 E2E_SECONDARY_IDE_SERVER_PORT=13878 E2E_SECONDARY_WEBDRIVER_PORT=24445 E2E_SHARED_FILES_FIXTURE=/tmp/orgii-shared-files-desktop/fixture.json E2E_SHARED_FILES_ARTIFACTS=/tmp/orgii-shared-files-desktop/evidence-v9 pnpm --dir tests/e2e test -- --spec ./specs/core/cloud-dual-instance-ui.spec.mjs --mochaOpts.grep 'Shared session files'
```

### Exact focused unit command

```sh
pnpm test "src/features/Org2Cloud/prepareSharedCommentFiles.test.ts" "src/features/Org2Cloud/sharedSessionFilesClient.test.ts" "src/features/Org2Cloud/sharedSessionFileReference.test.ts" "src/features/Org2Cloud/org2CloudSessionCommentsAtom.delivery.test.ts" "src/features/Org2Cloud/SharedSessionFileViewer.test.ts" "src/features/Org2Cloud/sessionSharedFileCandidates.test.ts" "src/features/Org2Cloud/syncSessionSharedFiles.test.ts" "src/features/Org2Cloud/org2CloudSessionSync" "src/features/Org2Cloud/SessionConversation/cloudConversationQueueAdapter.test.ts" "src/features/Org2Cloud/SessionComments/SessionCommentsContext.test.ts" "src/features/Org2Cloud/org2CloudCapabilities.test.ts" "src/modules/MainApp/TeamInbox/__tests__/CommentMentionDetail.test.ts" "src/components/MarkDown/MarkdownLocalImage.test.ts" "src/engines/ChatPanel/ChatHistory/components/__tests__/UserMessageContent.test.ts" "src/components/MarkDown/markdownUrlTransform.test.ts"
```

## Real model and direct download follow-up

A new native A → B cell uses the existing API-key account with DeepSeek V4 Pro through the production `launchSession` bridge. The provider invokes `edit_file`, then returns a final Markdown answer. Neither the file nor assistant history is seeded. The receiver selector is restricted to `[class~="group/agent-message"] a[href="<generated absolute path>"]`; the user prompt contains no Markdown link, so a user-message link cannot satisfy the assertion.

The receiver opens the actual assistant answer after the source file is moved offline. Preview text, authenticated cloud bytes and both native Downloads files match exactly. Clicking Download twice creates the original basename and ` (1)` variant without a save-location dialog, using atomic exclusive creation. The test reads both files back and removes only its uniquely named download fixtures. Download failures retain the preview and use a localized error toast; unit tests cover disk/permission failure, collision bounds, stale identity and unsafe names.

The original missing-source, bidirectional deterministic upload, revocation and two-cold-boot cells are rerun alongside the live cell. The complete lifecycle matrix is still not claimed: live generation is A → B only, production Supabase services are not deployed, and PDF/image, non-text download, upgrades, compaction/forks and full process-family resource profiling remain uncovered.

Earlier attempts exposed local test setup issues (database restart port and excluded temporary credential seed), and one existing relay account could not connect. A completed live-file attempt also used an ambiguous link selector; it is not counted as proof of clicking the assistant answer. The final run removes that ambiguity. The provider title side-query initially rejects `thinking:disabled` with HTTP 400 and succeeds through its existing padded-token retry; the main file-generation turn completes. The previously documented empty-cache metadata contract defect remains open.

[Provider/file evidence](shared-session-files/real-provider.json)

Final strict native run: **5/5 passed**, 2m9.1s scenario time (2m16s harness time, excluding builds). The two existing isolated native binaries were rebuilt from the changed worktree. All pre-existing fleet rows remained unchanged; three new scenario rows (one live, two deterministic) retain epoch 1 with nondecreasing event counts. Explicit sync passes and cold-boot metadata writes establish liveness. No watchdog, forced-idle, forced-splash, retry-exhaustion or epoch rewrite was found in either instance's logs. INFO retract-reconcile lines enumerate the organization; no tombstones or access downgrades occurred. See [live cloud ledger](shared-session-files/live-cloud-ledger.json).

```sh
E2E_PROVIDER_MODE=api-key E2E_OPENAI_ACCOUNT=ds1 E2E_API_AGENT_TYPE=deepseek_api E2E_OPENAI_MODEL=deepseek-v4-pro E2E_SHARED_FILES_LIVE=1 E2E_ISOLATED_RUN=1 E2E_ORGII_HOME=/tmp/orgii-shared-files-desktop/home-live-v5 E2E_ORGII_HOME_SEED_SOURCE=/tmp/orgii-shared-files-desktop/empty-home E2E_FRONTEND_PORT=21998 E2E_WEBDRIVER_PORT=24444 E2E_IDE_SERVER_PORT=13877 E2E_SECONDARY_IDE_SERVER_PORT=13878 E2E_SECONDARY_WEBDRIVER_PORT=24445 E2E_SHARED_FILES_FIXTURE=/tmp/orgii-shared-files-desktop/fixture.json E2E_SHARED_FILES_ARTIFACTS=/tmp/orgii-shared-files-desktop/evidence-live-v5 pnpm --dir tests/e2e test -- --spec ./specs/core/cloud-dual-instance-ui.spec.mjs --mochaOpts.grep 'Shared session files'
```

Follow-up checks: `pnpm exec tsgo --noEmit`; `pnpm exec eslint src/features/Org2Cloud/downloadSharedSessionFile.ts src/features/Org2Cloud/downloadSharedSessionFile.test.ts src/features/Org2Cloud/SharedSessionFileViewer.tsx src/features/Org2Cloud/SharedSessionFileViewer.test.ts`; focused Vitest suite including the new direct-download tests (**162/162 across 19 files**); `node --check tests/e2e/specs/core/cloud-dual-instance-ui.spec.mjs`; `git diff --check`. All passed.

Screenshots are omitted at the author’s request: the native execution results, exact-byte assertions and ledger records provide the requested verification evidence.

## Review corrections

The file RPC boundary previously formatted HTTP status into plain error text. The conversation queue classifies structured status, so HTTP 5xx could incorrectly close an already-admitted turn. `SharedSessionFileRequestError` retains the status; an unconfirmed capability probe is explicitly recovery-pending. Regression tests inject real HTTP 503 responses through the file client during both user-file publication and accepted Agent-tail publication, for lookup and upload separately, and assert that no failed terminal receipt is written. HTTP 403 remains definitive.

File origin previously reused comment admission plus current authentication, which both diverted local transcript links to Cloud and dropped remote identity after logout. The provider now derives source coordinates only from persisted `session.importedFrom`, independently of comment membership/auth state. Local transcripts and writable forks retain local navigation even if they have a comment target. Remote replay paths remain remote after logout, target loss or account switch, including local-image read suppression. Explicit immutable shared-ID links remain remote on every surface. Legacy replay rows with no recorded source endpoint fail closed instead of guessing the currently selected backend; their origin metadata must be restored by the import path before source-path navigation can work.

No persisted data was rewritten and no historical cleanup was performed. These fixes correct future error classification/navigation; they do not automatically reopen turns already closed by an older client. There are no new timers or subscriptions; recovery uses the existing idempotent queue owner. Architecture scope: RPC error contract, queue ownership and transcript-origin projection. The prior 5/5 native run predates these review corrections; the new failure/logout/local-origin cases are covered by boundary and rendered regression tests, not claimed as a new full dual-instance run.

The rebased Frontend job failed at `pnpm check:i18n-keys`: 70 missing keys (seven shared-file keys in ten locales), before unit tests ran. All ten translations are now populated, with no baseline suppression. `pnpm check:i18n-keys` reports zero locale gaps, extras or placeholder mismatches.

Review-fix verification: `pnpm test` — 1,787 files passed; 13,379 tests passed and one skipped (219.60s). `pnpm exec tsgo --noEmit`, ESLint on the seven changed TypeScript files with `--max-warnings 0`, `pnpm check:i18n-keys`, `pnpm run check:test-placement`, and `git diff --check` passed. The full suite includes the four HTTP-503 queue cases and remote-origin/local-navigation regressions described above.

# Shared session stack integration — 2026-09-24

## Deployed boundaries

- Infrastructure #147: share capability file reads; migration 0034 deployed by run 36044345326.
- Infrastructure #149: member reads by exact uploader/path/revision; migration 0035 deployed by run 36044574872.
- Infrastructure #150: guest reads by exact uploader/path/revision within the authoritative capability scope; migration 0036 deployed by run 36046037689.
- Client #2124: continuation error classification and identity-partitioned remembered setup merged as `988cf8311254859bc717519dda25ac349aedc835`.
- Client #2127: immediate attachment loading feedback and retry merged as `1a9031dab317895f7e36f5b38678226abc10ad96`.
- Client #2123: share capability propagation merged as `0f910f5e7c67e27442cbb000e205f8a4daed3630`.

## Integration defect and fix

Combining guest access (#2123), immediate feedback (#2127), and event provenance (#2139) revealed that the exact-version branch still used the member-only lookup. The producing boundary is the request builder in `sharedSessionFilesClient.ts`; the mounted replay supplies the capability through `SharedSessionFilesContext` and the viewer. Preserve that capability through the per-event provider and select the guest exact-version RPC. Neither a missing version nor a permission denial triggers a path-only or member-API fallback.

The server resolves the capability before looking up any file. The capability determines the organization and session; a client-provided uploader is a version selector, never an authorization grant. No historical data was rewritten or removed.

## Evidence

- Disposable PostgreSQL: the existing guest access and member version SQL suites still pass with migration 0036 installed. The new guest version suite passes same-path/two-uploader reads, missing revision/uploader, unchanged ambiguity rejection, authoritative grant scope despite a metadata alias, invalid inputs, and eight denial states (bad token, anonymous, revoked, expired, retention, metadata-only, deleted session, deleted organization).
- Production HTTP/JWT in an authorized disposable test organization: 10 checks pass, including bidirectional member reads, guest exact-version reads for both uploaders, byte and SHA-256 equality, no latest-version substitution, unchanged member-only permissions, and revoked capability denial. Test transcript counts, epochs, visibility, access mode, and deletion state remain unchanged.
- Fleet ledger after RPC and the failed desktop run: 3510 pre-existing rows unchanged, zero missing rows, four new test session rows. The 768 pre-existing rows with epoch greater than 3 remain unchanged. They are historical findings, not remediated by this stack.
- Combined outbox/snapshot/provenance/guest/feedback checkout: 9 focused Vitest files / 110 tests passed; TypeScript passed. After integrating current develop and continuation recovery, 7 affected suites / 99 tests passed. These counts overlap and must not be summed.
- The normal hooks caught a duplicate context declaration during a squash-merge conflict resolution; it was corrected before publication and the affected suites rerun. No hook was bypassed.

## Failed real desktop acceptance

The final combined WebDriver build completed. A rendered send reached real Claude Code and returned the requested marker. This proves a real default/ambient Claude response, not the intended named account/model: the UI showed Default and the persisted launch had null account/model even though a setup helper returned a selection.

Sharing then failed: the native JSONL was written into the real user's default Claude home, while the isolated instance's history resolver searched its isolated roots. `NativeTranscriptReconcile` and cloud publication reported history file not found; the cloud body remained at zero segments. The test failed and both instances were stopped. The launcher must route an ambient isolated launch into the same root that discovery reads, and the test must assert rendered and persisted selection. Do not broaden isolated discovery into the real home to hide the mismatch. No historical transcript was moved or deleted.

Both instances' INFO-through-error effect-log audit found two matching lines: each client rejected the three RPC-only synthetic rows because their test metadata omitted `id`. These are local schema-filter diagnostics, not cloud deletes; the post-run ledger confirms no original rows changed or disappeared. Future desktop fixtures must provide complete metadata. This run does not establish clean rendered roster acceptance.

## Isolated desktop rerun and workspace fix

The next combined build included #2146. A real ambient/default Claude base turn persisted in the primary's isolated external-history root; the corresponding real-home JSONL did not exist. Its body uploaded and rendered on the secondary, which successfully continued with the base marker. This fixes the previously failed isolation/body boundary. The first continuation then exposed a separate attachment defect: the absolute Write artifact uploaded successfully, but the final relative Markdown link lacked its own receipt because published output had no sender workspace.

The settled-turn producer now carries the persisted execution directory in the existing `repoPath` event field. The lightweight test frontend disables hot reload: copying the patch and recompiling alone left one pre-refresh attempt on old JavaScript. That attempt is recorded as pre-fix behavior. Both WebViews were then explicitly refreshed and a fresh base/share/continuation scenario was run.

The patched scenario proved:

- A real Claude base reply was shared from A and rendered on B. B's real continuation recalled that marker, wrote `scope2-proof.txt`, and published an explicitly relative Markdown link plus the persisted sender directory.
- Both authenticated users resolved the final answer's exact uploader/path/revision receipt and downloaded identical 27-byte content. SHA-256: `c206970e4eaaf012222a7810930ed373776db2a2bcd0894a431fd54820ce5119`.
- Each rendered app opened the final answer's link in the cloud attachment viewer. After overwriting the owned test source file, both reopened viewers still rendered the original bytes, with the Download control present.
- A continued again without tools or file links, correctly recalled B's marker, and B rendered A's new answer. The new cloud tail contained only the new user/start/assistant events. Read-only SQLite inspection found no owner outbox or snapshot rows for B's file; B retained uploaded snapshots for the Write and final-answer revisions, with an empty pending outbox.
- The fleet ledger went from 3514 to 3517 rows: three deliberately created test sessions, zero changed pre-existing rows, zero missing rows and zero changes outside the test organization. All 768 historical high-epoch rows remained unchanged.
- The INFO-through-error destructive-effect audit found watchdog _startup_ messages and housekeeping reports with all removal/eviction counts zero. Six terminal-mirror gate warnings on B match the explicit `cliSessionStatusAtom` guard: hidden execution IDs differ from the visible imported-root ID, so they do not replace its global status mirror. Actual canonical continuation completion and receiver rendering were independently observed. No watchdog recovery fire or destructive cloud effect was observed.

The run used two isolated instances on one Mac, not two physical machines. Account/model setup-helper output alone is not selection evidence. For the final refreshed scenario, persisted launch rows confirmed `claude-sonnet-4-6` on both sides: A used its auto-detected test account, while B had a null account and used ambient authentication. WebDriver screenshots were inspected and found black/unreadable, so they are **not** visual acceptance evidence. DOM visibility/content assertions and exact cloud byte reads establish the behavior above; native UI capture also remained unavailable because the computer-use connector had no auth token. Reload-time repository-fixture/terminal warnings, the screenshot defect, and complete lifecycle/resource acceptance remain open.

Workspace-fix commands: `pnpm test src/engines/SessionCore/conversations/localConversationArtifactScope.test.ts src/engines/SessionCore/conversations/localConversationContinuation.test.ts src/features/Org2Cloud/SessionConversation/conversationTurnRunner.test.ts src/features/Org2Cloud/sessionSharedFileCandidates.test.ts src/features/Org2Cloud/SessionConversation/conversationPlaneEvents.test.ts src/features/Org2Cloud/conversationFileOutbox.test.ts src/features/Org2Cloud/sharedSessionFilesClient.test.ts` — 7 files / 125 tests passed. `pnpm run typecheck:fast`, changed-file `pnpm exec eslint`, and `git diff --check` passed. `node scripts/quality/dependency-boundaries/check.mjs` — 8888 modules, 3 existing edges, 0 new forbidden edges. Counts overlap earlier runs and are not summed.

## Remaining acceptance

| Surface                                                               | Status                                                                                |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Server SQL and real JWT/RPC                                           | Passed as described above                                                             |
| Combined client unit behavior                                         | Passed as described above                                                             |
| Full rendered A-to-B and B-to-A continuation                          | Base A→B, B continuation→A and A follow-up→B passed; full lifecycle matrix incomplete |
| Real Claude Code continuation                                         | Real base, peer continuation and owner follow-up passed as described above            |
| Real Luna reserve continuation                                        | Prior run exposed provenance defects; final combined run pending                      |
| Visible/hidden idle, repeated open/close, restart and fault injection | Not completed for the final combined build                                            |
| Guest expiry/revocation in rendered WebView                           | Not completed for the final combined build                                            |
| Original 164-item semantic-prefix incident                            | Exact failing transcripts unavailable; not reproduced or claimed fixed                |
| WebDriver `no pending script with that id` / mutex poison             | Open test-driver defect from prior acceptance                                         |
| Historical high-epoch/polluted data                                   | Inventoried only; no destructive remediation                                          |

Performance verdict: blocked for the final stack until the remaining rendered lifecycle and resource measurements finish. Prior bounded-snapshot native measurements do not establish whole-app or WebKit performance.

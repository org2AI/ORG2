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

## Remaining acceptance

| Surface                                                               | Status                                                                 |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Server SQL and real JWT/RPC                                           | Passed as described above                                              |
| Combined client unit behavior                                         | Passed as described above                                              |
| Full rendered A-to-B and B-to-A continuation                          | Failed at Claude body publication; rerun after launch isolation fix    |
| Real Claude Code continuation                                         | Base response passed; body sharing failed before continuation          |
| Real Luna reserve continuation                                        | Prior run exposed provenance defects; final combined run pending       |
| Visible/hidden idle, repeated open/close, restart and fault injection | Not completed for the final combined build                             |
| Guest expiry/revocation in rendered WebView                           | Not completed for the final combined build                             |
| Original 164-item semantic-prefix incident                            | Exact failing transcripts unavailable; not reproduced or claimed fixed |
| WebDriver `no pending script with that id` / mutex poison             | Open test-driver defect from prior acceptance                          |
| Historical high-epoch/polluted data                                   | Inventoried only; no destructive remediation                           |

Performance verdict: blocked for the final stack until the remaining rendered lifecycle and resource measurements finish. Prior bounded-snapshot native measurements do not establish whole-app or WebKit performance.

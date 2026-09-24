# Shared artifact provenance

## Producing boundary and invariant

The provider-native transcript is execution history. Materializing another participant's history does not grant ownership of the files it mentions. Previously replay discovery re-read those paths on the owner's machine and uploaded them under the owner's identity. The mounted owner transcript also lacked remote-file interception, and imported viewers resolved only by path. Together these produced duplicate uploaders, ambiguity errors, and local-file navigation for guest output.

Artifact discovery now excludes canonical cloud projections and materialized native source rows before any filesystem read. New local user references, writes and assistant Markdown/file links remain eligible. Canonical plane projection derives artifact uploader, root, revision and workspace from the authenticated row envelope/original payload. It replaces untrusted payload provenance and stamps native/local twins as well as plane-only rows. Per-event interception uses that origin on both imported and owner views. Missing parent scope remains intercepted and fails locally instead of falling through to disk. Local owner output without a remote origin retains local navigation.

The viewer uses the additive exact-version RPC from cloud-infra migration 0034. It never falls back to a latest path match. Provider content and semantic-prefix checks are unchanged; the existing native projection excludes `__orgii` presentation metadata from tool arguments.

## Audit coverage

| Layer                     | Verdict | Evidence                                                                |
| ------------------------- | ------- | ----------------------------------------------------------------------- |
| 1 Compilation             | pass    | tsgo and changed-file ESLint                                            |
| 2 Ownership/deduplication | fix     | one candidate admission function used by replay and continuation outbox |
| 3 Naming                  | keep    | artifact origin differs explicitly from native source-event identity    |
| 4 Semantics               | fix     | native replay is not local file production                              |
| 5 Defaults                | fix     | missing exact version/scope never selects another file or local disk    |
| 6 Boundaries              | keep    | Markdown remains a leaf; ChatPanel composes existing feature provider   |
| 7 Readability             | keep    | original revision documented beside authenticated stamping              |
| 8 Wire                    | fix     | explicit org/root/path/uploader/revision RPC, no canonical text rewrite |
| 9 Entry parity            | fix     | imported, original owner, and native/local plane twins share origin     |
| 10 Resolution             | fix     | exact read and writer revision identity agree; legacy lookup unchanged  |

No action controls, styles or form fields were added. A UI consistency audit is not applicable to these control-flow changes; rendered tests cover interception. No historical files were deleted. Existing duplicates remain addressable by exact origin.

## Performance and verification

| Area            | Verdict | Evidence                              | Change or reason kept                                  | Verification                                                 |
| --------------- | ------- | ------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------ |
| Background work | fix     | replay candidate discovery            | reject inherited rows before file reads                | discovery and outbox tests                                   |
| Memory          | keep    | mounted provider state                | no extra cache/backlog; lazy viewer owns selected file | provider/viewer lifecycle tests                              |
| Scope/isolation | fix     | event origin plus parent endpoint/org | no local fallback on missing scope                     | owner/imported/missing-scope tests, ACL SQL tests            |
| Rendering       | keep    | event-scoped context, memo comparison | compare origin and workspace changes                   | rendered provider tests; real Tauri performance not measured |

Executed: targeted Vitest discovery, plane projection/timeline, canonical timeline, file outbox/delivery, viewer, interception, wire-client and native materializer suites; `tsgo --noEmit --pretty false`; changed-file ESLint; dependency boundary check (0 new forbidden edges); `git diff --check`.

Limitations: migration 0034 must precede rollout. Pre-plane legacy links still lack event-level provenance; existing path-only rules apply there. Older revisions that were never captured remain unavailable rather than returning newer bytes. Handoff snapshots do not reconstruct historical event-time bytes. No production deployment, destructive remediation, real-provider bilateral rerun, physical two-machine run, or valid Tauri screenshots were performed for this patch. Earlier live acceptance remains a recorded failure until repeated on the integrated build.

Performance verdict: blocked for desktop/bilateral acceptance; source-level ownership and lifecycle regressions pass.

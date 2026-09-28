# Worktree data-flow fix record

- Date: 2026-07-22
- Base: `develop` @ `646bb62f0`
- Branch: `junyu/audit-worktree-data-flow`
- Related audit: `WorktreeDataFlow.md`

## Outcome

All 9 data-flow issues from the audit have been resolved under a single workspace lifecycle. Follow-up review also fixed CLI startup rollback, proxy-token release, and borrowed-worktree ownership boundaries. The UI adds no layout or visual styling; the component changes only connect existing worktree selection, repository scope, and returned results.

## Workspace state machine

| Mode              | Frontend request                             | Rust agent                                     | CLI agent              | Deletion ownership                    |
| ----------------- | -------------------------------------------- | ---------------------------------------------- | ---------------------- | ------------------------------------- |
| Current repository | `workspacePath`                              | local workspace                                | local workspace        | Do not clean up checkout              |
| Create isolated worktree | `workspacePath + isolate + worktreeBaseRef?` | create `agent/<session>` | create `agent/<session>` | Session-owned; clean up Git first, then delete DB after success |
| Reuse existing worktree | `workspacePath + worktreePath` | canonicalize and validate registered linked worktree | Same validation and persistence semantics | Borrowed; deleting the session does not delete the worktree |

Mutual-exclusion rules are enforced by TypeScript types, a strict Zod schema, Rust command validation, and CLI command validation: `isolate` cannot be combined with `worktreePath`, and `worktreeBaseRef` is allowed only for fresh isolation.

## Audit findings and disposition

| ID    | Verdict                     | Key change                                                                                                              |
| ----- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| WT-01 | fixed                       | Worktree list entries retain the canonical path, and the production Session Creator path sends `worktreePath`; the disconnected standalone atom was removed |
| WT-02 | fixed                       | Both the CLI bridge and Rust result return the workspace/worktree path, actual checkout branch, and base ref |
| WT-03 | fixed                       | Source is bound to a repo key; repo switches clear it synchronously; PR, GitHub, and branch async results are guarded against stale generations and identities |
| WT-04 | fixed                       | `branch` no longer represents the worktree base; `worktreeBaseRef`, `worktreeBranch`, and `baseRef` were added, and the frontend prefers the authoritative branch |
| WT-05 | fixed                       | A reused path must exist, be a directory, appear in `git worktree list` for the target repo, and not be the main checkout |
| WT-06 | fixed                       | Git-aware cleanup runs before deleting a session-owned worktree record; failure preserves the record; borrowed worktrees are not cleaned up |
| WT-07 | fixed with bounded fallback | The setup hook has a hard 300-second deadline; timeout terminates the process group/tree and reaps output pipes |
| WT-08 | fixed                       | `SessionService` no longer implicitly treats an ordinary `repoPath` as a worktree; callers use an explicit `worktreePath` |
| WT-09 | fixed                       | Launch input now uses a strict schema, with tests for mutually exclusive fields, unknown fields, and all three workspace modes |

## Follow-up review findings

| Finding                                                             | Verdict                     | Change                                                                                                                 |
| ------------------------------------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Runner startup failure after CLI create could leave a session/worktree behind | fixed | On `cli_agent_run` failure, the bridge runs the full delete lifecycle and combines any cleanup failure with the original error |
| Proxy allocation could remain after hosted-key DB create or later launch failure | fixed with bounded fallback | If a DB row exists, release the token before deleting the row; if not, release using allocation credentials; server TTL remains the fallback for network failure |
| Async create path ran synchronous Git cleanup directly | fixed | Worktree removal now consistently uses a `spawn_blocking` helper and propagates join/Git errors |
| Borrowed worktree could enter destructive CLI lifecycle | fixed | Delete, merge, and discard are allowed only for session-owned isolation marked with `base_branch`; borrowed checkout is only unbound from the session |
| Git branch verification error was silently ignored | fixed | `rev-parse` failures are included in the aggregate cleanup error, and the DB row remains for retry |

## Performance and isolation

| Area                | Verdict           | Change                                                                                                                                  | Verification                                                             |
| ------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| setup subprocess | pass | 300-second deadline; kill process group on Unix and use `taskkill /T /F` on Windows; always reap child and reader threads | Unix hung-command unit test passed |
| diff summary cache | pass (code/check) | TTL pruning + 128-entry hard cap + oldest-entry eviction | Capacity test added; execution on macOS blocked by an existing Windows-only test import |
| GitHub source cache | pass | Key includes endpoint, connection id, credential source, username, and repo; account switches evict old-identity entries for the same repo; recheck auth identity before commit | Auth/repo isolation and identity-eviction unit tests; static generation-guard check |
| repo/branch async | pass | Repo switches invalidate synchronously; late GitHub, branch, and PR-resolve results cannot overwrite the current selection | Stale repo payload unit test; entry-point guard |

## Verification and remaining risks

- Four focused frontend test files passed, 65 tests total, covering launch payload, strict wire schema, existing-worktree conversion, cache identity, and eviction on account switch.
- All 34 Rust `git` worktree tests passed (including the setup deadline); all 4 `agent_core` workspace-contract tests passed.
- A `git_api` capacity test was added, but this crate's lib-test target is blocked on macOS by an existing unconditional import of Windows-only `has_windows_users_prefix` in `extractors_tests.rs`; production `cargo check` is unaffected.
- Application-level `cargo check -p org2` passed.
- ESLint on changed files and `git diff --check` passed.
- The full TypeScript typecheck reports only the existing `string | undefined` error at `ContextInfoButton.tsx:468`; that file is unchanged from `develop`.
- A real Tauri rendered E2E and cooperative cancellation during app shutdown have not been tested. The hard deadline ensures the setup hook cannot hang indefinitely.

## Post-fix 10-layer review

| Layer                 | Verdict                   | Evidence                                                                                        |
| --------------------- | ------------------------- | ----------------------------------------------------------------------------------------------- |
| 1. Compilation correctness | pass with baseline caveat | `cargo check -p org2`, relevant Rust/frontend tests, and ESLint passed; TypeScript has only a pre-existing error in an unchanged file |
| 2. Dead code/duplicate paths | pass | Removed the standalone existing-worktree atom; production UI, payload, and tests share a repo-scoped source |
| 3. Naming consistency | pass | Base ref, worktree path, and checkout branch use separate fields in the wire result |
| 4. Semantic overloading | pass | `local`, `fresh isolation`, and `reuse registered` are mutually exclusive; an ordinary working path is no longer treated as a worktree path |
| 5. Default branches | pass | Defaulting a fresh worktree to `HEAD` remains explicit; base ref is rejected outside isolate mode |
| 6. Cross-domain leakage | pass | Source is bound to repo key; GitHub cache is bound to endpoint/connection/source/user/repo and evicted on identity changes |
| 7. New-developer clarity | pass | TS types, Zod, Rust DTOs, and comments describe the three workspace modes and their ownership |
| 8. Wire protocol | pass | Strict input schema, mutual-exclusion validation, Rust/CLI field parity, authoritative launch result |
| 9. Entry-point initialization parity | pass | Session Creator, SessionService, Rust agent, and CLI agent all cover the local/fresh/reuse matrix |
| 10. Resolver symmetry | pass | Repo/source invalidation is consistent; path/branch/base are returned from the prepared workspace or persisted CLI session |

# Worktree data-flow architecture audit (pre-fix snapshot)

- Date: 2026-07-22
- Baseline: `develop` @ `646bb62f0`
- Audit branch: `junyu/audit-worktree-data-flow`
- Scope: Session Creator, unified `session_launch`, Rust/CLI agent startup, Git worktree creation/reuse/deletion, and worktree source caching
- Nature: This report is a read-only snapshot of the pre-fix state; implementation results are in `WorktreeDataFlow-Fixes.md`

## Conclusion

The main “create new worktree” path is mostly complete, and focused frontend and Rust tests pass. However, the worktree domain still has 7 high-priority breaks and 2 medium-priority structural issues. The key findings are:

1. The UI displays existing worktrees, but no production path writes the selected path into the launch payload; the capability exists only in an atom, a payload helper, and unit tests.
2. The Rust and CLI agents interpret the same `session_launch` payload differently: CLI ignores `worktreePath` and drops the real path from its result after creating a worktree.
3. Switching repos does not clear or rescope the worktree source, so a branch/SHA from repo A can enter a launch request for repo B.
4. The returned `branch` is the base ref, while the checked-out branch is `agent/<session-id>`; the frontend treats the former as the session branch.
5. Deletion removes the database record before Git cleanup; after a failure, the repo/session mapping needed for reliable retry is lost.
6. The setup hook has no timeout or cancellation, the diff cache has no capacity limit, and the GitHub source cache is not isolated by account/endpoint.

Overall: **the data flow runs, but semantics differ across entry points, agent types, and the full lifecycle; the work should not be considered complete.**

## Production data flow

### 1. Create an isolated worktree

```text
WorktreeSourceModal
  -> worktreeLaunchSourceAtom / runningLocationAtom
  -> buildSessionLaunchPayload()
       { workspacePath, isolate: true, branch: baseRef }
  -> Tauri session_launch
       -> Rust agent: prepare_launch_workspace()
       -> CLI agent: launch_cli_agent() -> create_cli_session()
  -> git create_session_worktree()
       checkout branch agent/<session-id> from baseRef
       save workspace metadata
       run optional setup commands
  -> SessionLaunchResult
  -> buildSessionFromLaunchResult()
```

This path creates a worktree, with partial rollback if Git creation or persistence fails. The main issue is the result contract: CLI loses the worktree path, and neither Rust nor CLI returns the actual worktree branch.

### 2. Reuse an existing worktree (intended design)

```text
selectedWorktreePathAtom
  -> buildSessionLaunchPayload()
       { worktreePath }
  -> Rust agent: SessionWorkspace::new_worktree(root, existingPath)
  -> CLI agent: currently ignores worktreePath
```

This path is unreachable from the production UI: the atom is only written with an empty value, never a non-empty one; when the modal converts a branch option under “Worktrees” into a launch source, it drops `worktreePath`. As a result, selecting a branch from an existing worktree still means “create a new worktree from that branch.”

### 3. Managed linked worktree

```text
GlobalSpotlight / worktree management UI
  -> git HTTP API
  -> create_linked_worktree()
  -> git worktree add
  -> setup commands
  -> invalidate/refresh worktree map
```

This path shares the underlying Git creation code with session worktrees but does not share the session-launch contract. This explains why the UI can list existing worktrees without proving that Session Creator supports reusing them.

### 4. Deletion and orphan cleanup

```text
delete_session(sessionId)
  -> read workspace path
  -> delete session DB row
  -> attempt git worktree removal / branch cleanup
  -> housekeeping scans for leftover directories
```

Because of this ordering, database context is already gone if Git cleanup fails. Later housekeeping mainly deletes directories and cannot reliably restore Git worktree registration or clean up the branch.

## Findings

| ID | Priority | Finding | Evidence | Impact | Recommendation |
| --- | --- | --- | --- | --- | --- |
| WT-01 | High | “Reuse existing worktree” is an unwired dead path | `selectedWorktreePathAtom.ts:13` defines the state; the only production write found is the clearing operation in `ChatPanel/index.tsx:309-337`. `WorktreeSourceModal.tsx:352-372` shows the worktree group, but `worktreeBranchSource.ts:169-195` does not preserve `option.worktreePath`. Only `launchPayload.test.ts:422` manually supplies a non-empty value. | The user sees existing worktrees, but selecting one creates a new isolated worktree; the product semantics contradict the actual action. | Model the source as an explicit union: `currentRepo | createFromRef | reuseWorktree`. When the modal selects an existing worktree, it must carry the canonical path and add production-level component/E2E coverage; if reuse is not supported, remove the atom, payload branch, and misleading UI. |
| WT-02 | High | Rust and CLI handle `worktreePath` and the launch result asymmetrically | Rust `launch.rs:161-178` treats a non-empty `worktree_path` as Worktree; `CliLaunchParams` (`foundation/session_bridge.rs:40-69`) has no such field; `launch.rs:324-377` does not pass it when building the CLI request and always returns `worktree_path: None`. CLI creates and saves the worktree in `cli/commands.rs:143-221`, but the bridge in `agent_core_bridge.rs:55-82` retains only session id/created_at. | The same RPC changes semantics depending on agent type; after CLI creation succeeds, the frontend immediate state cannot get the real path; an existing-worktree request may degrade into a local launch. | Have Rust and CLI share one typed workspace target and the same authoritative launch result; return complete workspace metadata from the CLI bridge without dropping fields in the adapter. |
| WT-03 | High | Worktree source can leak across repos after switching repos | `worktreeLaunchSourceAtom` is global state not keyed by repo; `ChatPanel/index.tsx:313-320` clears it only when leaving worktree mode. `useSessionCreatorChatPanelHandlers.ts:109-146` does not clear the source when switching repos. `launchPayload.ts:226-246,273-277` ultimately overwrites the previously resolved branch with the source base ref. | A SHA/ref from repo A can be sent to repo B; if it does not exist, launch fails, and if the name happens to match, launch may silently start from the wrong base. | Bind the source to `{repoId, canonicalRepoPath}`; invalidate it when the repo/identity generation changes, require a generation guard on late async results, and add an A→B switch regression test. |
| WT-04 | High | `branch` simultaneously represents the base ref, displayed branch, and actual checkout branch | The UI-sent `branch` may be a PR SHA; `launch.rs:141-145,238` returns it unchanged. `git/worktree.rs:339-340` actually generates `agent/<session-id>`; the launch result has no worktree branch. `buildSessionFromLaunchResult()` in `launchPayload.ts` writes `result.branch` to the session branch. | The immediate state of a new session may display the base branch/SHA while the working directory is actually on `agent/<id>`; semantics may shift after refresh. | Explicitly return `baseRef`, `baseBranch`, `worktreeBranch`, `workspaceRoot`, and `workingDirectory`; do not use one `branch` field for three concepts. |
| WT-05 | High | Existing worktree paths are not checked for ownership or validity | `launch_workspace.rs:56-61` directly calls `SessionWorkspace::new_worktree`; `workspace.rs:137-143` only assigns the path, and `is_worktree()` only compares paths. The Git deletion route in `git/src/worktree.rs:557-581` already validates registered paths, but launch does not reuse that check. | A missing directory, ordinary directory, or directory from another repo may be persisted and reported as success, then fail asynchronously on the first turn; the error is surfaced too late. | Canonicalize the path; require that the directory exists; use `git worktree list --porcelain` to verify it belongs to the workspace repo; persist and launch only after validation. |
| WT-06 | High | Deletion removes the DB row first, leaving no retry context if Git cleanup fails | `agent-core/.../persistence/crud/ops.rs:637-724` calls `delete_session_cascade` first, then attempts worktree cleanup; on failure, it only logs and returns success. `housekeeping_orphans.rs:227-284` mainly deletes directories directly; periodic pruning also depends on the session repo still existing. | This can permanently leave stale worktree registration, an `agent/<id>` branch, and disk directories; the user cannot see the session or recover the cleanup target from the DB. | Delete the primary record after cleanup succeeds, or write a durable cleanup tombstone (repo, path, branch, session id, attempt state); housekeeping must perform Git-aware cleanup with bounded retries. |
| WT-07 | High | Setup commands have no timeout, cancellation, or process-reaping policy | `git/src/worktree.rs:421-470,504-548` invokes `sh -c` / `cmd /C` through `.output()`; the call runs inside the blocking task that creates a linked/session worktree. | Any hung script can make launch wait indefinitely; repeated launches can accumulate blocked threads and child processes. | Set a configurable hard timeout and kill on timeout; record the command, duration, and exit reason; define handling for launch cancellation and app shutdown. |
| WT-08 | Medium | `SessionService.create()` overloads a general working directory as `worktreePath` | `SessionService.ts:146-169` passes both `workspacePath: projectRepoPath | repoPath` and `worktreePath: repoPath`; `services/types.ts:20-23` defines `repoPath` as the agent working path. Rust classifies every non-empty path as Worktree. | An ordinary cwd, alternate working directory, and registered worktree are collapsed into one concept; the response can classify it as a worktree while the DB stores it as local when `root==working_dir`, creating transient split-brain state. | Have callers pass a discriminated workspace target; if an alternate cwd is needed, name it separately and do not reuse `worktreePath`. |
| WT-09 | Medium | The wire schema barely constrains launch input | `src/api/tauri/rpc/schemas/agentSession.ts:345-347` uses `z.record(z.string(), z.unknown())`; only the result schema explicitly declares `worktreePath`. | Missing TS/Rust fields, invalid mutual-exclusion conditions, and drift in new fields are not caught at compile time or runtime boundaries, allowing WT-02 to persist. | Align a discriminated Zod schema with the Rust DTO; cover unknown keys, mutually exclusive fields, and Rust/CLI parity contract tests. |

## 10-layer architecture check

| Layer | Verdict | Notes |
| --- | --- | --- |
| 1. Compilation correctness | Targeted pass | 64 frontend unit tests and 33 Rust worktree unit tests passed. This branch only adds documentation; no full app compilation, clippy, or rendered E2E was run. |
| 2. Dead code / duplicate paths | Fail | The existing-worktree payload branch has no production write; `RunningLocationPill.tsx` has no production references; no frontend calls to the diff summary were found. |
| 3. Naming consistency | Fail | `branch`, `repoPath`, and `worktreePath` have different meanings across the UI, RPC, session service, and Git layers. |
| 4. Semantic overload | Fail | Base ref / session display branch / checkout branch share `branch`; alternate cwd / registered worktree share `worktreePath`. |
| 5. Default branch | Risk | Worktree mode defaults to current HEAD when the source is missing; when CLI lacks the `worktree_path` field, it silently follows local/fresh logic instead of rejecting an unsupported request. |
| 6. Cross-domain leakage | Fail | SessionService general working paths are interpreted as Git worktrees; UI source state leaks across repos. |
| 7. Understandability for new developers | Fail | The “Worktrees” group appears to mean reuse but only selects a branch; branch/path meanings in the same launch result vary by agent type. |
| 8. Wire protocol | Fail | Input is an arbitrary record; the CLI adapter drops `worktreePath` and the actual creation result; the authoritative worktree branch is not returned. |
| 9. Entry-point initialization consistency | Fail | Rust agent, CLI agent, Session Creator, and SessionService have inconsistent support matrices for local/fresh/reuse workspace modes. |
| 10. Resolver symmetry | Fail | Repo/source do not share the same fallback/invalidation chain; path, branch, and metadata have asymmetric sources across the result, DB, and WebSocket. |

## Entry-point consistency matrix

| Entry / mode | Local | Create isolated worktree | Reuse existing worktree | Returns real path | Returns real checkout branch |
| --- | --- | --- | --- | --- | --- |
| Session Creator → Rust agent | Supported | Supported | Supported by helper, but unreachable from UI | Yes | No |
| Session Creator → CLI agent | Supported | Supported | Unsupported and not explicitly rejected | No | No |
| `SessionService.create()` → Rust agent | Supported with ambiguous semantics | Can be triggered | Any `repoPath` is treated as worktree path | Discarded by caller | No |
| `SessionService.create()` → CLI agent | Supported | Determined by isolate | `worktreePath` is ignored | Discarded by caller | No |

## Performance and lifecycle check

| Area | Verdict | Evidence | Change or reason kept | Verification |
| --- | --- | --- | --- | --- |
| Background work | Fix | The worktree create path owns the setup hook, but `.output()` has no deadline/cancellation; when it hangs, launch and the blocking worker have no termination state. | Add timeout, kill, cancellation, and observable status. | Add a “permanently hanging script” unit test and a real process-reaping test. |
| Memory | Fix | `git-api/routes/worktrees.rs:24-39,194-252` has an app-lifetime `HashMap<(path, headSha), DiffCacheEntry>` that checks TTL only during lookup, with no cap/global pruning. | Remove the unused diff summary, or use bounded LRU/TTL and evict on repo/worktree deletion. | So far, only confirmed that the endpoint has no frontend callers; no capacity/eviction tests yet. |
| Scope/isolation | Fix | `worktreeSourceCache.ts:38-51` uses only repo id/path; the GitHub PR/issue cache does not include endpoint + authenticated user, and old requests also lack an identity generation guard. | Add endpoint/user/resource to the key; clear on login-state change; compare generations before committing results. | Add account/endpoint switch and stale-completion rejection tests. |
| Rendering/hot path | Keep | Worktree map cache cap=16; source cache cap=8; requests with the same key use in-flight single-flight; branch and GitHub data load in parallel. | The existing bounded/concurrent structure can remain; fix the identity key. | The related 64 frontend unit tests passed; no rendered profiling was done. |

**Performance verdict: fail** — unbounded caches, non-terminable background child processes, cross-identity cache hits, and stale-request writeback paths remain.

## Designs confirmed as retained

- New session worktrees use `spawn_blocking` to run Git/filesystem work and avoid directly blocking the async executor.
- The worktree count has a default limit (8).
- PR base ref resolution has a 90-second timeout and sets `GIT_TERMINAL_PROMPT=0`.
- Rust fresh-create attempts to remove the newly created worktree if persisting workspace metadata fails.
- Frontend branch/GitHub source fetches run in parallel; the commonly used source cache already has an entry cap and single-flight behavior.

## Recommended implementation order

1. Define one `WorkspaceLaunchTarget` union: `local`, `createIsolated { baseRef }`, and `reuseRegistered { path }`; use the same mode matrix across TS, Zod, Rust, and CLI.
2. Have the launch result return authoritative workspace metadata: root, working directory, base ref, and actual worktree branch; the frontend should consume the result instead of inferring from input.
3. Choose the product direction: connect the existing-worktree UI properly or remove the dead capability and misleading group; do not leave it half-connected.
4. Scope source state by repo + identity, and invalidate its generation when the repo/account/endpoint changes.
5. Unify reuse-path validation and make deletion a retryable Git-aware lifecycle.
6. Add timeout/cancellation for setup hooks; remove or limit the diff cache; add identity-switch and cache-eviction tests.

## Verification record

- Frontend: targeted `vitest` run for `launchPayload`, `worktreeBranchSource`, `worktreeSourceCache`, and `worktreeSourceResolve`: **4 files / 64 tests passed**.
- Rust: `cargo test -p git worktree --lib`: **33 passed / 0 failed / 94 filtered out**.
- Not run: full TypeScript typecheck, workspace-wide clippy, real Tauri rendered E2E, account-switch testing, or hung setup process measurement. These are acceptance items for the fix phase and do not affect this report’s assessment of the existing static data-flow breaks.

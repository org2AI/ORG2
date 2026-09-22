# Branch-switch verification

All UI entry points use `performBranchSwitch` → `runGuardedCheckout` → the backend branch-switch boundary. Preparation happens before mutation, including compatible dirty changes.

| Boundary     | Coverage                                                                                                                                                                                                                                                                                                               |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Coordinator  | Clean switch, Leave/Bring/cancel, explicit creation payload, duplicate clicks, editor barriers, occupied worktree, actual branch after conflicts, lost response with HEAD reread and no mutation retry                                                                                                                 |
| Modal        | Real shared Modal + SelectionGrid, vertical radio indicators, visible descriptions, default selection, exclusive choice, disabled busy state, cancellation/root disposal, conflict paths and actual branch                                                                                                             |
| Editor saves | Await mounted/inactive saves, external disk changes, empty buffers, edits during saves, failed writes, duplicate buffers, active-task worktree scope                                                                                                                                                                   |
| Git producer | Real temporary repositories: staged/unstaged/new-file preservation, stable snapshot OID despite stash insertion, content/mode revalidation, conflicts, ignored/untracked collisions, worktree lock, detached checkout, tracking branch, ongoing operation, restart journal recovery, multiple snapshots and pagination |

Run frontend cases with `pnpm exec vitest run --config config/vitest.config.ts` and explicit file paths. Backend: `cargo test -p git_api --lib commands::branch_switch` from `src-tauri`.

Browser/native UI automation has not been run. DOM assertions verify component behavior, not visual layout on a real Tauri window.

## Remote operation identity (2026-09-13)

`remoteOps.test.ts` covers a fixed operation repo/integration/remote identity across async boundaries: push/pull/fetch credential lookup A→B, sync A→B→A with an independent B action, replaced output integration, streaming-to-auth fallback with caller parameter mutation, and pinned credential-dialog load/cancel. Network/credentials/dialogs are mocked; real remoteOps/types own the workflow. All prior remote-operation tests remain enabled.

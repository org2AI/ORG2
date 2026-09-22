# Branch switching architecture review

## Behavior

Clean worktrees switch immediately. Dirty worktrees use the existing shared SelectionGrid (`vertical`, `showRadio`, visible label/description) to choose Leave or Bring before any Git mutation. Existing branches default to Leave; new branches based on HEAD default to Bring. Cancel does not switch or stash; any earlier explicitly accepted editor save remains saved.

The backend saves staged, unstaged and nonignored new files in an immutable snapshot, records the source branch/worktree and operation phase, and retains a recovery reference. Leave switches with clean files; Bring applies the snapshot with the index after checkout. Conflicts and uncertain responses report the actual checked-out branch. Saved changes are discoverable from Source Control and restore explicitly without mixing with a dirty worktree.

## Ten-layer review

| Layer                | Coverage                                                                                                                                                        |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 Compilation        | Isolated PR branch passes full TypeScript checking and targeted frontend tests; Rust verification is recorded in the PR                                         |
| 2 Deduplication      | Hook, ActionSystem, Spotlight creation/detach and composer share performBranchSwitch; native checkout-blocked dialog removed                                    |
| 3 Naming             | Product calls this Switch branch; retained CheckoutConflictDialog directory avoids unrelated import churn                                                       |
| 4 Semantic overload  | Distinguishes memory-only edits, uncommitted disk changes, saved snapshots, partial application and actual HEAD                                                 |
| 5 Defaults / FSM     | Explicit strategy, outcome and SnapshotPhase enums; unknown/inconsistent state blocks instead of discarding                                                     |
| 6 Boundaries         | UI owns choices; editor owners validate saves; backend owns save/checkout/apply and the recovery journal                                                        |
| 7 Understandability  | Visible descriptions explain Leave/Bring; result names actual branch and conflict paths; saved snapshots show source/time/worktree                              |
| 8 Wire               | Additive typed endpoints; tests cover create/start_point/fingerprint/strategy serialization and actual-branch responses                                         |
| 9 Entry parity       | All branch-switch entry points share captured scope, readiness barriers and recovery handling; standalone stash/delete operations remain separate               |
| 10 Resolver symmetry | One repo/worktree scope through prepare/execute/recovery/refresh. Remote refs resolve to actual local tracking branch; worktree navigation uses actual metadata |

## Findings resolved

- Compatible dirty edits previously traveled without a choice: prepare now precedes mutation
- Optimistic branch updates could report the wrong branch after partial failure: publish actual HEAD
- Positional stash indices could identify the wrong work: use immutable OID and UUID references
- libgit2 index cached stale conflicts after subprocess apply: force index reload before reporting
- Detached checkout could show false success: explicit HEAD action uses the same coordinator
- Saved-work discovery missed later pages and stale responses: all-page availability scan plus scope/invalidation guards
- Save-all event raced checkout: await saves, compare original disk content/digest, read back written bytes, retain later edits on failure
- Directory symlinks were classified as nested repositories: inspect link identity before directory classification

No unresolved finding was identified within the exercised cases. Untested platform and concurrency cases remain explicit below.

## Persistence, concurrency and recovery limits

Snapshots use an additive JSON journal under the common Git directory and pinned `refs/orgii/branch-switch/<UUID>` references. No database migration is needed. `fs2`, already present in the workspace lockfile, supplies the cross-process lock. Reverting the application leaves snapshots accessible with Git; do not delete recovery refs/stashes during rollback.

The common-directory lock coordinates the new switch/restore commands, including linked worktrees. External Git clients and legacy mutation routes do not take it. The active-task check observes ORGII's known session roster rather than acquiring an exclusive filesystem writer lease. External writers still require coordination.

Partially applied phases never replay automatically. Tests simulate interrupted journal phases; abrupt application/process termination is not a full tested guarantee. Native Windows behavior and arbitrary external hooks/writers remain unverified.

Saved lists retain one 50-entry page. Previews cap output at 128 KiB; large/binary contents remain accessible from the recovery commit. Applied recovery copies and earlier snapshots remain retained until deliberate Git cleanup; there is no automatic deletion policy. Spreadsheet editors require saving/discarding in their own editor before switching.

## Verification

Fresh verification runs from the isolated PR worktree on current develop. See the PR Verification section for exact commands and outcomes. The earlier shared-checkout type errors were unrelated: full TypeScript checking passes in isolation. Native-window light/dark, constrained-viewport, focus and CPU/RSS checks were not run because computer control was not authorized.

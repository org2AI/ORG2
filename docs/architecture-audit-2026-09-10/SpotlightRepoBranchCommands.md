# Spotlight repository-specific branch commands

## Behavior and scope

The Working Directories group, global search, and recent commands share one derived command list. Single-repo mode produces one named branch command. Active workspace mode resolves Git repos in folder order, using repo ID then the existing path matcher, and deduplicates repeated references. Plain folders and unresolved repos produce no branch command.

The action payload and transient branch route carry an optional `repoId`. Both registered actions and the fallback reach the same UI opener. It validates the repo, selects it through the existing repo selection hook, then opens the existing guarded branch picker. Selecting a command changes the active repository; it does not activate or deactivate a saved workspace. The picker uses a linked worktree path only when its repo identity matches.

## Architecture review

| Layer                        | Result                                                                                                                           |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 1. Compilation               | `pnpm typecheck:fast` passes                                                                                                     |
| 2. Ownership and duplication | One command resolver serves default, search, and recent views; checkout stays in the existing guarded flow                       |
| 3. Naming                    | Labels name repositories; action identity includes repo ID                                                                       |
| 4. Semantic distinctions     | Workspace folders define membership; Git repositories define branch targets                                                      |
| 5. Defaults                  | Omitted repo ID retains existing picker behavior; unknown or plain-folder explicit targets do not open a picker for another repo |
| 6. Boundaries                | No Git mutation logic added to item builders                                                                                     |
| 7. Readability               | Repo resolution and command expansion isolated in `spotlightWorkingDirectoryActions.ts`                                          |
| 8. Payload                   | Additive optional string in GUI action and transient route; no backend wire or persistent format migration                       |
| 9. Entry parity              | Registered action and fallback carry the target to the same opener; generic entry remains supported                              |
| 10. Resolution               | Repo name and ID come from the same resolved Repo, with ID-then-path folder resolution                                           |

All ten layers reviewed for the changed frontend path. Rust, remote transport, database migration, and provider ingestion checks are inapplicable.

## Lifecycle review

| Area               | Verdict | Evidence                                                                                   | Change or reason kept                                        | Verification                                       |
| ------------------ | ------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------ | -------------------------------------------------- |
| Background work    | keep    | No new timers, listeners, fetches, or scans                                                | Existing picker loads on selection                           | Source inspection; route lifecycle test            |
| Memory             | keep    | Derived list bounded by current workspace repos; recent list retains existing cap of six   | No new retained cache                                        | Command dedupe and existing recent-list tests      |
| Scope/isolation    | fix     | Payload preserves repo identity; worktree path requires matching repo                      | Invalid explicit targets cannot fall through to current repo | Command and request tests; UI opener source review |
| Rendering/hot path | keep    | Memoized derivation depends on repo list, folder list, selected repo, workspace activation | No Git calls from rendering                                  | Typecheck, lint, command tests                     |

Closed Spotlight does not consume a pending request. Opening consumes it once; reopening cannot replay it. Subsequent repo-specific and generic requests resolve independently, verified with the actual effect hook and Jotai store in jsdom.

Performance verdict: blocked for desktop runtime measurement. Source and automated lifecycle checks pass; visible/hidden CPU/RSS and real Tauri close/reopen behavior were not measured because computer control was not authorized. No runtime performance improvement is claimed.

## Verification scope

Automated tests cover single-repo and multi-repo command generation, ID/path resolution, deduplication, plain folders, search, recent-command scope, route requests, and request consumption across close/reopen cycles. Main-hook rendering verifies selected-repo forwarding and explicit overrides. A React click on the registered status-bar callback verifies that the click event is not passed as a repository ID.

The item-hook contract requires its repo-context field. The status-bar adapter invokes the parameterized opener with no arguments; other call sites already invoke it explicitly. No stored data requires remediation. See the pull request Verification section for the exact commands run on the isolated branch.

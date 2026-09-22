# Composer branch source

## Result and acceptance criteria

The session creator's branch label and launch input now derive from `currentBranchAtom`, the same live state read by `EditorStatusBar`, when both repository ID and checkout path match. A saved local draft can no longer override that checkout's current branch. Independent sources retain their own branch metadata. Explicit worktree launch bases remain in `worktreeLaunchSelectionAtom`.

- Same-checkout saved drafts follow repeated live branch changes.
- Display and launch receive the same effective source.
- Unknown live HEAD does not restore a saved branch.
- Different repositories, worktrees, GitHub sources and system paths do not borrow another checkout's branch.
- Branch updates perform no draft persistence writes or new background work.
- The composer does not eagerly load the full branch list; existing pickers load on open.

## Root cause and authoritative data

The authoritative branch is Git HEAD. Existing Git status events/fetches update `currentGitStatusAtom`; `useRepoSelection` mirrors it into `currentBranchAtom`, which also has startup/list/checkout writers. The status bar reads that atom.

The screenshot's creator row followed `useChatPanelHeroPresentation` → `effectiveSource.branch`. Previously `useSessionCreator` returned any stored `sessionSourceAtom` unchanged. `useChatPanelBranchSync` seeded `branch` through `sessionSourceAtom` → `sessionCreatorStateAtom` → localStorage `orgii:sessionCreatorState`, but returned immediately once `effectiveSource.branch` was nonempty. Repo selection and branch-pick handlers could also save this snapshot. Consequently, subsequent HEAD changes updated the status bar but not the saved composer source.

This is a source-projection defect: the saved branch is valid selection-time metadata, but was treated as current checkout state. The fix applies before both display and launch consume it; it is not a render filter. No session-history records, remote data, storage schema, or Git state were rewritten. Existing saved drafts are reconciled on read without destructive cleanup. The running app's actual localStorage was not inspected; the stale payload shape and transition were reproduced with the real Jotai storage atoms in jsdom.

## Changes and sweep

| Line / location                        | Element                                        | Verdict          | Reason                                                                                                     | Suggested change / result                                                                     |
| -------------------------------------- | ---------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `useSessionCreatorSource.ts`           | Effective source                               | fix              | A local draft must not shadow live HEAD for the same checkout                                              | One shared producer for display and launch, guarded by repo ID and normalized filesystem path |
| Removed `useChatPanelBranchSync.ts`    | Branch seeding effect                          | fix              | Copies transient state into persisted selection, then freezes it                                           | Deleted; no branch-change persistence effect                                                  |
| Removed `useChatPanelBranchSync.ts`    | Eager branch list fetch                        | fix              | Composer needs a branch label; BranchPalette/BranchDropdown/useWorktreeSourceData already own picker loads | Deleted eager load and unused wiring                                                          |
| `useSessionCreator.ts`                 | Source resolution/setter/repo-switch lifecycle | abstract         | Previously mixed into a larger orchestrator                                                                | Moved to `useSessionCreatorSource`; all creator variants and launch paths share it            |
| `SessionInfoLine` / worktree selector  | Branch actions                                 | keep with reason | Local branch selection performs guarded checkout; explicit worktree bases have separate state              | Existing action controls and worktree semantics retained                                      |
| `useWorkspaceGroupActions`             | Independent workspace source                   | keep with reason | Deliberately targets a checkout other than the globally selected repo                                      | Its branch metadata is preserved until scopes match                                           |
| `SessionWorkstationRail`               | Existing-session branch metadata               | keep with reason | Historical/cloud session identity differs from a new-session launch target                                 | No rewrite of historical branch identity                                                      |
| `useRepoSelection` / `useBranchLoader` | Live branch writers                            | keep with reason | Broader store ownership changes affect startup, checkout rollback and worktree behavior                    | Follow-up consolidation candidate; not necessary to remove the reproduced composer divergence |

The remaining live branch store has several writers and per-hook startup/list tracking. This change does not prove that those paths cannot race or miss backend updates. It fixes the case where the status bar already has the correct branch while the composer remains stale. An independent, nonselected checkout still lacks live branch tracking in the creator; adding that requires a scoped watcher design.

## Architecture layers

| Layer                | Coverage                                                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 1 Compilation        | Changed-file lint and full repository typecheck passed in the isolated PR worktree                                                    |
| 2 Deduplication      | Removed the draft branch mirror and eager branch-list load; source derivation has one owner                                           |
| 3 Naming             | Removed branch-sync wiring; `useSessionCreatorSource` names the producer used by launch and display                                   |
| 4 Semantics          | Distinguished live HEAD, saved source metadata, explicit worktree base and historical session branch                                  |
| 5 Defaults           | Tested missing branch, default source, OS home, plain folders and multi-root scope mismatch                                           |
| 6 Boundaries         | Source orchestration remains in SessionCore; no backend or transport dependency added                                                 |
| 7 Readability        | Source scope matching and retained draft setter/repo-switch behavior documented                                                       |
| 8 Wire               | No wire/schema change; tests exercise the production launch-payload builder with the reconciled source; live backend dispatch not run |
| 9 Init parity        | Default/saved/remounted creator sources tested through the same production hook                                                       |
| 10 Resolver symmetry | Branch is borrowed only when ID and checkout path match; explicit worktree base remains independent                                   |

Rust compilation, backend endpoint testing, UI consistency auditing and native action-control inspection are not applicable to this source-only TypeScript change: no Rust, wire definitions, JSX, action controls or input elements changed.

## Performance and lifecycle

| Area               | Verdict | Evidence                                               | Change or reason kept                                                                    | Verification                                             |
| ------------------ | ------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Background work    | fix     | Removed branch-copy effect and eager full-list trigger | Reuse existing live atom and picker-owned fetches; no timer, request or listener added   | Source trace, 60 seconds of fake-time quiescence         |
| Memory             | keep    | Hook-local memo/ref only                               | No app-lifetime cache or growing collection                                              | Remount test; ordinary React-owned cleanup               |
| Scope/isolation    | fix     | ID plus filesystem path match                          | Separate checkout metadata preserved; old different-repo draft reset on workspace switch | Repository/worktree/URI/multi-root tests                 |
| Rendering/hot path | fix     | Live branch read directly, no follow-up draft write    | No persistence/render feedback cycle on branch change                                    | Repeated switches, storage-write spy and quiescence test |

Lifecycle coverage: mount, repeated active changes, idle and remount are covered in jsdom. There is no new visibility-dependent work, offline retry, network channel, identity cache, subprocess or watcher to stop. Existing GitStatus/provider lifecycles remain unchanged. Real visible/hidden CPU/RSS, app focus-return freshness and native checkout timing were not measured. Computer control was not authorized under the user's workspace instructions.

Performance verdict: blocked for live runtime claims; whole-repository compilation passes in the isolated PR worktree. Correctness tests support removal of redundant persistence and eager-load code; they do not establish a CPU/RSS or responsiveness improvement.

## Verification

- `pnpm test src/engines/SessionCore/hooks/session/useSessionCreator/useSessionCreatorSource.test.ts src/engines/SessionCore/hooks/session/__tests__/launchPayload.test.ts src/features/SessionCreator/components/__tests__/SessionInfoLine.test.ts src/features/SessionCreator/components/__tests__/WorktreeSourceSelector.test.ts src/modules/WorkStation/shared/StatusBar/__tests__/EditorStatusBar.hostless.test.ts src/features/SessionCreator/variants/ChatPanel/resolveRepoChangePath.test.ts src/features/SessionCreator/variants/ChatPanel/useSessionCreatorChatPanelHandlers.test.ts` — 56 tests passed across seven suites, including 16 source cases and local/worktree launch payloads.
- `pnpm exec eslint` on the seven added/changed TypeScript files, with `--max-warnings 0` — passed.
- `pnpm typecheck:fast` — passed in the isolated PR worktree based on latest `develop`, using the existing installed dependencies plus its declared `yaml@2.9.0`. The earlier shared checkout had unrelated `hasBody` errors; those edits are excluded from this PR.
- `git diff --check` — passed.
- No GUI verification, real Git checkout or live profile performed. The PR was prepared in an isolated worktree, preserving unrelated workspace edits.

## Import promise handling

The type-aware lint workflow found an unhandled import promise in `useSessionCreatorChatPanelHandlers`. The comment update changed the source fingerprint of an existing baseline finding; ordinary ESLint and typechecking do not run this separate gate. The import chain now catches and logs rejection. A failed import preserves the system-path source without selecting a repository. Success and cancellation retain their behavior. Three hook tests cover these outcomes; the lint baseline and rules are unchanged.

Verification: `NODE_OPTIONS=--max-old-space-size=6144 pnpm check:typed-lint` passed with 1098 existing findings and zero new or increased findings. `pnpm typecheck:fast`, changed-file ESLint and `git diff --check` also passed.

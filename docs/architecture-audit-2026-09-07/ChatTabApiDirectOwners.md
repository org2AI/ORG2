# Chat-tab API: direct readers and open-command owners

## Scope

Third local phase after workstation-layout and chat-panel UI facade migrations. Keep the public chat-tab command API while directing model, factory, state and type consumers to their owners. Remove the two intermediate open-command files. Publication is authorized; this phase is a separate PR.

Acceptance criteria: preserve all public API names and command implementations; preserve the single definitions of state atoms and persisted storage behavior; no references to removed open-command paths; migrate relevant mocks; pass lifecycle/placement/access tests and structural checks.

## Findings

| Line                                                                            | Element                         | Verdict          | Reason                                                                                         | Suggested change                                                                                          |
| ------------------------------------------------------------------------------- | ------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `src/store/chatPanel/chatPanelTabOpenAtoms.ts:1`                                | Compatibility forwarding module | fix              | Only forwards the open-command directory API                                                   | Removed; named consumers and public API export from command owners                                        |
| `src/store/chatPanel/chatPanelTabOpen/index.ts:5`                               | Second forwarding layer         | fix              | Repeats four owner modules behind the compatibility file                                       | Removed; preserve integrations/session/startPage/workManagement export evaluation order in the public API |
| `src/store/chatPanel/chatPanelTabsAtom.ts:1`                                    | Public tab API                  | keep with reason | External UI/services invoke a coherent set of tab commands                                     | Retain all 84 public export names; document direct owner imports for types/model/factory/state readers    |
| Named imports of model/factory/state/type symbols                               | Consumer dependency breadth     | fix              | Reading a tab type or current state does not require depending on the command aggregation file | Split imports to canonical owners; retain command bindings on the public API                              |
| `src/features/DiscussionChannels/ChannelPanelView/ChannelMessageRow.test.ts:62` | Open-session mock               | fix              | Mock must target the same owner as the migrated reference-card consumer                        | Retarget mock and importOriginal type to chatPanelTabOpen/session                                         |
| `src/modules/MainApp/WorkManagement/WorkManagementPage.test.ts:28`              | Mixed state/command mock        | fix              | Read atom now belongs to the state owner while setter remains a command                        | Mock the state owner separately; retain the command mock                                                  |
| `src/store/chatPanel/chatPanelTabsState.ts:47`                                  | Canonical atom and storage      | keep with reason | Owns startup fresh-tab behavior, persistence and one debounce timer                            | No implementation changes                                                                                 |
| `src/store/chatPanel/chatPanelTabLifecycleAtoms.ts:1`                           | Lifecycle commands              | keep with reason | Close/destroy/access-reconciliation operations own their cleanup and ordering                  | No implementation changes                                                                                 |

## Risks and mitigations

- **Module initialization timing:** direct imports can reduce the set of modules evaluated by a consumer. Preserve the public open-command export order and all state owner implementations; verify the static dependency graph and existing startup tests. No runtime startup-performance claim.
- **Atom identity:** forwarding itself never duplicates an atom. Duplication would require recreating definitions or bundling the same module under separate identities. This migration retains the original files/definitions and uses the repository’s normal module resolution.
- **Lifecycle/data:** accidental changes to tab closure could leave terminal/session resources or choose the wrong active tab; startup persistence behavior could also change. The phase changes imports/exports only, not tab creation, command bodies, IDs, storage keys, timers or persisted payloads. Existing command behavior tests remain exercised through the public API.
- **Mock/API compatibility:** consumers of the two removed source paths must migrate. All 84 names of the main public API are retained. The two affected mocks are updated at their real owner boundaries.
- **Unverified platforms:** GUI/E2E, release bundling and real multi-instance startup are not validated by typechecking or unit tests. No Rust changes.

Architecture layers covered: compilation, reference/owner tracing, naming and module boundaries (1–4, 6–7). No wire/fallback/resolver logic changed (5, 8, 10); initialization sensitivity reviewed (9). Performance guard: no added or changed resource creation, atom definitions, subscriptions, timers or disposal logic. Existing single-owner state and debounce remain in place. TSX edits are imports only.

## Publication verification

This phase is published independently against develop `bc396d4d8` as Harry19081. It follows Chloe-JY’s earlier re-export work and #1350; it does not include the other state-facade phases or open #1356.

- `pnpm test src/store/chatPanel src/store/session src/services/workStation src/features/DiscussionChannels src/modules/MainApp/WorkManagement src/modules/MainApp/TeamInbox src/scaffold/NavigationSidebar src/engines/ChatPanel/hooks src/modules/WorkStation/shared/TabBar` — 179 files / 1143 tests passed on this independent branch.
- `pnpm typecheck:fast` — passed.
- ESLint (`--fix --max-warnings 0`) and Prettier on all changed/new TypeScript files — passed.
- `pnpm check:circular` — no cycles across 6602 modules.
- `pnpm check:test-placement` — passed across 516 directories.
- `git diff --check` — passed; no old references to the removed compatibility paths found in source/test/tool/config searches.
- Combined integration checkout on develop `bc396d4d8`: `pnpm test` — 1,570 files / 11,664 tests passed with all three reviewed phases together. This is separate evidence from the independent branch checks above. Runtime desktop/multi-window startup, GUI/E2E and release bundling are not exercised; no computer control was used.

## Latest develop integration

Merged develop `ee2c184f5` and resolved three adjacent test-import conflicts. Keep tab state/factory imports on their canonical owners and preserve upstream chat-panel surface/selection/visibility imports. Test assertions and production function bodies are unchanged by the conflict resolution; existing published history is preserved.

- After integrating develop `ee2c184f5`, `pnpm test src/store/chatPanel src/store/session src/services/workStation src/features/DiscussionChannels src/modules/MainApp/WorkManagement src/modules/MainApp/TeamInbox src/scaffold/NavigationSidebar src/engines/ChatPanel src/modules/WorkStation/shared/TabBar` — 366 files / 2,393 tests passed.
- `pnpm typecheck:fast`, changed-file ESLint and Prettier, `pnpm check:circular`, `pnpm check:test-placement`, and `git diff --check` — passed. No remaining source imports of the deleted forwarding paths or ui/chatPanelAtom.

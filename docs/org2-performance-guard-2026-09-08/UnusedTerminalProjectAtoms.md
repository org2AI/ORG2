# Unused terminal and project atom removal

## Scope and reachability

Remove ten audited atoms, without changing the active implementations:

| Group           | Removed atoms                                                                                  | Production path retained                                                                                                                  |
| --------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Projects        | `allProjectsFlatAtom`, `anyProjectsLoadingAtom`                                                | `useAllRepoProjects` reads `allProjectsEntryAtom` directly                                                                                |
| Terminal        | `terminalSessionCountAtom`, `createAgentSessionTerminalAtom`, `removeAgentSessionTerminalAtom` | `useTerminalState` uses normal add, close, selection and metadata actions; deleted APIs had only test callers                             |
| Browser sidebar | `workStationBrowserSidebarCollapsedAtom`, `workStationBrowserSidebarCollapsedPersistAtom`      | Current Browser layout uses neither; pair only referenced itself and a stale comment                                                      |
| Mini terminal   | `toggleMiniTerminalAtom`                                                                       | Trail UI calls open/close actions directly                                                                                                |
| Run groups      | `replaceRunGroupEntryAtom`                                                                     | Launch uses upsert and comparison reads by ID; no retry caller used this action                                                           |
| PR detail       | `workstationPrDetailTabAtomFamily`                                                             | `PrDetailTabs` reads/writes `workstationSelectedPrAtomFamily.viewState.activeTab`; removed family had only tests and eviction bookkeeping |

Exact-name references were swept across `src`, `tests` and `scripts` before
and after deletion. Test-only and cleanup-only references were distinguished
from production reads/writes. The rendered PR-detail test now asserts the
canonical state directly; it still exercises actual tab clicks. Tests solely
for deleted APIs were removed. A replacement terminal lifecycle regression
verifies that an existing legacy read-only tab can still be closed through
the normal terminal action without losing sibling sessions.

## Lifecycle and performance

| Area               | Verdict | Evidence                                                                                     | Change or reason kept                                                                                 | Verification                                   |
| ------------------ | ------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Background work    | keep    | No production listener, timer, PTY creation or transport caller depended on the removed APIs | Normal terminal lifecycle and OSC-633 callbacks unchanged                                             | Terminal management and cleanup tests          |
| Memory             | fix     | Unused PR detail atom family had no production consumer                                      | Remove unused family and its eviction call; retain 16-scope bound for live PR state/callback families | PR retention eviction/recency tests            |
| Scope/isolation    | keep    | Live PR keys remain repo + PR; terminal IDs and storage schemas unchanged                    | Existing localStorage contents and historical terminal records are not deleted                        | PR scope separation and legacy-tab close tests |
| Rendering/hot path | keep    | UI uses canonical parent PR state and direct mini-terminal actions                           | No live subscription scope or allocation path changed                                                 | Rendered PR tab tests and mini-terminal tests  |

Lifecycle matrix: startup keeps live initialization and existing persisted
formats; active/inactive tab switching keeps canonical state; close retains
normal cleanup; visible/hidden/idle/shutdown behavior introduces no new work.
Network, account, endpoint, org and multi-instance policies are unchanged.
The unused Browser sidebar storage key is left on disk, not migrated or
deleted. No desktop CPU/RSS, multi-instance, or real PTY measurements were run;
no runtime performance improvement is claimed.

Performance verdict: pass for the removal-only scope. The previously identified
run-group cache consolidation and write-only terminal command store are
explicitly outside this PR; this verdict does not certify those existing paths.

## Architecture coverage

1. Compilation: full frontend typecheck.
2. Dead code: production reachability and exact-name sweep.
3. Naming: remove stale Browser sidebar comment.
4. Semantics: terminal session IDs are not agent conversation IDs; keep record types and normal PTY actions.
5. Defaults: live panel defaults and terminal fallback creation unchanged.
6. Boundaries: no backend or domain ownership changes.
7. Clarity: unused public APIs no longer advertise nonexistent production flows.
8. Wire: no wire or serialized schema changes; endpoint validation not applicable.
9. Init parity: retained production/test initialization; obsolete test-only creation path removed.
10. Resolver symmetry: no multi-field resolver or fallback chain changed.

## Verification

- `pnpm typecheck:fast`: passed.
- `pnpm test src/store/workstation/codeEditor/terminal src/store/workstation/codeEditor/workstationSelectedPrAtom.test.ts src/modules/WorkStation/CodeEditor/Panels/EditorPrimarySidebar/content/PullRequestContent/detail/PrDetailPanel.test.ts src/store/ui/__tests__/miniTerminalAtom.test.ts src/store/session/__tests__/runGroupsAtom.test.ts src/features/SessionCreator/multiRunner src/store/ui/workStationLayout`: 11 files, 92 tests passed.
- Changed TypeScript files: ESLint and Prettier applied/checked.
- `git diff --check`: passed.

Rollback: revert the code commit. No persisted-data restoration is required.

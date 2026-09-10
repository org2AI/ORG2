# Workstation layout direct owners

## Scope

First phase of the approved state-facade migration, based on develop `bc396d4d8`. Separate from open PR #1356 and from chat-width initialization or chat-tab API changes. Preserve every atom definition, storage key, initializer and write action. Migrate consumers to existing layout owners and remove the compatibility file only after source/static/dynamic references are accounted for.

## Findings

| Line                                                     | Element                         | Verdict          | Reason                                                                                         | Suggested change                                                              |
| -------------------------------------------------------- | ------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `src/store/ui/workStationAtom.ts:1`                      | Compatibility forwarding file   | fix              | Adds no state owner or independent API                                                         | Removed; static and dynamic consumers target existing leaf modules            |
| `src/store/ui/index.ts:45`                               | Duplicate layout export         | fix              | The same file already exports workStationLayout                                                | Removed only the redundant compatibility export; public layout names retained |
| `src/app/root/e2e/helpers/navigation.ts:23`              | Side-effect-only import         | keep with reason | Existing entry deliberately evaluates the layout module family                                 | Retarget directly to workStationLayout; retain eager loading behavior         |
| `src/services/workStation/WorkStationViewService.ts:228` | Two dynamic imports             | fix              | Sidebar toggle and search only require primarySidebarAtoms                                     | Retarget the two import literals; retain Promise.all and lazy execution       |
| `src/store/ui/workStationLayout/index.ts:1`              | Cohesive layout API             | keep with reason | Still supplies the broad UI API and deliberate side-effect entry                               | Retain; ordinary consumers use leaf owners                                    |
| `src/store/ui/workStationLayout/storage.ts:37`           | Cached initial storage snapshot | keep with reason | Shared initializer supplies persisted values to layout atom owners                             | Preserve implementation and single module identity                            |
| `src/store/ui/chatPanelAtom.ts:1`                        | Chat-panel facade               | keep with reason | Width initialization sets DOM CSS at import time; requires a separate initialization migration | Defer to the next independent phase                                           |
| `src/store/chatPanel/chatPanelTabsAtom.ts:1`             | Chat-tab public API             | keep with reason | State/model consumers and external command API need separate treatment                         | Defer to a separate phase                                                     |

## Architecture and lifecycle

Covered ownership, naming, reference resolution and dependency boundaries (layers 1–4, 6–7). No changes to fallback, wire, initialization algorithm or resolver behavior (layers 5, 8–10). TSX changes are imports only and fall under the UI audit’s type/architecture exclusion.

Performance-guard review: layout storage is read through the existing cached module; atom definitions, timers, callbacks, persistence keys and state owners are unchanged. No polling/listeners or additional retained resources are introduced. Startup snapshot timing may depend on the import graph, so source checks alone do not establish runtime parity across all platforms. No CPU/RSS or re-render improvement is claimed. Runtime/GUI, E2E execution and release bundling were not run.

## Publication verification

This phase is published independently against develop `bc396d4d8` as Harry19081. It follows Chloe-JY’s earlier re-export work and #1350; it does not include the other state-facade phases or open #1356.

- `pnpm test src/modules/WorkStation src/hooks/ui/workbench src/store/ui/workStationLayout src/app/root/__tests__ src/services/workStation` — 150 files / 975 tests passed on this independent branch.
- `pnpm typecheck:fast` — passed.
- ESLint (`--fix --max-warnings 0`) and Prettier on all changed/new TypeScript files — passed.
- `pnpm check:circular` — no cycles across 6603 modules.
- `pnpm check:test-placement` — passed across 516 directories.
- `git diff --check` — passed; no old references to the removed compatibility paths found in source/test/tool/config searches.
- Combined integration checkout on develop `bc396d4d8`: `pnpm test` — 1,570 files / 11,664 tests passed with all three reviewed phases together. This is separate evidence from the independent branch checks above. Runtime desktop/multi-window startup, GUI/E2E and release bundling are not exercised; no computer control was used.

## Integration after #1361

Latest integration: merged develop `f00ee7da2` after #1361 landed. Resolved adjacent import conflicts in PinnedWorkbenchChrome and useWorkstationTrailingSlot by keeping both sets of direct owners; no function logic changed. Published history is preserved with a merge commit.

- After integrating develop `f00ee7da2`, reran the targeted `pnpm test` command above — 151 files / 976 tests passed. `pnpm typecheck:fast`, changed-file ESLint and Prettier, `pnpm check:circular`, `pnpm check:test-placement`, and `git diff --check` all passed. Source scan found no references to workStationAtom or ui/chatPanelAtom.

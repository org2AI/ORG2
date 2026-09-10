# Dead search and UI atom removal

## Scope and evidence

Remove 30 atoms: 12 in the unused search-cache graph, six in the session
group/count graph (including its private root), three workspace selectors,
and nine unused UI atoms. Symbol references, imports, re-exports, and production
call paths were checked before removal. Test-only consumers do not establish
production reachability. Tests exclusively for deleted APIs were removed;
tests for surviving behavior remain.

## Resource ownership

| Resource                           | Owner / lifecycle                                | Change and verdict                                                                       |
| ---------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Search result cache and statistics | Unconsumed cache atom graph                      | Removed; live search execution and search-tab session cache retained                     |
| Session grouping memo              | Private closure reached only by unused selectors | Removed; session persistence, lookup caches, working status and recent sessions retained |
| Upload storage atom                | Unconsumed UI declaration                        | Removed declaration only; existing `uploadFiles` localStorage data is not deleted        |
| UI and workspace selectors         | Unconsumed atom declarations                     | Removed; no active subscription, worker, timer, RPC or event listener changed            |

## Lifecycle matrix

| State                 | Evidence / limitation                                                               |
| --------------------- | ----------------------------------------------------------------------------------- |
| Active / idle         | No production consumer found for removed graphs; targeted surviving-path tests pass |
| Hidden / background   | No new resource ownership or background work introduced                             |
| Repeated open / close | Existing search load-more listener cleanup regression test passes                   |
| Multiple instances    | No backend, persistence format, sync or cross-instance protocol change              |

Performance verdict: removal-only lifecycle review passes. No measured CPU,
RSS, startup, or rendering improvement is claimed. Desktop runtime validation
was not performed; computer control was not requested.

## Architecture coverage

Covered reachability/dead code, derived-state ownership, type cleanup and
initialization/persistence effects. FSM, Rust, wire protocol and cross-layer
initialization changes are out of scope because this patch changes none.
The same-named `UploadedFile` types used by SessionCreator are separate types
and remain intact. `toolbarDropdownOpenAtom` remains because it has a live reader.

## Verification

- `pnpm typecheck:fast`: passed.
- `pnpm test src/store/workstation/codeEditor/search src/store/session/__tests__/sessionManagerAtom.test.ts src/store/session/sessionAtom/__tests__/anySessionWorking.test.ts src/store/workspace src/store/ui/__tests__/todoMerge.test.ts src/store/ui/__tests__/todoSessionSlots.test.ts src/store/ui/__tests__/overlayAtom.test.ts src/modules/WorkStation/CodeEditor/Panels/EditorPrimarySidebar/content/SearchContent`: 14 files, 128 tests passed.
- Exact-name reference sweep over `src`, `tests`, and `scripts`: no remaining removed-atom references.

Rollback is a code revert; no stored-data restoration or migration is needed.

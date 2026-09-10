# Git status reader dependencies

The Git status read hook previously lived in an index that re-exported the deferred provider, and the context singleton lived in the active provider. A reader therefore had a static path to provider-owned repository fetching, event listeners, watcher registration, and store dependencies.

The context and read hook now have leaf modules. All 11 production hook consumers import the read hook directly; provider entry points retain their existing exports. Both providers import the same context singleton. The provider bodies, state, fetch ownership, deferred timing, and cleanup remain unchanged.

## Architecture coverage

| Layer                  | Evidence and verdict                                                                                 |
| ---------------------- | ---------------------------------------------------------------------------------------------------- |
| 1 Compilation          | `pnpm typecheck:fast` and focused lint validate moved imports and types                              |
| 2 Deduplication        | One context initializer and one read hook; production readers use the new leaf                       |
| 3 Naming               | Existing public names retained                                                                       |
| 4 Semantic overloading | Repository status context remains separate from the file-tree-local context of the same name         |
| 5 Defaults             | Null context still throws the same missing-provider error; deferred placeholder unchanged            |
| 6 Boundaries           | Read hook reaches only context.ts and React at runtime, verified by static import graph              |
| 7 Discoverability      | context.ts owns identity, useGitStatus.ts owns reads, provider owns effects                          |
| 8 Wire protocol        | Not applicable: no IPC payload or serializer changes                                                 |
| 9 Init parity          | Active and deferred providers share the singleton; deferred handoff covered by a rendered JSdom test |
| 10 Resolver symmetry   | Not applicable: no resolver or priority-chain changes                                                |

## React and lifecycle review

| Area               | Verdict | Evidence                                                                                                               | Change or reason kept                                    | Verification                                                                            |
| ------------------ | ------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Background work    | keep    | Existing provider owns Git listeners, fetches and watchers; deferred provider owns one idle callback or fallback timer | No effect body or resource owner changed                 | JSdom fallback handoff and idle cancellation tests; source diff review                  |
| Memory             | keep    | One module-level React context                                                                                         | No additional cache, state container or retained history | Read-hook identity assertion                                                            |
| Scope/isolation    | keep    | Existing provider still selects the current repository and supplies its value                                          | No repository or authentication key changes              | Exact context value and action identity assertions                                      |
| Rendering/hot path | fix     | Hook-only imports no longer traverse the provider barrel                                                               | Direct leaf imports across all 11 callers                | Static import graph excludes providers, hooks and application stores from the read hook |

Lifecycle matrix: clean load sees the same loading placeholder; fallback activation hands readers the active value; closing before idle activation cancels its callback. Visible/hidden, online/offline, identity switching, repository changes and shutdown inside the active provider retain unchanged implementation. No new background work was introduced. Native WebView CPU/RSS, startup timing and production bundle bytes were not measured; this is a verified dependency boundary change, not a measured runtime speedup.

Performance verdict: pass for the changed import boundary and unchanged resource ownership; no runtime performance improvement claimed.

## Verification

- `pnpm test src/contexts/git/GitStatusContext/useGitStatus.test.ts src/contexts/git/GitStatusContext/DeferredGitStatusProvider.test.ts src/contexts/git/GitStatusContext/hooks/__tests__/useGitStatusFetch.test.ts src/modules/WorkStation/CodeEditor/Panels/EditorPrimarySidebar/tabs/__tests__/SourceControlTab.initialization.test.ts` — 9 tests in 4 files passed
- `pnpm typecheck:fast` — passed
- Scoped `pnpm exec eslint` on GitStatusContext source/tests and all migrated readers — passed
- No visual changes; no native UI control performed

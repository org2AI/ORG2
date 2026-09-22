# Hooks, utilities, and contexts reachability audit

## Scope and result

Scanned `src/hooks`, `src/util`, and `src/contexts` with the repository's Knip configuration (including test entries), then checked production entry reachability and traced candidates through imports and local calls. No whole file in these directories was confirmed dead. After cleanup, the configured Knip scan reports no unused exports or types in these directories.

| Element                                                                                                                             | Verdict | Reason                                                                                                                            | Change                               |
| ----------------------------------------------------------------------------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `util/file/gitignoreParser.ts` `isPathIgnored`                                                                                      | Remove  | No caller; the live cached checker owns gitignore lookup.                                                                         | Deleted the one-off helper.          |
| `util/data/formatters/date.ts` `formatTime`, `formatDateTime`                                                                       | Remove  | No import or internal call; other date formatters are live.                                                                       | Deleted both functions.              |
| `util/platform/tauri/init.ts` `getTauriAPIs`, `resetTauriState`                                                                     | Remove  | No production or test caller; initialization and invoke/listen accessors remain live.                                             | Deleted both functions.              |
| `util/language/prismGrammars.ts` `PRISM_LIGHT_LANGUAGES`                                                                            | Remove  | No runtime or test reader; grammar registration still iterates `PRISM_GRAMMARS`.                                                  | Deleted the exported array.          |
| Unused hook, utility, and context barrel exports and default aliases                                                                | Remove  | No importer through these paths; the underlying functions, hooks, and context objects remain in use through their actual modules. | Trimmed re-exports and aliases.      |
| `hooks/ui/useUndoableState.ts` `useUndoStack`; `hooks/ui/workbench/usePinnedWorkbenchChrome.ts` `usePinnedWorkbenchChromeAvailable` | Keep    | These are called by other live hooks in the same file.                                                                            | None.                                |
| Dialog helper functions and activity text extractors                                                                                | Keep    | The safe dialog wrappers and text extraction paths call them internally; some are also covered directly by tests.                 | Removed only unused barrel exposure. |
| `contexts/git/GitStatusContext/context.ts`                                                                                          | Keep    | Provider and consumer hook both use the context object.                                                                           | Removed only unused re-exports.      |

## Architecture coverage

1. Compilation: frontend typecheck passed; no Rust change.
2. Dead code and duplication: primary focus; traced module, export, and internal call chains.
3. Naming: removed legacy and duplicate-facing aliases; retained canonical named APIs.
4. Semantic overloading: distinguished similarly named formatter and gitignore helpers by import path and call site.
5. Defaults: no default behavior changed; removed only unused default exports.
6. Boundaries: kept live Tauri initialization, context provider ownership, grammar registration, and gitignore cached checker.
7. Discoverability: trimmed barrels that advertised unconsumed APIs.
8. Wire protocol: no payload or public IPC change.
9. Initialization parity: retained the active Tauri initialization path; no cross-platform init rewrite.
10. Resolver symmetry: no resolver change.

The production-entry scan was treated as a cross-check: test-only exports and functions used within the same module are not evidence that the implementation itself is dead. This was a source-level reachability cleanup, not a runtime performance measurement.

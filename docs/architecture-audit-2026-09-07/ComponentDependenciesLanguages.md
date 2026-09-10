# CodeMirror language dependency separation

Completion criteria: the Editor hook must not statically reach non-JavaScript language packages; Diff/ConflictEditor retain synchronous language support; existing detection and caching behavior remain; concurrent loads share construction; stale async completions cannot update a superseded effect.

| Line                                                                  | Element                      | Verdict          | Reason                                                                                                                       | Suggested change                                                                                        |
| --------------------------------------------------------------------- | ---------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `src/features/CodeMirror/Editor/hooks/useLazyLanguageExtension.ts:10` | Editor language imports      | fix              | Previously shared an eager module with synchronous Diff and ConflictEditor                                                   | Applied: import parser-free detection and the dedicated lazy loader                                     |
| `src/features/CodeMirror/shared/languageExtensions.ts:7`              | Eager language factories     | keep with reason | Diff and ConflictEditor require extensions during synchronous construction                                                   | Retain the eager API; do not re-export it from detection or lazy loading                                |
| `src/features/CodeMirror/shared/lazyLanguageExtensions.ts:58`         | Concurrent language requests | fix              | Multiple consumers otherwise constructed separate extensions while the first import was pending                              | Applied: share pending promises by known language; release on settlement, retry failure on later demand |
| `src/features/CodeMirror/Editor/hooks/useLazyLanguageExtension.ts:54` | Effect completion ownership  | fix              | Language-name comparison alone does not invalidate an old A request after A → B → A, or after unmount                        | Applied: effect-local active flag invalidated by cleanup                                                |
| `src/features/CodeMirror/shared/languageExtensionCache.ts:3`          | Extension retention          | keep with reason | Parser extensions contain no document/account data and are stable for the process; the existing 64-entry cap protects growth | Retain bounded successful caches and finite-key in-flight ownership                                     |

Verdict totals: **3 fix**, **2 keep with reason**, **0 abstract**.

## Architecture layers

| Layer                     | Coverage                                                                                                                    |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 1 Compilation             | Changed-file ESLint and full-project `pnpm typecheck:fast` pass in the independent branch                                   |
| 2 Dead code/deduplication | All moved exports are wired; no compatibility re-exports in lazy modules; one cache-cap helper and one detection mapping    |
| 3 Naming                  | `languageDetection`, `lazyLanguageExtensions`, and the documented existing eager `languageExtensions` distinguish ownership |
| 4 Semantic overloading    | `getLanguageExtensionSync` explicitly remains JS/TS only; `getLanguageExtension` remains all supported languages            |
| 5 Defaults                | Unknown file/explicit languages still return null; override precedence and case normalization covered                       |
| 6 Leakage                 | Transitive static graph tests prohibit non-JS parser packages and the eager module from the hook                            |
| 7 Discoverability         | Module comments identify eager versus lazy consumers                                                                        |
| 8 Wire                    | Not applicable: no network domain payload, IPC, schema, or persistence changes                                              |
| 9 Initialization parity   | All 24 filename mappings exercise eager and lazy extension construction; Diff/ConflictEditor imports remain unchanged       |
| 10 Resolver symmetry      | File-path versus explicit-language detection remains one shared resolver; no multi-field fallback introduced                |

## Verification

- `pnpm exec vitest run --config config/vitest.config.ts src/features/CodeMirror/shared/languageExtensions.test.ts src/features/CodeMirror/Editor/hooks/useLazyLanguageExtension.test.ts src/features/CodeMirror/config/themeConfig.test.ts src/features/CodeMirror/SqlEditor/SqlEditor.test.ts`: **39 tests passed** across four files. Includes real CodeMirror configuration for each mapping, stable caching, unknown keys, the 64-entry bound, concurrent requests, failed-construction retry, StrictMode replay, A → B → A, no-language transition and unmount.
- `pnpm exec eslint src/features/CodeMirror/shared/languageDetection.ts src/features/CodeMirror/shared/languageExtensionCache.ts src/features/CodeMirror/shared/languageExtensions.ts src/features/CodeMirror/shared/lazyLanguageExtensions.ts src/features/CodeMirror/shared/languageExtensions.test.ts src/features/CodeMirror/Editor/hooks/useLazyLanguageExtension.ts src/features/CodeMirror/Editor/hooks/useLazyLanguageExtension.test.ts src/features/CodeMirror/index.ts --max-warnings 0`: passed.
- `pnpm typecheck:fast`: full-project TypeScript check passed.
- `git diff --check`: passed.
- Failure-path test intentionally emits the existing logger warning. Existing Vite CJS and Sass deprecation warnings also remain.

## Isolated bundle evidence

A temporary Webpack 5 fixture compiles the hook against the HEAD baseline and changed source using identical settings: `esbuild-loader` TypeScript targeting ES2020, no source maps or cache, CommonJS library exports, React and logger externalized. This tests this dependency boundary; it does not reproduce whole-app vendor grouping or claim startup latency savings.

| Mode        | Before initial JS | After initial JS | Async parser chunks before / after |
| ----------- | ----------------: | ---------------: | ---------------------------------: |
| Development |   1,746,503 bytes |  1,196,945 bytes |                             0 / 10 |
| Production  |     388,666 bytes |    388,809 bytes |                            10 / 10 |

Development initial output drops 549,558 bytes (31.5%) in this fixture. Production already tree-shakes the unused eager API; the changed output is 143 bytes larger from lifecycle coordination. No production byte-saving claim is supported by this measurement.

The isolated fixture was run with `node /tmp/orgii-language-chunks.cjs` and `LANGUAGE_CHUNK_MODE=development node /tmp/orgii-language-chunks.cjs`. Its temporary script and JSON statistics are development-session evidence; they are not distributed by this PR. The fixture uses normal `node_modules` traversal plus the workspace module directory.

Whole-application bundle savings are not claimed or measured for this independent branch. Live Tauri highlighting, hidden/visible performance, real offline chunk fetching and startup timing were not measured; desktop computer control was not authorized. No markup or `.tsx` file changed, so `frontend-ui-audit` is inapplicable under its performance/type-control-flow exclusions.

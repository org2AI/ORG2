# Component dependency token extraction

Completed acceptance criteria: token-only consumers no longer require the SettingsTable implementation at runtime; board configuration and sticky-tree constants use existing leaves; embedded detail has no direct static import of its lazy component; the org hub obtains its loading fallback independently of the router. The extraction preserves runtime values and rendered elements.

| Layer                           | Disposition                                                                                                                                                                                                     |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 — Compilation                 | Focused ESLint passes. Existing focused tests pass (5 files, 23 tests). Independent branch checks are recorded in the pull request.                                                                             |
| 2 — Structure and deduplication | SettingsTable tokens have one definition in tokens.ts, re-exported for real table consumers. Eleven production token-only callers plus the StatusDot test use the leaf. The fallback has one shared definition. |
| 3 — Naming                      | Existing public token and fallback names are retained. New files describe token and loading-fallback ownership.                                                                                                 |
| 4 — Semantic overloading        | No meanings or public contracts change.                                                                                                                                                                         |
| 5 — Defaults                    | All token values, Placeholder props and lazy callbacks remain unchanged.                                                                                                                                        |
| 6 — Cross-domain leakage        | Removed the five audited runtime UI dependency edges and equivalent SettingsTable callers. Type-only component API imports remain because they are erased.                                                      |
| 7 — Discoverability             | Token/config/types modules express ownership explicitly; the org hub no longer depends on the router to render loading state.                                                                                   |
| 8 — Wire protocol               | Not applicable: no wire, schema or payload changes.                                                                                                                                                             |
| 9 — Initialization parity       | No new initialization, cache, listener or state owner. Existing router retention tests still pass.                                                                                                              |
| 10 — Resolver symmetry          | Not applicable: no resolution logic or fallback priority changes.                                                                                                                                               |

React guidance: direct leaf imports are applicable to these demonstrated unnecessary source edges. Existing explicit lazy imports are preserved. No runtime or emitted-byte savings are claimed; tree shaking and other legitimate importing paths can keep the same code in a chunk. No isolated production byte savings are claimed for this source-boundary sweep.

Performance guard: no background work, retained-state logic, polling, scheduling or subscriptions were modified in this group. The router change only relocates its existing loading JSX. No Rust checks are relevant to this TypeScript-only extraction.

Verification actually run:

- `xargs pnpm exec eslint --max-warnings 0 < /tmp/orgii-token-files.txt` — passed; at the time of this check, the list contained the 20 changed source/test files for this group; the follow-up hover group subsequently added 5 separately checked files
- `pnpm test src/components/StatusDot/StatusDot.test.ts src/components/SettingsTable src/modules/ProjectManager/WorkItems/workItemsViewModel.test.ts src/modules/ProjectManager/ProjectManagerLayout/components/ProjectManagerContentRouter.test.ts` — 5 files and 23 tests passed; Vite CJS and Sass legacy API deprecation notices remain

UI audit: `docs/frontend-ui-audit-2026-09-07/ComponentDependenciesTokens.md`, with 0 fix, 5 keep with reason and 0 abstract. Only token imports change in RuntimeScanningPanelColumns; concurrent data-source changes are excluded from this branch.

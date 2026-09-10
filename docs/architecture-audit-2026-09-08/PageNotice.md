# PageNotice architecture audit

Completion criteria: a single PageNotice owner, no active InlineAlert references or compatibility shim, all consumers migrated, screenshot-style custom notices consolidated, message/action semantics retained, and a scoped diff with passing frontend verification.

| Layer                       | Verdict             | Evidence                                                                                                                                                                 |
| --------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Compilation              | Pass                | `pnpm typecheck:fast` passes in the isolated branch.                                                                                                                     |
| 2. Structural deduplication | Pass                | 29 custom notices across 25 files reuse PageNotice. The old component directory is removed.                                                                              |
| 3. Naming                   | Pass                | No `InlineAlert`, `INLINE_ALERT`, or `inline-alert` matches in active source or skill guidance. Historical audit documents and archived source are not rewritten.        |
| 4. Semantic overloading     | Pass                | PageNotice denotes a card within page/panel content. InlineBanner remains the reusable panel-edge status strip; badges and field errors retain their distinct semantics. |
| 5. Defaults                 | Reviewed, unchanged | Default info icon, compact/default/pill presentations, action dispatch, and close handling retain their behavior.                                                        |
| 6. Cross-domain leakage     | Pass                | The component stays in shared components and has no domain imports. Consumers own translations, errors, and actions.                                                     |
| 7. Developer clarity        | Pass                | Component, props/action types, constants, tests, mocks, imports, and guidance use the new name.                                                                          |
| 8. Wire protocol            | Not applicable      | No transport, API, serialization, persistence, or schema changes.                                                                                                        |
| 9. Initialization parity    | Reviewed, unchanged | Existing callers use the same implementation after the rename. New notice consumers add presentation only; no service initialization changes.                            |
| 10. Resolver symmetry       | Not applicable      | No resolvers or fallback chains change.                                                                                                                                  |

## UI audit

The reports in `docs/frontend-ui-audit-2026-09-08/` cover PageNotice and each of the 25 migrated consumers. Totals: **0 fix**, **38 keep with reason**, **0 abstract**. Semantic-color cards were searched across all TSX source, including danger/warning/success and raw red/amber styles. Remaining matches are control states, table badges, progress indicators, visualizations, or already reusable panel strips. Plain field validation and full-surface placeholders retain their owning layouts.

Structured notice bodies now use a div instead of a span, supporting lists and diagnostic pre blocks. Existing alert roles, data hooks, failure details, copy controls, and retry handlers are preserved. Dynamic errors gain explicit alert roles where missing. No polling, subscriptions, retries, timer configuration, caches, or retained service state changes; existing optional auto-close behavior is unchanged. No runtime performance claim is made.

## Verification

- `pnpm typecheck:fast` — pass.
- ESLint on all changed TypeScript files plus the new PageNotice files and credential-import regression test, with `--max-warnings 0` — pass. Exact invocation used Node's `spawnSync('pnpm', ['exec', 'eslint', ...files, '--max-warnings', '0'], { stdio: 'inherit' })`, where files were the changed TypeScript paths plus those new files.
- Affected/neighboring Vitest suites — **281 files, 2,015 tests passed**. The exact invocation used Node's `spawnSync('pnpm', ['exec', 'vitest', 'run', '--config', 'config/vitest.config.ts', ...files], { stdio: 'inherit' })`; the full `files` argument list is checked in as `PageNotice.tests.txt` beside this report. Reproduce with `xargs pnpm exec vitest run --config config/vitest.config.ts < docs/architecture-audit-2026-09-08/PageNotice.tests.txt`.
- `pnpm exec vitest run --config config/vitest.config.ts src/components/PageNotice/PageNotice.test.ts src/modules/MainApp/Integrations/KeyVault/CliClients/CredentialImport/__tests__/InlineCredentialImport.test.ts` — **8 tests passed**, including structured body markup and full/partial credential errors retaining all details.
- `pnpm run check:test-placement` — pass across 522 directories.
- `git diff --check` — pass.
- Active-name search: `rg -n 'InlineAlert|INLINE_ALERT|inline-alert' src .orgii` — no matches.

An initial broad run included two unrelated files from a concurrent Markdown refactor and failed on an absent Markdown dependency. Those files were excluded, their local edits preserved, and the checks above were rerun successfully on the notice-only branch.

Desktop/native-app screenshots, dark/light visual checks, and narrow-viewport checks were not run because computer control was not requested. Rust tests were not run because no Rust or wire behavior changes. The visual migration intentionally replaces colored boxes with the shared neutral surface and standard title/action layout; long content and narrow action layouts remain visual review points. There are no dependency or persistent-format changes. Rollback is a revert of the single refactor commit.

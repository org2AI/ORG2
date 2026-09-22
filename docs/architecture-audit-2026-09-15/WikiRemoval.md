# Wiki removal and official repository links

## Completion criteria

- Wiki activation closes the menu and opens the official GitHub wiki through the shared link policy, bringing the Browser forward when selected.
- No production imports, state, components, article catalog, or search implementation remain for the removed in-app wiki.
- Deprecated identities for the main repository are removed from tracked links/examples ; existing unrelated repositories and synthetic parser fixtures remain distinct.
- Existing unrelated working-tree changes are preserved.

## Architecture coverage

| Layer                  | Result                                                                                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1 Compilation          | TypeScript check and scoped ESLint pass; Rust system_services check and both changed Rust fixture tests pass                                           |
| 2 Dead code            | Removed five wiki feature/test files, lazy import, modal host, and visibility state; production search has no remaining wiki implementation references |
| 3 Naming               | handleOpenWiki describes the action; obsolete dialog state names removed                                                                               |
| 4 Semantic overloading | Wiki now denotes the official website; historical audit records retain descriptions of the retired component                                           |
| 5 Defaults             | navigate: true explicitly brings the wiki forward; shared openLink retains internal/system preference and fallback                                     |
| 6 Boundaries           | Menu action calls the established UI link utility; no new browser, persistence, or native service implementation                                       |
| 7 Readability          | One callback owns close-then-open; menu only receives an action callback                                                                               |
| 8 Wire                 | No IPC/schema changes; native code changes are URL literals only                                                                                       |
| 9 Entry parity         | Sidebar, Windows Documentation, and native Documentation all target the same wiki; native system-browser behavior remains as before                    |
| 10 Resolver symmetry   | No multi-field resolver changes; existing browser destination resolver is reused                                                                       |

No backend architecture, persistence, session initialization, or resolver refactor is needed. Wiki content was a static TypeScript catalog with component-local search/selection state; no stored user data or migration is involved.

The repository sweep covers native help/report links, login license, issue templates, release OIDC example comments, documentation, mock data, fixtures, and archived source. Clone instructions now enter ORG2 after cloning. The remote-deduplication fixture uses example/other as its distinct second repository so the identity update does not weaken its assertion. Workflow execution and external Azure configuration are unchanged.

## Verification

- `pnpm test src/scaffold/NavigationSidebar/blocks/SidebarSettingsMenuButton.test.ts src/features/Onboarding/OnboardingModal.test.ts src/util/ui/__tests__/openLink.test.ts src/features/Org2Cloud/org2CloudSyncEngine.repoScopeSync.test.ts src/features/TeamCollaboration/importedSessionScopeMatch.test.ts src/modules/ProjectManager/Projects/components/ProjectRow/index.test.ts`: 51 tests pass across six files
- `pnpm typecheck:fast`: pass
- Scoped `pnpm exec eslint` over all eleven changed frontend source/test files: pass
- AST control inspection: no bypasses in changed production TSX files
- `cargo check -p system_services` (from `src-tauri`): pass
- `cargo test -p git_api --lib list_remotes_uses_repository_metadata_without_git_cli` (from `src-tauri`): 1 passed
- `cargo test -p orgtrack_core --lib store_db_enriches_totals_branch_and_round_usage` (from `src-tauri`): 1 passed
- `git diff --check`: pass
- Official GitHub wiki verified by HTTP read; desktop navigation was not exercised because computer control was not authorized

## Risks

Documentation now requires access to GitHub; the bundled offline article catalog is removed. Actual system-browser launch and Windows/native menu behavior were not exercised. No dependency, persistence, or wire format changes; restoring the deleted feature and menu wiring would restore the previous behavior.

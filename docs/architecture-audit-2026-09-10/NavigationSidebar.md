# Navigation sidebar simplification

## Acceptance criteria and outcome

- Deleted rendering components have no production callers, including aliases and barrel exports.
- Sessions, work items, and channels use one finite view key. Session reveal returns to sessions.
- Settings and session routes retain their distinct bodies. Docked and hover wrappers share one mapping and preserve mount/unmount behavior.
- Removed custom-shell options have no callers. Native chrome, resizing, transparency settings and context-based hover visibility retain their live paths.
- Persistence keys, browser context-pill fallback, terminal tabs, provider ownership, organization scope and pagination semantics are unchanged.
- Only sidebar simplification and its supporting tests/reports belong in this change. Earlier row-height, spacing, header and hover-interaction PRs remain separate.

## Findings addressed

| Area                   | Change                                                                                                                                                             | Evidence / preservation constraint                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Dead rendering blocks  | Delete SidebarHeader, SidebarSearch, SidebarItem, SidebarGroup, SidebarSection, SidebarEmptyState and renderIcon helper                                            | Production import/call-site trace found only dead dependencies and barrel exports; remove associated props/constants                  |
| Obsolete tab header    | Remove NavigationSidebar items/activeKey/onChange and icon-animation option                                                                                        | Sole production caller supplied an empty array and no-op change handler                                                               |
| Legacy view state      | Replace workstation/projects key plus two booleans with SessionSidebarView                                                                                         | All writers selected workstation; projects-only routing was unreachable; work-item filtering previously used a synthetic projects key |
| Selection API          | Return a single selected ID from resolveSessionSidebarMenuItemId                                                                                                   | The second result field had no consumer; preserve Team Inbox precedence over non-session content                                      |
| Naming and diagnostics | SessionSidebarViewSwitcher and accurate view diagnostic labels                                                                                                     | Remove always-zero tab count; preserve diagnostic registration ownership                                                              |
| Unused shell variants  | Remove custom theme, header slot, render-function children, unwrapped surface, traffic-light toggle, explicit force-visible/solid-surface and inner class override | Both real callers use the normal shell; hover visibility remains context-owned                                                        |
| Route duplication      | Introduce RouteSidebarBody for docked and hover wrappers                                                                                                           | Tests exercise session → settings → standard through route subscription updates without forcing remounts                              |
| Hover context          | Replace a one-field object with a boolean                                                                                                                          | Same provider boundary and true/false semantics; no state migration                                                                   |

## Deliberately retained

- `navigationSidebarTabsAtom`: BrowserProvider → useSyncBrowserTabs remains a live writer; composer browser pills use the stored fallback. Removing old stored fields needs separate restart/compatibility work.
- The WorkstationSidebarConnector directory and internal hook names: retained to avoid mechanical churn across the data-controller implementation. The live view type/switcher carry current terminology.
- Local/cloud channel controllers, work-item loading gates, session ordering and reveal hydration remain in their existing owners.
- The `standard` route value means no sidebar; it is not another legacy sidebar format.

## Ten-layer coverage

| Layer                     | Coverage / result                                                                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 Compilation             | TypeScript passes after refreshing the already-locked local dependencies                                                                          |
| 2 Dead code / duplication | Traced declarations, barrels, both route entry points and browser writer/reader chain; removed dead blocks, options and route mapping duplication |
| 3 Naming                  | Live view names use sessions/work-items/channels; switcher and selection resolver match current roles                                             |
| 4 Semantic overloading    | Separated route body, local sidebar view, terminal tab and browser memory concepts                                                                |
| 5 Defaults                | Removed unreachable projects state; preserved standard route as no sidebar and sessions as initial view                                           |
| 6 Boundaries              | Trimmed unused custom-shell API; retained provider/data ownership and browser fallback                                                            |
| 7 Developer clarity       | Removed stale terminal-era examples, tab-header docs and dead exports                                                                             |
| 8 Serialization           | No persistence or wire changes; live stored browser state retained. Rust/network payload inspection skipped as outside this change                |
| 9 Entry parity            | Shared route body with docked guide/tour wrapper and hover force-visible provider; real-effect tests verify transitions                           |
| 10 Resolver symmetry      | Preserved organization/loading and menu-selection precedence; reveal replacement/unmount cancels queued view changes                              |

## Verification

- `pnpm test src/scaffold/NavigationSidebar src/modules/shared/layouts/sidebar/RouteSidebarBody.test.ts`: 67 files, 319 tests pass
- `pnpm test src/scaffold/NavigationSidebar/connectors/WorkstationSidebarConnector/menuSelection.test.ts`: focused follow-up after single-result API simplification
- ESLint with `--max-warnings 0` over changed TypeScript files; test-placement check; `git diff --check`
- `pnpm exec tsgo --noEmit --pretty false`: passes after `pnpm install --frozen-lockfile` repaired the stale local installation. `jsqr@1.4.0` was already declared and locked; no manifest/lockfile change or source fix was needed
- Native GUI/E2E and CPU/RAM measurements not run. This refactor intends no visual change; rendered jsdom checks cover chrome, route ownership, loading and selection but do not prove native pixel parity

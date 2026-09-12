# Settings sidebar search verification

The sidebar now replaces navigation with inline page groups while searching. Each page has one icon/heading and indented matching controls. Enter chooses the actual match, headings remain navigable, and selection or Escape clears the query. Schema-backed settings remain searchable across pages; extra mounted rows retain their exact current tab as the destination.

## Performance findings

| Area               | Verdict | Evidence                                                                                                                                    | Change or reason kept                                                                                                                                                                                                                                                                         | Verification                                                                                                                                         |
| ------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Background work    | fix     | Previously every nonempty keystroke called collectRenderedSettingsControls and opened the dropdown positioning engine.                      | Snapshot visible rows on search entry/refocus; inline results use the existing sidebar scroller. No new polling, workers, observers, network/IPC or global keyboard listener.                                                                                                                 | DOM integration verifies one scan across three query changes, no scan on window focus/visibility events, and a fresh snapshot on refocus/new search. |
| Memory             | keep    | Index retains one prepared string per current entry; the measured catalog has 139 entries and 21,066 normalized characters.                 | No query-history cache or app-lifetime map. Snapshot and index are component-owned; clearing drops mounted-row data, route-key remount drops prior state, locale/navigation changes invalidate projections. This is a small bounded-by-catalog CPU/memory tradeoff, not measured RSS savings. | Normalization-count test across 100 queries; route/reset and navigation-visibility integration coverage.                                             |
| Scope/isolation    | keep    | Global catalog comes from visible navigation plus the settings registry. Live extras contain labels/descriptions/row IDs, not input values. | No account-dependent requests or shared account cache. Extra controls use the exact current path, schema keys keep canonical destinations, and hidden pages disappear from the index.                                                                                                         | Producer-level page-catalog tests prove deduplication, ownership and exact-tab routing.                                                              |
| Rendering/hot path | fix     | Previous matcher normalized every item and query tokens per group on each keystroke.                                                        | Sidebar and breadcrumb share createSettingsSearchIndex; normalization runs once per entry when rebuilding the index, once per query thereafter. Query state lives below SettingsRootBody. No hidden settings pages are mounted to populate search.                                            | Matching-equivalence benchmark, localized/multi-token matching tests, inline grouping, keyboard, IME, empty-state and clear tests.                   |

## Local matcher measurement

One-off Vitest/Node harness, English registry/navigation data with developer pages enabled; same 139 input entries and ten queries for both matchers. Compared the previous normalize/filter implementation against createSettingsSearchIndex. Equality was asserted for each query, both paths warmed for 200 calls, then each measured for 2,000 calls in one worker.

| Measurement                    | Previous matcher | Prepared matcher |
| ------------------------------ | ---------------: | ---------------: |
| Median per query               |      0.072125 ms |      0.013125 ms |
| p95 per query                  |      0.094959 ms |      0.035375 ms |
| Process CPU during 2,000 calls |       160.387 ms |        40.837 ms |

Index construction took 0.348834 ms. The baseline was already sub-millisecond. These numbers exclude DOM scans, React rendering, WebView layout, and app-wide CPU/RSS. They are a local microbenchmark, not a claim of a 5.5× faster app.

Command run: `pnpm exec vitest run --config config/vitest.config.ts src/modules/shared/layouts/blocks/SettingsSearchDropdown/settingsSearchIndex.measurement.test.ts --poolOptions.threads.maxThreads=1` — passed. The temporary timing harness was removed after measurement; permanent tests check behavior and normalization counts without machine-dependent timing thresholds.

## Lifecycle coverage and limits

| State                                                     | Expected behavior / evidence                                                                                                                                                                                                                   |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Initial / idle                                            | No page scan until a nonempty search. Static catalog is prepared once per component/catalog revision.                                                                                                                                          |
| Typing                                                    | Reuses snapshot and normalized text; only the current matching projection is retained.                                                                                                                                                         |
| Visible / hidden idle                                     | No scheduled search work. Synthetic focus/visibility events cause no scans. Live CPU/RSS is unmeasured.                                                                                                                                        |
| Refocus / clear / select                                  | Refocus refreshes currently mounted extras; clear/select drops them. Extras that appear asynchronously while search keeps focus are discovered at the next refocus or new search.                                                              |
| Route / navigation changes                                | Route key resets query and snapshot. Removed destinations and their controls disappear; keyboard selection resets with results.                                                                                                                |
| Unmount                                                   | Component-local snapshots/indexes become collectible. Existing SidebarList observer/listener cleanup is covered by its tests. Existing selected-control reveal wait remains bounded to two seconds with cancellation on new selection/unmount. |
| Offline / identity / org / session / provider transitions | No network, persisted data, transport, session or provider changes in this task. Each mounted sidebar has independent transient state.                                                                                                         |

No live visual comparison, light/dark screenshots, narrow-viewport run, Tauri profiling or RSS/leak measurement was performed. User instructions prohibit desktop UI control without explicit opt-in. The extra-row snapshot refresh behavior above is an intentional tradeoff; unloaded non-schema controls are not newly made globally searchable.

## Architecture review

Acceptance criteria: one group per page; no duplicate schema control; exact control route preserved; one matcher used by both consumers; no per-keystroke DOM snapshot; no global query cache; keyboard/clear/empty behavior verified.

Covered layers 1–7: TypeScript/lint, removal of the unused persistent-dropdown branch, shared matcher ownership, page/control naming and discriminated selection, empty/default matching, UI-local projection boundaries, and clear lifecycle comments. Layer 8 is inapplicable: no wire/serialization changes. Layer 9: production sidebar tests render SettingsRootBody and the actual collector/registry; breadcrumb tests retain the existing trigger path. Layer 10: schema controls retain registry-derived labels/paths/keys; mounted extras deliberately use DOM labels/IDs and the exact mounted path, with schema-key deduplication before projection. No backend, persistence, schema or dependency changes.

## Checks

- Focused Vitest suite: **31 tests passed in 9 files**, covering sidebar integration/chrome/page projection, shared matcher/dropdown/reveal helpers, navigation/schema catalog, and SidebarList lifecycle.
- `pnpm typecheck:fast` — passed.
- Changed-file ESLint and Oxlint with `--max-warnings 0` — passed.
- `git diff --check` — passed.

Exact focused-suite command:

```sh
pnpm test src/scaffold/NavigationSidebar/variants/SettingsSidebar.search.test.ts src/scaffold/NavigationSidebar/variants/settingsSidebarSearchPages.test.ts src/scaffold/NavigationSidebar/variants/SettingsSidebar.chrome.test.ts src/scaffold/NavigationSidebar/blocks/SidebarList.test.ts src/modules/shared/layouts/blocks/SettingsSearchDropdown src/config/settingsSearch.test.ts src/config/settingsNavigation.test.ts
```

Exact ESLint command (Oxlint checked the same eleven source/test files):

```sh
pnpm exec eslint src/scaffold/NavigationSidebar/variants/SettingsSidebar.tsx src/scaffold/NavigationSidebar/variants/SettingsSidebarSearch.tsx src/scaffold/NavigationSidebar/variants/settingsSidebarSearchPages.ts src/scaffold/NavigationSidebar/variants/settingsSidebarSearchPages.test.ts src/scaffold/NavigationSidebar/variants/SettingsSidebar.search.test.ts src/scaffold/NavigationSidebar/variants/SettingsSidebar.chrome.test.ts src/modules/shared/layouts/blocks/SettingsSearchDropdown/{index.tsx,settingsSearchIndex.ts,settingsSearchIndex.test.ts,SettingsSearchDropdown.test.ts,settingsControlSearch.ts} --max-warnings 0
```

Performance verdict: **blocked** for live Tauri CPU/RAM and visual validation. Automated correctness checks and the local matcher measurement pass; whole-app resource savings are not established.

## September 13: provider setup actions

Adds 11 static setup entries to the existing memoized index. No provider registry hook, account API, observer, timer, cache history or subscription is introduced in search. Queries retain the existing prepared matcher and snapshot lifecycle. Empty/hidden search and route changes retain the existing ownership; provider-switch remounts release previous wizard-local drafts. Wizard networking begins only after navigating to its existing setup surface. No runtime CPU/RAM improvement is claimed for this addition.

44 focused search/catalog tests, fast typecheck and scoped ESLint passed. Source-level lifecycle verdict: bounded. Live desktop CPU/RAM verification remains unperformed under the user's computer-control restriction.

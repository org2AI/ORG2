# Settings retirement verification

## Responsibility and removal evidence

Retire obsolete settings presentation and support paths left after sections moved to direct component composition. This change does not consolidate tab metadata or redesign controls.

- All six app sections have custom section slots. None supplies declarative containers. Removed the field/container renderer chain, empty custom-row registry, supporting types and coverage traversal.
- Agent Teams reaches `AgentBuiltinConfigSection` directly through `BuiltInAgentDetailViews`; removed unreachable agent slot wrappers and the two empty-coverage manifest entries. The live agent components remain.
- Appearance imports three named editor section components; removed only their unused default page wrapper and unused subpage button configuration. The unused outgoing `subpage` builder option/type is retired; incoming URL parsers and breadcrumb segment metadata remain unchanged.
- `settingsToolbarAtom` had no production writer. Removed its definition, barrel export, reader, refresh-hook invocation and unreachable action branches. Region notices, integration actions and Agent Teams add actions remain.
- Four LAN URL/IP functions had no callers. Removed those functions and their isolated support chain. Token generation, relay helpers, pairing APIs, backend LAN support and persisted preferences remain.
- Removed unused default aliases for AppIconPicker and SkinSwatch; named components remain.

- Retired Learnings Browser's unused standalone mode, full-page-only columns and filters, toolbar/scope-lock props, initial-filter atom, status card and formatter. The only caller still renders the Evolution panel. Removed the unused status-report request/state while preserving scoped list merging, mutations, filtering and error retry. Backend learning status RPC remains for other callers.
- Simplified Background Settings to its sole embedded composition. Removed standalone header/navigation and exclusive theme/skin hooks; retained palette editing, opacity controls and undo/redo.
- Removed the cross-window event with no listeners and the timestamp atom with no readers. The bootstrap hook retains its storage listener and exact theme/zoom handlers, now guarded by own-property lookup. Tests verify unrelated/null keys, theme and zoom effects, and cleanup/reopen behavior.
- Removed header options never supplied by its route producer (single-action plus, custom plus title, ellipsis, divider/visibility/danger options). Kept the Agent Teams dropdown and dynamic integration buttons.
- Removed the unused frontend reset-all atom/adapter, the unused SectionDescription component/self-test and control-cell token, and unused settings-related export aliases. Kept registered reset IPC and all live named components, persistence writers and file-deletion recovery.

Repository-wide symbol sweeps across `src` and `tests` found no remaining references to retired APIs. No settings schema, dependency, lockfile, database, persisted data, IPC definition or wire format changed. The Learnings browser no longer requests its unused status report. Reverting the commit restores the removed source; no data recovery is needed.

## Architecture coverage

| Layer                        | Evidence                                                                                                                    |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 1. Compilation               | Fast TypeScript check and changed-file lint; no Rust edits                                                                  |
| 2. Dead code / deduplication | Production route-to-manifest-to-slot tracing plus caller sweeps; retained leaf components explicitly excluded from deletion |
| 3. Naming                    | Removed stale row-registry/page comments alongside deleted code                                                             |
| 4. Semantic overloading      | Retired unused manifest `agent` discriminator; broader section/tab/coverage terminology changes remain outside scope        |
| 5. Defaults                  | Retained section missing/error behavior, incoming route normalization and default app section behavior                      |
| 6. Boundaries                | Kept backend agent definitions separate from application settings-file keys                                                 |
| 7. Developer clarity         | Removed empty extension registry, disconnected adapters and unused toolbar API                                              |
| 8. Wire protocol             | Intentionally skipped live payload inspection: no wire or backend modifications                                             |
| 9. Init parity               | Checked app section and Agent Teams entry points; runtime/multi-instance initialization unchanged and not retested          |
| 10. Resolver symmetry        | No persisted-value resolver changed; broad resolver audit intentionally excluded                                            |

## Performance guard

| Area               | Verdict | Evidence                                                                                                 | Change or reason kept                                                           | Verification                                             |
| ------------------ | ------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Background work    | fix     | Settings toolbar never registered a refresh callback, so its refresh hook could not receive a user click | Removed the hook invocation; no timer, polling, request or listener replacement | Source trace and toolbar tests                           |
| Memory             | fix     | One unused toolbar atom subscription and hook-local state/ref allocation                                 | Removed owner and subscriber entirely; no replacement cache                     | No remaining symbol references; typecheck                |
| Scope/isolation    | keep    | Integration toolbar atom and region notice ownership remain unchanged                                    | Preserve existing route scoping and identity behavior                           | Toolbar tests keep integration actions off app routes    |
| Rendering/hot path | fix     | Container renderer had no manifest entries capable of reaching it                                        | Delete dormant generic rendering path; preserve six custom sections             | Real registry/manifest dispatch tests for all six routes |

Lifecycle matrix: the removed toolbar channel is absent on mount, idle, visible/hidden, focus return, route switch and unmount. There is no replacement resource requiring shutdown, retry, or eviction. Account, network, org, session, provider-ingestion and machine-topology behavior is unchanged. Tests mount and unmount the toolbar probe and check app, integration, Agent Teams and non-settings routes. Cross-window tests dispatch storage events, close/reopen the hook, and verify no duplicate listener effect. The embedded background test exercises actual palette/opacity atom writes, keyboard undo/redo, and keyboard-listener cleanup. Learnings hook tests verify scoped and unscoped list loading, mutation refresh, retry, and zero calls to the retired status-report request. No new cache or background resource is introduced. No CPU/RSS or bundle-size improvement is claimed. Live desktop and dual-instance measurements were not run; this is removal-only lifecycle verification.

Performance verdict: pass for the removal-only scope, based on eliminated resource ownership, preserved route behavior, compilation and targeted tests.

## Checks

The expanded targeted run passed 30 files / 131 tests. Fast TypeScript and changed-file lint passed. Exact commands and outcomes are recorded in the PR Verification section. Scope checks include no remaining retired-symbol references, formatting, changed-file lint, TypeScript compilation and `git diff --check`. Targeted tests cover routes, navigation, search, schema coverage, section dispatch, toolbar actions, notifications, storage and mobile-remote pairing/relay behavior. Full repository tests, Rust checks and real desktop visual verification are outside this source-retirement scope.

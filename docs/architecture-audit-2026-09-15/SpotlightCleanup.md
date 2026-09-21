# Spotlight cleanup implementation

2026-09-15. Implements the approved findings in [the original audit](SpotlightSystem.md). No persistence migration, historical data deletion, Rust change, or wire-format change.

## Completed findings

| Original finding                               | Result                                                                                                                                                                                                | Owning boundary / verification                                                                                                                                          |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Parallel layer flags and inconsistent activity | One `SpotlightInitialLayer` route, exhaustive body switch, one root activity predicate. Requests use actual dialog visibility, including while a child is open                                        | Root composition test covers branch-to-editor retargeting, workspace/back restoration and exactly one capture keyboard owner; no listener after unmount                 |
| Empty command mode                             | Lists registered, implemented argument-free undo, redo, close and close-saved commands; translated/searchable, canonical dispatch, closes on success                                                  | Registry subscription test covers late registration, filtering, execution and unregistration. Parameterized and unimplemented editor commands remain excluded           |
| Unreachable confirmation/branch action flow    | Deleted confirmation hook/view, obsolete branch fetch/adapter, repo-first builder and execution stages. Root reducer handles action choice and back/reset only                                        | Production hook tests verify language, theme, skin and Finder still complete immediately. `ActionDefinition.requiredParams` now permits exactly one supported parameter |
| Dead state and API                             | Deleted initial-action atom, unused reducer selection, embedded worktree mirror, uncontrolled visibility, unused provider initial state and input loading prop; removed 47 unused export declarations | Fast typecheck and all Spotlight tests pass; live named/default consumers preserved                                                                                     |
| Stale worktree refresh                         | Mutation invalidates the previous request token and starts a fresh request. Obsolete results cannot write cache or delete newer in-flight work                                                        | Deferred-response tests cover create/remove invalidation and an old request settling both before and after the new request                                              |
| Stale GitHub branches                          | Effect-lifetime guard rejects superseded responses; one GitHub row mapper                                                                                                                             | Deferred A/B and closed-request tests. Current OSS connection provider is a stub; live GitHub behavior is not claimed                                                   |
| Shared controls / model metadata               | Shared Button activation with independent pin/checkbox/variant controls; semantic tag color; typed presentation slots and model-owned DOM-attribute adapter                                           | Row DOM/action tests and production AST inspection; see [UI follow-up](../frontend-ui-audit-2026-09-15/SpotlightCleanup.md)                                             |
| Repeated open/footer plumbing                  | Eleven semantic open helpers share one request writer; three footer presets share one navigation adapter                                                                                              | Existing opener tests and new registered/unregistered footer tests                                                                                                      |
| Unowned focus work                             | One cancelable deferred-focus helper shared by selector and keyboard navigation. Pending resets/selection work is canceled on inactive transition                                                     | Rapid open/close and existing focus ownership tests; see [lifecycle follow-up](../org2-performance-guard-2026-09-15/SpotlightCleanup.md)                                |

## Deliberate keeps

- Startup/standalone ActionSystem fallbacks remain: both AppLayout and StationWindow provide the system, but action registration is deferred until idle. A provider's presence does not prove registration is ready. Fallbacks continue using existing services and typed Spotlight openers; footer dispatch and fallback navigation are mutually exclusive.
- `SpotlightModalView` remains because add-working-directory forms render it. Breadcrumb segments remain live in forms/palettes.
- The existing heterogeneous domain-data dictionary remains for current consumers. Presentation slots are explicit types, and model/account DOM attributes are produced by the model palette adapter rather than interpreted by the shared row.
- Existing virtualization, 16-entry/five-minute completed worktree cache bounds and conditional portal mounting are preserved. No polling added.

## Architecture coverage

| Layer                     | Coverage                                                                                                                                                 |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 Compilation             | Full fast TypeScript check, scoped ESLint/oxlint, dependency boundaries and changed-file length checks pass                                              |
| 2 Dead code / duplication | Production entry/callback trace before deleting unreachable flow and exports; repeated opener/footer ownership consolidated                              |
| 3 Naming                  | Corrected live modal header and inaccurate LRU comment; removed obsolete confirmation terminology                                                        |
| 4 Semantic overloading    | Dialog `isOpen` means visibility; `isRootActive` owns root interaction; `activeLayer` owns the body; branch submode remains local footer state           |
| 5 Defaults                | Exhaustive route switch/reducer; empty command stub replaced with supported registered commands                                                          |
| 6 Domain leakage          | Typed presentation fields; model-specific DOM attributes moved into a model adapter                                                                      |
| 7 New-developer clarity   | Removed unusable uncontrolled API, pretend execution stage and dead loading prop                                                                         |
| 8 Wire                    | Existing Git request arguments preserved; no serialization/schema changes. Rust compilation and live transport intentionally not run                     |
| 9 Init parity             | Imperative and React routes use the same transition; root/child requests tested at composition boundary; startup fallback reasons documented             |
| 10 Resolver symmetry      | GitHub completion now observes lifetime like the local path; worktree generations guard both writes and in-flight cleanup. No unrelated resolver rewrite |

## Source invariant and remediation

The authoritative worktree contents still come from Git. The defect was the frontend cache accepting a request initiated before a mutation as its fresh result. Invalidation now ends that generation at the cache boundary; stale responses cannot repopulate the cache. No persisted pollution was established, so historical remediation is unnecessary. The request atom and route transition similarly own Spotlight routing rather than hiding bad state in rendering.

## Verification

- `pnpm test src/scaffold/GlobalSpotlight src/hooks/keyboard`: **65 files, 304 tests passed**
- `pnpm typecheck:fast`: **passed** on the final working tree
- `pnpm exec eslint <changed TypeScript files> --max-warnings 0 --report-unused-disable-directives`: **passed**
- `pnpm exec oxlint -c .oxlintrc.json --max-warnings 0 <changed TypeScript files>`: **passed**
- `pnpm check:boundaries`: **passed**
- Changed paths piped as NUL-delimited input to `node scripts/ci/check-changed-file-length.cjs`: **86 production TypeScript files, all at most 700 lines**
- Scoped `git diff --check`: **passed**
- TypeScript AST scan of production Spotlight source: no raw button/input/textarea/select JSX or native `createElement` controls. Three shell div click handlers are focus/event routing, not action substitutes

No desktop control was used, per the user's preference. Native pointer layering, theme contrast, focus timing, visible/hidden idle CPU/RSS and real GitHub/network behavior remain unmeasured. DOM tests do not prove browser hit-testing or native focus. The change is isolated from unrelated working-tree changes for a Chloe-JY-authored commit and pull request.

## UI consolidation follow-up

The six approved UI sweeps are implemented; see [the component report](../frontend-ui-audit-2026-09-15/SpotlightComponents.md). Architecture layers 1–7 cover additive Form.Item props, narrow field/footer/surface ownership and deletion of the unreachable combined clone route. Layer 9 preserves native form submission and guide anchors. Layer 10 covers directory-selection ownership and clone handler concurrency. Layer 8 was reviewed for scope only: these UI APIs are internal React contracts, with no persisted or wire changes.

Clone busy state now reaches both live forms. A synchronous in-flight guard rejects a second clone before a render can disable the controls; finally releases the guard on success or failure. This supports the shared footer's busy policy. Other second-pass findings remain recorded for follow-up.

## CI follow-up

CI exposed two checks omitted from the initial local run: unused translation keys and the repository-wide typed-lint baseline comparison. Removed the four newly unused keys from all 13 common locale files, without changing the baseline. Navigation dispatch and directory selection now catch rejected promises; synchronous selector reset/selection work uses queueMicrotask with its existing cancellation guards. Rejection tests cover both async boundaries.

The broader CI test selection also found Work Item consumer tests clicking the compound row wrapper. They now activate its shared Button while retaining assertions for domain selection, refresh/retry, focus restoration and disabled actions. This preserves the row's sibling-control structure.

Validation: `pnpm check:i18n-keys` and `NODE_OPTIONS=--max-old-space-size=6144 pnpm check:typed-lint` pass with zero new findings; baselines are unchanged. CI's test selector ran 719 files: 717 passed, and the two consumer suites exposed seven obsolete wrapper-click assertions. After updating those selectors, `pnpm test src/features/SessionCreator/components/WorkItemPickerModal/WorkItemPickerModal.test.ts src/features/SessionCreator/variants/ChatPanel/WorkItemAttachmentControl.test.ts src/scaffold/GlobalSpotlight src/hooks/keyboard` passes **67 files, 325 tests**, including both consumers and both new rejection regressions. Full fast typecheck and scoped ESLint pass.

# Spotlight system audit

> Historical audit snapshot. Approved fixes and current verification are recorded in [SpotlightCleanup.md](SpotlightCleanup.md).
> Audited the current working tree on 2026-09-15. Audit only; no production changes.

## Acceptance criteria for a cleanup

- One active Spotlight layer, one active keyboard owner, and externally requested routes consumed while any layer is open
- No action entry that can only produce an empty placeholder
- Remove state and reducers only after tracing production entry points
- A refresh after a mutation cannot resolve from a request started before that mutation
- Shared result controls follow the Button convention and retain independent pin/checkbox controls
- Preserve current language/theme/skin selection, Finder reveal, repository forms, and standalone palette consumers

## Findings

### 1. Replace parallel layer flags with one route — high priority

Locations: `src/scaffold/GlobalSpotlight/hooks/features/useSpotlightOverlayLayers.ts:97`, `src/scaffold/GlobalSpotlight/index.tsx:180`, `src/scaffold/GlobalSpotlight/index.tsx:249`, `src/scaffold/GlobalSpotlight/hooks/features/useSpotlightEffects.ts:118`.

Eleven independently writable layer states model one mutually exclusive body. Their open handlers set their own flag without clearing peers. The render ternary resolves conflicts by position rather than a state invariant.

The duplicated active-state checks already differ:

- `useSpotlightEffects` receives false while most child layers are displayed. Consequently a new imperative request is not consumed while, for example, the branch picker is open. It can sit in the atom until the user returns to the root, then reopen a requested layer unexpectedly. The comment promising visible-layer retargeting does not match the composition.
- The default selector remains enabled during working-directory, organization, and GitHub-import layers. Its document-level keyboard listener remains installed even though its input/list is not rendered. The directory picker installs another selector; the parent listener can consume navigation events on non-input targets.
- Editor is excluded from the default selector but not from the effects gate or restoration gate.

Use a discriminated `activeLayer` with payloads, based on the existing `SpotlightInitialLayer` union (`src/store/ui/uiAtom.ts:421`). Consume open requests using actual dialog visibility; derive `isRootActive` once for keyboard and root-view work. Use an exhaustive switch to render layers. Keep branch submode only where the footer consumes it. Add composition tests for branch-to-editor retargeting, root-to-directory keyboard ownership, and back/restoration; the current effects test keeps its harness `isOpen=true` and therefore misses the production gating issue.

### 2. Editor command mode is a reachable empty implementation — high priority

Locations: `src/scaffold/GlobalSpotlight/palettes/EditorPalette/hooks/useCommandMode.ts:19`, `src/scaffold/GlobalSpotlight/hooks/features/spotlightActionDefinitions.navigation.ts:430`, `src/ActionSystem/actions/spotlightActions.zod.ts:173`.

The UI advertises Run editor command, and the ActionSystem opens command mode. `useCommandMode` returns `[]` whether enabled or disabled. This is a live product stub, not an unused export. A focused execution of the transpiled hook confirmed `{items: [], isLoading: false}` with `enabled=true`.

Choose either to restore command items from an authoritative supported command source, or explicitly retire the mode together with its action, shortcut, prefix, labels, and tests. Merely deleting the redundant `useMemo` leaves the empty feature in place.

### 3. Delete the unreachable confirmation/branch action machinery — largest deletion opportunity

Locations: `src/scaffold/GlobalSpotlight/config.ts:134`, `src/scaffold/GlobalSpotlight/hooks/useSpotlight.ts:345`, `src/scaffold/GlobalSpotlight/hooks/useSpotlight.ts:492`, `src/scaffold/GlobalSpotlight/hooks/core/spotlightReducer.ts:48`, `src/scaffold/GlobalSpotlight/hooks/features/useConfirmationPage.ts:36`.

The canonical `ACTIONS` list contains four parameterized commands. Tracing their actual selection callbacks gives:

| Action        | Required parameter | Production completion                                                                                                      |
| ------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Language      | language           | Dispatch setting, close, reset in the same event; the pushed language segment does not produce a lasting confirmation view |
| Theme         | theme              | Dispatch setting, close, reset; no theme segment is pushed                                                                 |
| Skin          | skin               | Set the appropriate preference atom, close, reset; no skin segment is pushed                                               |
| Finder reveal | repo               | Reveal immediately, close, reset; return before `PUSH_REPO`                                                                |

No configured action requires a branch. There is no production `PUSH_SEGMENT` dispatch. Thus the fallback `PUSH_REPO`, branch selection, repo-first action list, and visible confirming/executing flow have no reachable user path under current configuration. `handleExecute` only closes and resets; it does not execute a domain action.

Remove the unreachable flow together: `useConfirmationPage`, confirmation view/wiring, unused stages and derived fields, branch-only callbacks/building, and the obsolete `hooks/data/useBranches.ts` fetch implementation. Preserve `BranchPalette/useBranchFetch.ts`, which serves live branch palette/dropdown callers. Remove dead branches before factoring the reducer's seven repeated path-update blocks.

Do **not** delete `SpotlightModalView`: `WorkingDirectoryPalette` → add-directory flow → `AddWorkingDirectoryModalShell` renders it. Path segments also remain live as form/palette chrome.

### 4. Remove independently confirmed unused state/API surfaces — low-risk first batch

| Location                                                                       | Evidence                                                                                                                                            | Cleanup                                                                                                                |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `src/store/ui/uiAtom.ts:397`                                                   | `spotlightInitialActionAtom` has no production writer of a non-null action; its only consumer reads and clears it                                   | Delete atom, initial-action effect, and handling ref                                                                   |
| `src/scaffold/GlobalSpotlight/hooks/core/types.ts:51`                          | Reducer `selectedIndex` is never consumed by production Spotlight; no production `SET_SELECTED_INDEX` dispatch; `useSelector` owns actual selection | Delete field/action and repeated index resets                                                                          |
| `src/scaffold/GlobalSpotlight/hooks/features/useSpotlightOverlayLayers.ts:105` | `embeddedWorktreeMode` is updated and returned, but the sole consumer only takes the setter                                                         | Remove mirror state, setter, and parent `onModeChange` wiring; retain any separately used WorktreePalette callback API |
| `src/scaffold/GlobalSpotlight/index.tsx:548`                                   | Internal open state starts false and is only ever set false; the sole production caller supplies controlled visibility                              | Require controlled props and remove the unusable uncontrolled branch                                                   |
| `src/scaffold/GlobalSpotlight/hooks/features/useSpotlightEffects.ts:39`        | `closeModal` is required and passed but never read                                                                                                  | Remove argument                                                                                                        |
| `src/scaffold/GlobalSpotlight/shared/SpotlightInput.tsx:52`                    | `isLoading` is renamed `_isLoading` and never rendered/used                                                                                         | Remove misleading prop and callers, or implement an explicitly desired loading presentation                            |

Knip additionally reports unused default/barrel exports throughout Spotlight. These are export-cleanup candidates, **not** proof the underlying functions/components are dead. For example, `useEditorPalette` is consumed through its default export and `SpotlightModalView` through a named export.

### 5. Worktree refresh can restore a pre-mutation snapshot — high priority

Locations: `src/scaffold/GlobalSpotlight/palettes/BranchPalette/useWorktreeMap.ts:74`, `src/scaffold/GlobalSpotlight/palettes/BranchPalette/useWorktreeMap.ts:103`, mutation caller `src/scaffold/GlobalSpotlight/hooks/features/useSpotlightPickerActions.ts:148`; remove caller `src/scaffold/GlobalSpotlight/palettes/BranchPalette/index.tsx:96`.

`refreshWorktreeMap` deletes the completed cache, then calls a loader that returns an existing in-flight promise for the same repo. If enumeration began before create/remove, the requested refresh can reuse that earlier snapshot and write it back with a new five-minute freshness timestamp.

A focused probe executed the actual transpiled module with deferred Git responses: start revalidation, call refresh before it resolves, resolve the old snapshot. **Only one Git request ran; both callers received the same old result.** No real Git mutation or network request was issued.

Keep single-flight for equivalent reads, but invalidate a per-repo generation on mutations and ensure the refresh waits for a request from the new generation. Guard cache writes and promise cleanup so an old completion cannot overwrite data or remove a newer in-flight entry. Add a deferred-response regression covering create and remove invalidation.

### 6. GitHub branch loading lacks the local path's stale-response protection

Location: `src/scaffold/GlobalSpotlight/palettes/BranchPalette/useBranchFetch.ts:134`.

The GitHub effect writes `branches` and clears fetching after resolution without checking the current connection/repository or effect lifetime. Switch A → B while A is slow: A can settle last and overwrite B's visible branches. Local fetching at least checks `intendedRepoIdRef`; the GitHub path does not. Both BranchPalette and BranchDropdown consume this hook.

Extract the repeated GitHub-to-BranchItem mapper and add scoped/generation-guarded completion in the same change. Verify out-of-order A/B results, close/reopen, and connection change. This is a source-confirmed missing guard; live GitHub timing was not exercised.

### 7. Shared row bypasses Button; metadata also leaks model-specific concerns into core

Locations: `src/scaffold/GlobalSpotlight/components/SpotlightItemRow.tsx:276`, `src/scaffold/GlobalSpotlight/components/SpotlightItemRow.tsx:379`, `src/scaffold/GlobalSpotlight/shared/types.ts:92`.

The shared actionable row is a clickable div without its own control semantics. This directly violates the repository's shared Button rule. Input-level arrow/Enter handling does not make the DOM row a Button. Use a reusable compound row containing a shared Button for activation, with checkbox/pin controls as siblings to avoid nested interactive controls. Preserve pointer hover, context menus, selection and virtualization geometry.

Separately, this supposedly shared renderer knows `modelSection`, `modelId`, `groupModelIds`, and account/model source fields. `SpotlightItemData`'s open-ended unknown dictionary forces runtime type checks and assertions for presentation slots. Define typed presentation fields (`labelContent`, `statusContent`, `descTitle`, etc.) and isolate model-specific DOM metadata behind a typed adapter. Avoid a new catch-all abstraction.

See the companion UI audit for exact fix/keep decisions.

### 8. Consolidate open/dispatch plumbing after deletion

Locations: `src/scaffold/GlobalSpotlight/openSpotlight.ts:104`, `src/scaffold/GlobalSpotlight/hooks/useSpotlight.ts:169`, `src/scaffold/GlobalSpotlight/components/ManageAgentsFooterAction.tsx:21`, `src/scaffold/GlobalSpotlight/components/ManageModelsFooterAction.tsx:31`, `src/scaffold/GlobalSpotlight/components/ManageKeysFooterAction.tsx:30`.

Eleven open helpers repeat store readiness, request assignment and open assignment. Keep their semantic names, implement their shared work once with a typed request function, and route in-React and imperative calls through the same route transition.

Three footer components repeat close → dispatch-if-registered → navigation fallback. The main hook additionally duplicates many action implementations in a fallback registry. Consolidate the three footer navigation adapters. For the wider registry, first document which production roots lack ActionSystem registration; keep needed standalone fallbacks until parity is proven, then share the authoritative service rather than maintaining independent algorithms. Do not delete fallbacks merely because tests can run with a provider.

## Ten-layer coverage

| Layer                     | Coverage / outcome                                                                                                                                                                                                                                    |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 Compilation             | Spotlight tests and scoped oxlint passed; full fast typecheck failed outside Spotlight on `ChatGroupMeta.hasBody`                                                                                                                                     |
| 2 Dead code / duplication | Traced portal → root → action items → callbacks and add-directory/editor/branch callers; findings 3, 4, 8                                                                                                                                             |
| 3 Naming                  | `SpotlightModalView` header says SpotlightFormView; old “NEW ARCHITECTURE”/“single hook” comments no longer describe multiple palette owners; lower priority                                                                                          |
| 4 Semantic overloading    | `isOpen` means actual dialog visibility, root activity, or branch-tab activity; route finding 1 is the consequential case. `workspace` layer hosts WorkingDirectoryPalette; `currentRepo` can mean selected global repo or collected action parameter |
| 5 Defaults                | Route effect's long if/else silently consumes future unhandled kinds; modal view's default null is acceptable for its caller's stage mapping; command stub always empty                                                                               |
| 6 Domain leakage          | Model/account DOM metadata in shared row; finding 7                                                                                                                                                                                                   |
| 7 New-developer clarity   | Advertised command mode with no implementation, unused execution state, and unusable uncontrolled mode are misleading                                                                                                                                 |
| 8 Wire                    | Source inspection of open-request atoms and branch/worktree calls; actual network serialization and Rust endpoint behavior were not exercised. No wire-format change is proposed                                                                      |
| 9 Init parity             | Compared imperative requests, direct React layer callbacks, portal mount and effects-test harness; visibility gate diverges in production. Footer fallback parity remains a prerequisite to registry deletion                                         |
| 10 Resolver symmetry      | Local vs GitHub async completion guards differ; selected repo path fallbacks inspected. No separate path-resolution defect is asserted                                                                                                                |

## Recommended batches

1. Remove independently unused state/exports, then the unreachable action/confirmation flow; run the same Spotlight suite
2. Replace layer flags and open-request plumbing with one typed route; add composition tests at the actual root boundary
3. Fix branch/worktree stale completion at their producing request/cache boundary with deferred-response tests
4. Resolve command-mode product behavior; implement or retire the whole entry surface
5. Fix shared row controls and typed row metadata; then consolidate footer adapters

These are separate objectives if delivered as PRs. No need to redesign all palettes at once.

## Verification

- `pnpm test src/scaffold/GlobalSpotlight`: **50 files, 232 tests passed**
- `pnpm exec oxlint -c .oxlintrc.json --max-warnings 0 src/scaffold/GlobalSpotlight`: **passed**
- `pnpm typecheck:fast`: **failed**, 13 diagnostics about missing `ChatGroupMeta.hasBody` in ChatHistory implementation/tests, outside audited Spotlight paths
- `pnpm exec knip --reporter json`: exit 1 with repository unused-export findings; manually inspected Spotlight subset and traced callers; not treated as proof of whole-module deadness
- TypeScript AST scan of production Spotlight TS/TSX: no raw button/input/textarea/select JSX; one actionable div row and three shell click handlers. Source inspection classified shell click handlers as focus routing, not substitute action controls
- Focused Node/TypeScript transpilation probes: confirmed empty command mode and stale in-flight refresh reuse with mocked dependencies
- No source fixes, database cleanup, Git mutation, real network requests, desktop UI control, full Rust compilation, or CPU/RSS measurement. The independent Rust web-tool file named `spotlight.rs` is not part of this UI subsystem audit

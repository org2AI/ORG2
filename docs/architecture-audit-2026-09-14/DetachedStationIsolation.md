# Detached station isolation follow-up to #1711

## Behavior and owning boundaries

The My Station / Agent Station selector and corresponding shortcuts switch in the current window. A detached document seeds its initial mode from the native label and keeps later choices in a local atom. Explicit Open in new window actions remain the only station actions that create or focus another window. The current mode also drives the native title.

Session following uses a local session-view atom in a detached window. Main remains the authoritative session selection; storage events cannot apply the cold-start null transform to the detached pipeline, and following cannot overwrite main's persisted metadata. The follower requests a current snapshot after its listener registers, closing the startup gap between route seeding and live events. Session updates preserve the user's local station choice; an explicit detach/open request can select its requested station.

Workstation navigation becomes an intent handled by the mounted station shell. A Router blocker catches direct links before the main AppShell can mount. Settings and Kanban requests target main. The chat-maximized atom rejects writes in a detached station at the owning boundary; service and route-entry guards also avoid inappropriate main-layout actions.

BrowserSessionWebview produces a different native label for each secondary parent window. All frontend label consumers (browser diagnostics, screenshots, and context pills) share the same builder. Main retains its existing label format. Rust resolves scoped labels back to the original browser session ID and refuses cross-parent native reuse. Bulk hide, layering, and reload cleanup are parent-scoped; native destruction evicts station-owned lifecycle slots. Native browser shortcuts target the parent instead of broadcasting to every app window.

No persisted data is deleted or rewritten. No historical cleanup or migration is required. Browser tab persistence still has the independently documented last-writer limitation from #1711; this change fixes native ownership, not that persistence model. Reverting the change and restarting the app restores the previous transient/native behavior.

## Architecture checklist

| Layer                         | Coverage                                                                                                                                              |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Compilation                | TypeScript check and browser Rust tests/Clippy; full app check recorded below                                                                         |
| 2. Live paths / deduplication | Traced selector, palette, direct Router, native view creation, diagnostics, and cleanup; one shared native-label builder                              |
| 3. Naming                     | Updated pinned-mode comments to distinguish initial window identity from current local selection                                                      |
| 4. Semantic ownership         | Browser session ID remains distinct from native view label; window identity remains distinct from current station mode                                |
| 5. Defaults                   | Main/browser-dev behavior preserved; local station is seeded from its physical label; unknown station-ready labels ignored                            |
| 6. Boundaries                 | Layout writes rejected at the atom; native bulk commands use the injected calling window                                                              |
| 7. Readability                | Added ownership and lifecycle comments at the storage, route, and native boundaries                                                                   |
| 8. IPC                        | Optional station-mode event field; ready and main-navigation events; native command window parameter is Tauri-injected, with no caller payload change |
| 9. Initialization parity      | Cold route seed followed by registered-listener snapshot; repeated native window creation clears old lifecycle state                                  |
| 10. Resolution                | All native-label consumers use the same window-aware resolver; main labels and browser session IDs retain compatibility                               |

## Lifecycle/performance guard

| Area               | Verdict | Evidence                                                                                    | Change or reason kept                                                                                       | Verification                                                                                     |
| ------------------ | ------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Background work    | fix     | Main and detached documents previously controlled the same native label and bulk operations | Parent-scoped native operations and shortcuts; event-driven session snapshot                                | Production BrowserSessionWebview label test; browser Rust checks                                 |
| Memory             | fix     | Native destruction does not run React cleanup                                               | Evict station-owned refs, generations, cancellations, and active-browser target; no new polling or registry | Rust close/reopen test preserves peer state and resets own count                                 |
| Scope/isolation    | fix     | Storage parse could null the followed session; station actions could write main layout      | Local session/mode atoms and main-layout write gate                                                         | Both storage/event orders, direct atom writes, service actions, and main chat-layout regressions |
| Rendering/hot path | fix     | Route navigation could replace the standalone shell                                         | Tab intents and Router guard keep the same owner mounted                                                    | Mounted real Router test proves main shell never mounts; selector tests cover both directions    |

Visible/hidden native idle, native close/reopen, macOS chrome, Windows/Linux behavior, and CPU/RSS measurements were not exercised. Computer control was not authorized. No cloud/provider-ingestion behavior is changed or claimed.

Performance verdict: blocked pending native lifecycle/resource measurements. Automated ownership, state-isolation, and cleanup checks pass; this is not a measured runtime-performance claim.

## Verification

Frontend verification ran on develop `8d7c7987a`. Before publication, the checkout was fast-forwarded without conflicts to `09c1872ae`; those upstream changes only adjust PR policy. `node --test scripts/ci/pr-policy.test.cjs` passed all 8 tests after integration, and the browser Rust suite was rerun successfully.

Frontend command:

```sh
node_modules/.bin/vitest run --config config/vitest.config.ts src/modules/StationWindow src/modules/__tests__/useStationWindowBridge.test.ts src/engines/BrowserCore src/hooks/platform/useTauriListen.test.ts src/hooks/navigation src/store/session/__tests__/viewAtom.test.ts src/store/session/__tests__/stationWindowIsolation.test.ts src/store/ui/chatPanel src/store/chatPanel src/store/ui/__tests__/stationModeAtom.test.ts src/store/workstation/routeEntryAtom.test.ts src/store/workstation/stationWindowAtoms.test.ts src/modules/WorkStation/shared/StationModePill/index.test.ts src/services/workStation/WorkStationViewService.test.ts
```

29 files / 216 tests passed. A subsequently added direct atom-write regression was checked with `node_modules/.bin/vitest run --config config/vitest.config.ts src/modules/StationWindow/useStationWindowNavigation.test.ts` (7 passed).

- `node_modules/.bin/tsgo --noEmit --pretty false` — passed
- `node_modules/.bin/prettier --write <changed TS/TSX files>` — completed
- `node_modules/.bin/eslint --fix --max-warnings 0 --report-unused-disable-directives <changed TS/TSX files>` — passed
- `node_modules/.bin/oxlint -c .oxlintrc.json --max-warnings 0 <changed TS/TSX files>` — passed
- `node scripts/quality/check-test-placement.mjs` — consistent across 576 directories
- `git diff --check` — passed
- Source/AST comparison of changed production controls — no added raw buttons, form primitives, or substitute clickable elements; station selector retains shared Button and pressed-state semantics
- `cargo test -p browser --lib` — 65 passed, 2 existing environment-specific cookie tests ignored; rerun against the final Rust sources before publication
- `cargo clippy -p browser --all-targets -- -D warnings` — passed
- `cargo check -p org2` — passed after linking the existing local sidecar into this checkout; the first attempt stopped at that missing ignored build resource

Full test suite, native UI/E2E, and cross-platform execution were not run. No screenshots were taken; the changes alter ownership and interaction rather than visual styling, and no Computer Use was invoked.

## CI follow-up

CI exposed one new type-aware lint finding and one shortcut-test failure. The main-window Kanban event handler now catches and logs navigation failures instead of discarding a rejecting promise. The native shortcut VM fixture supplies `window.open` and asserts delivery through `orgii-shortcut://`, with no Tauri broadcast even when that API is available. A bridge regression verifies rejection handling and a subsequent retry.

`node_modules/.bin/vitest run --config config/vitest.config.ts src/config/keyboard/nativeShortcutSync.test.ts src/modules/__tests__/useStationWindowBridge.test.ts src/modules/StationWindow src/store/workstation/stationWindowAtoms.test.ts` — 19 passed across 5 files.

The original CI frontend run completed 13,975 passing tests, one skipped test, and only the shortcut fixture failure. The full suite was not rerun locally for this correction; the next GitHub run remains authoritative for the full suite. Typecheck, changed-file ESLint/oxlint, and diff checks were rerun. `NODE_OPTIONS=--max-old-space-size=6144 node scripts/quality/typed-lint/check.mjs` passed: 1,133 existing findings, zero new or increased findings. `node --test scripts/quality/typed-lint/*.test.mjs` passed all 6 tests. The baseline was not changed.

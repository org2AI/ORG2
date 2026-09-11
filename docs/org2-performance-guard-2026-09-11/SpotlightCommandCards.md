# Spotlight command cards performance guard

Production path: `GlobalSpotlightInner` → `SpotlightCommandView` → `SpotlightCardList` → existing `usePickerVirtualization` and `SpotlightItemRow`.

| Area               | Verdict | Evidence                                                                                                         | Change or reason kept                                                                                                                                               | Verification                                                                   |
| ------------------ | ------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Background work    | keep    | Existing keyboard/mouse hook, virtualizer observers, footer portal subscription and atomWithStorage subscription | Mounted-view ownership; no new polling, network requests, timers or scans. Empty cards disable their keyboard listener before delegating to the existing empty list | Source inspection; repeated GUI/TUI switches in DOM tests                      |
| Memory             | keep    | One scalar local-storage preference; memoized rows of three reference item indices                               | Preference has constant size; grouping is bounded by input items and released on unmount                                                                            | Stored preference assertion; 1,000-item render test                            |
| Scope/isolation    | keep    | `orgii-spotlight-command-view` contains only `gui` or `tui`; unrecognized stored values read as `tui`            | No account/session data; agent launch mode is independent; old versions ignore this additive key                                                                    | Typecheck and source inspection                                                |
| Rendering/hot path | keep    | Existing virtualizer operates over rows of three; original item indices remain authoritative                     | Only viewport plus overscan renders; headers span all three columns                                                                                                 | DOM test checks fewer than 60 cards for 1,000 inputs and reveals selection 900 |

Lifecycle matrix: active view mounts listeners/observers; view switches and close unmount them; hidden/idle creates no polling; focus return requires no data refresh. Network, auth, provider, transport and multi-machine data transitions are unaffected. Preference survives close/restart through local storage; deleting the key restores TUI. No schema or dependency changes.

Automated verification: 9 tests passed; full frontend typecheck, scoped lint, and diff whitespace check passed. Verified on the isolated PR branch from the latest develop: three cards per row, 56px height, single-line labels, compact horizontal content, 4px spacing, hidden GUI breadcrumbs, and hover-only disclosure overlays that consume no layout space.

Verification commands:

- `pnpm test src/scaffold/GlobalSpotlight/components/SpotlightCommandView.test.ts src/scaffold/GlobalSpotlight/components/SpotlightItemRow.test.ts`
- `pnpm typecheck:fast`
- Scoped `pnpm exec eslint` over the eight changed TypeScript files
- `git diff --check`

Performance verdict: blocked for real-app CPU/RSS and visible/hidden/post-close measurement. Computer control requires explicit user opt-in and was not used. Automated bounds checks and source review do not establish measured runtime performance.

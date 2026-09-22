# Spotlight pinning performance guard

| Area               | Verdict | Evidence                                                                                                        | Change or reason kept                                                                                      | Verification                                               |
| ------------------ | ------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Background work    | keep    | No polling, network, filesystem scans, workers or timers added                                                  | Uses Jotai's existing storage subscription lifecycle                                                       | Fresh-store/remount test; source inspection                |
| Memory             | keep    | Stores only unique IDs, at most 200 per palette through the producing toggle boundary                           | At capacity, new pin controls are disabled; unpin remains available; no automatic eviction of user choices | Limit/unpin regression test                                |
| Scope/isolation    | keep    | Separate local storage keys for main commands and directories; resolves IDs against currently available rows    | No remote payloads or action closures persisted; unavailable/search-excluded rows do not render            | Missing-row/search test and independent-store remount test |
| Rendering/hot path | keep    | Memoized projection depends on items, IDs and translation; per-projection Set/Map bounded by supplied rows/pins | Existing virtualized list and headers retained; pinning does not select/execute the row                    | Grouping/deduplication and rendered click tests            |

Lifecycle: pin changes are explicit user writes; idle/hidden/offline adds no work. Closing unsubscribes via Jotai/React. Reopening restores IDs; search resolves only live matching rows. Removed or currently unavailable IDs retain a bounded preference and render nothing until available again. Account/org changes use the same local UI preference IDs with current source availability; no new account data is fetched or cached. No transport/provider/backend changes.

Verification commands (27 focused tests, ESLint, typecheck and diff whitespace validation passed on the isolated PR branch):

- `pnpm test -- src/scaffold/GlobalSpotlight/pinning src/scaffold/GlobalSpotlight/components/SpotlightItemRow.test.ts src/scaffold/GlobalSpotlight/hooks/features/__tests__/recentSpotlightActions.test.ts src/scaffold/GlobalSpotlight/palettes/WorkingDirectoryPalette/workingDirectoryPaletteItems.test.ts`
- `pnpm exec eslint src/store/ui/spotlightPinsAtom.ts src/scaffold/GlobalSpotlight/pinning/*.ts src/scaffold/GlobalSpotlight/shared/types.ts src/scaffold/GlobalSpotlight/hooks/features/spotlightItemBuilders.ts src/scaffold/GlobalSpotlight/hooks/features/useSpotlightItems.ts src/scaffold/GlobalSpotlight/palettes/WorkingDirectoryPalette/index.tsx src/scaffold/GlobalSpotlight/components/SpotlightItemRow.tsx src/scaffold/GlobalSpotlight/components/SpotlightItemRow.test.ts`
- `pnpm typecheck:fast`: passed on the isolated PR branch based on latest develop.
- `git diff --check`

Performance verdict: blocked for full runtime sign-off. Real Tauri visible/hidden idle CPU/RSS and visual interaction measurements were not run because computer control was not authorized. No runtime performance improvement is claimed.

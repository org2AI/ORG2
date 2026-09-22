# Sidebar scroll extent fix

The source-control sidebar renders through `VirtualizedStickyTree` and the shared
`VirtualList`. The latter memoized its spacer height on the stable virtualizer
instance, so row removal retained the old scroll extent. This is a presentation
defect; persisted Git data and its writers are unaffected. No historical data
cleanup is needed.

The spacer now reads the virtualizer's current total size every render. Shared
sidebar trees also receive a fixed 60 px footer inside their scroller.

| Area               | Verdict | Evidence                                                                   | Change or reason kept                              | Verification                                 |
| ------------------ | ------- | -------------------------------------------------------------------------- | -------------------------------------------------- | -------------------------------------------- |
| Background work    | keep    | Existing virtualizer and tree scroll handler own observation and scrolling | No new timers, listeners, or I/O                   | Source inspection                            |
| Memory             | fix     | Spacer memo retained a stale height                                        | Derive the current scalar extent during render     | Regression covers 1,000 → 145 → 200 → 0 rows |
| Scope/isolation    | keep    | Extent belongs to each mounted list                                        | No shared mutable state introduced                 | Source inspection                            |
| Rendering/hot path | fix     | Stable virtualizer identity did not invalidate the memo                    | Read current total size; retain windowed rendering | Existing bounded-row and overscan tests pass |

Lifecycle scope: mount, list growth/shrinkage, empty state, and unmount are covered
by unit tests. Idle/hidden behavior gains no scheduled work. Network, identity,
sync, and multi-instance ownership are unchanged. No runtime speedup is claimed.

Verification:

- Regression failed before the fix: shrinking to 145 rows retained 10,000 px
  instead of 1,450 px.
- `pnpm test src/components/VirtualList/index.test.ts src/components/VirtualizedStickyTree`
  — 2 files, 10 tests passed.
- `pnpm exec eslint src/components/VirtualList/index.tsx src/components/VirtualList/index.test.ts src/components/VirtualizedStickyTree/index.tsx`
  — passed.
- `pnpm typecheck:fast` — passed.
- `git diff --check` — passed.
- Desktop visual verification was not run because computer control is opt-in.

Performance verdict: pass for the changed render-time calculation and bounded
rendering behavior. Real-app visual scroll geometry remains unverified.

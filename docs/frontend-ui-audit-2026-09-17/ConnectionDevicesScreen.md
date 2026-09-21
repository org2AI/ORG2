# ConnectionDevicesScreen UI audit

| Line                              | Element                       | Verdict          | Reason                                                                                                                                                                                                                            | Suggested change |
| --------------------------------- | ----------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `ConnectionDevicesScreen.tsx:79`  | Device groups and cards       | keep with reason | Semantic headings wrap shared SectionContainer/SectionRow; local spacing removes compounded title-wrapper margins without changing shared components                                                                              | None             |
| `ConnectionDevicesScreen.tsx:133` | Desktop identity and presence | keep with reason | Single-line name and details truncate independently; current marker and status align in two rows; full names remain in DOM and title; presence still comes from the existing authoritative projection                             | None             |
| `ConnectionDevicesScreen.tsx:187` | Switch and add actions        | keep with reason | Both use shared Button; compound switch row needs custom layout for identity/status and the full-row hit target; shared loading, disabled, busy and accessible-name semantics remain; add action uses standard ghost presentation | None             |
| `mobileConnections.scss:3`        | Page presentation             | keep with reason | Background, text, badge, focus, type and spacing use theme/mobile tokens; add target is at least 44px; switch row at least 56px; no new raw React buttons or substitute clickable elements                                        | None             |

| `sessionViewMenu.scss:5` | Compact grouping panel | keep with reason | Existing adaptive-menu/compact-menu mixins retain portal and keyboard behavior; local token-backed overrides avoid a global density change | None |
| `sessionViewMenu.scss:43` | Grouping options | keep with reason | Shared Dropdown owns option/checkmark semantics; local text/icon tokens keep selected labels neutral | None |

Verdict totals: **0 fix**, **6 keep with reason**, **0 abstract**.

## Verification

- `pnpm exec vitest run --config config/vitest.config.ts src/modules/MobileRemote/screens/devices/ConnectionDevicesScreen.test.ts`: 7 passed; covers empty inventory, unknown presence, switching, pending lock, failure/retry and active selection changes
- `pnpm exec eslint src/modules/MobileRemote/screens/devices/ConnectionDevicesScreen.tsx src/modules/MobileRemote/screens/devices/ConnectionDevicesScreen.test.ts --max-warnings 0`: passed
- `pnpm exec tsgo --noEmit --pretty false`: passed
- Inspected the real iPhone 17 Pro simulator app after HMR in light mode: compact groups, long desktop hostname, aligned current marker/status, integrated add action; no clipping or overflow observed
- Reviewed production JSX: actions use Button; current device row is noninteractive, with no click handler or button role
- Dark mode, very large accessibility text and a real multi-desktop switch were not manually exercised; existing behavior tests cover switching outcomes, and all surfaces inherit existing theme tokens

## Scope

Presentation-only change. No new polling, subscriptions, caches, persistence or pairing/permission behavior. Existing asynchronous switch handler and domain presence projection are preserved. Prior unrelated lifecycle work in this worktree is outside this audit.

## Isolated PR validation after rebase

See [`MobileCompactNavigationBatch.md`](../verification-2026-09-18/MobileCompactNavigationBatch.md) for the current branch results and remaining runtime/visual gaps. Earlier counts and simulator notes above describe the original integrated worktree.

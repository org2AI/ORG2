# SessionsScreen UI audit

Scope: user-requested removal of the mobile pending-inbox entry and its secondary list, including its unused English/Chinese translations. The user explicitly requested removing this surface; this is not a filter for malformed upstream data. The pending-snapshot loading failure is not fixed by this change.

| Line                       | Element                            | Verdict          | Reason                                                                                                                                                                                                                                                                      | Suggested change |
| -------------------------- | ---------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `SessionsScreen.tsx:238`   | Page header and view menu          | keep with reason | Existing shared MobileTopBar and SessionViewMenu remain; the deleted secondary page no longer changes the title or adds a return control.                                                                                                                                   | None             |
| `SessionsScreen.tsx:436`   | Search launcher and search actions | keep with reason | Existing shared Button and Input retain token-based mobile geometry, accessible names, Escape/cancel handling, and focus restoration. Source inspection found no raw buttons, native button creation, or substitute clickable elements in the changed production component. | None             |
| `mobileDiscovery.scss:236` | Session-row interaction styles     | keep with reason | Removed inbox/card selectors while retaining the same focus, touch, and pressed styles for session rows. Deleted component and dedicated styles have no remaining production references.                                                                                    | None             |

Verdict totals: **0 fix**, **3 keep with reason**, **0 abstract**.

## Behavior and ownership

The component-local view state is now `all | search`. Search opens from the launcher; Escape, cancel, and desktop switching return to `all`. Search scroll and focus behavior are retained. There is no pending-list navigation in syncing, ready, empty, error, unsupported, or offline states.

Permission requests still originate in the desktop interaction service, enter the connection-scoped pending-snapshot owner, and reconcile the existing permission queue. Session rows still derive approval indicators from that snapshot. Conversation permission handling, RPCs, persistence, and identity scope are unchanged. No stored records were removed or migrated.

## Lifecycle and performance review

Applied `build-features-end-to-end` and `org2-performance-guard` to the changed surface.

| Area               | Verdict | Evidence                                                                                                                                 | Change or reason kept                                    | Verification                                                  |
| ------------------ | ------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------- |
| Background work    | keep    | Read-state watch remains gated by active/visible and cleared on unmount; search debounce and connection pending-snapshot owner unchanged | Remove only the unreachable pending-view condition       | Rendered hidden-list push regression and existing owner tests |
| Memory             | keep    | Local state now has two views; no new caches, buffers, or retained data                                                                  | Removed pending view/ref and list component              | Source diff review                                            |
| Scope/isolation    | keep    | Existing connection-scoped permissions owner unchanged                                                                                   | Required by session indicators and conversation approval | Existing permission reconciliation and pending-snapshot tests |
| Rendering/hot path | keep    | Existing row projection and search remain                                                                                                | No new polling, subscriptions, or async work             | SessionsScreen rendered regression suites                     |

Performance verdict: pass for the removed UI surface: the existing active/visible watch gate, unmount cleanup, and approval-state tests pass in the isolated branch. No comparative CPU/RAM improvement is claimed; network, provider ingestion, multi-instance behavior, and account persistence were not changed.

## Verification

Executed on the isolated branch based on develop `58898f47d`:

- Seven targeted Suites: `SessionsScreen.features.test.ts`, `SessionsScreen.search.test.ts`, `SessionsScreen.redesign.test.ts`, `SessionsScreen.test.ts`, `useMobilePermissions.discovery.test.ts`, `useMobilePendingInbox.test.ts`, and `mobileReadStateSync.test.ts`, using `node_modules/.bin/vitest run --config config/vitest.config.ts --maxWorkers=2`: **58 passed**.
- `node_modules/.bin/eslint src/modules/MobileRemote/screens/SessionsScreen.tsx src/modules/MobileRemote/screens/SessionsScreen.features.test.ts --max-warnings 0`: passed.
- `node scripts/quality/check-test-placement.mjs`: passed across 618 directories.
- `node_modules/.bin/tsgo --noEmit --pretty false`: passed.
- Type-aware ESLint (`--no-eslintrc --no-inline-config --config config/eslint.typed.cjs`) on the same two changed source/test files: passed.
- Prettier check on the two changed TS files and stylesheet: passed.
- TypeScript AST inspection of changed production controls: zero raw buttons, native button creation, or clickable div/span bypasses.
- `git diff --check`: passed.
- `node scripts/quality/i18n-keys/check.mjs`: passed after removing nine newly unused inbox keys from both locales. Retained `inbox.truncated`, which the conversation permission detail still uses. The first CI run caught these leftover keys; the follow-up commit removes them.

Earlier manual verification used the same production removal in the running iPhone 17 Pro / iOS 26.5 simulator: pending entry absent, desktop online, session list and search visible after relaunch. That screenshot contains real session titles and a device name, so it is not published in this PR. A sanitized before/after screenshot and dark-appearance check are not included. No new color or surface treatment is added.

No live permission was submitted or approved during removal; existing queue/reconciliation tests provide regression coverage. The pending snapshot loading failure is not fixed here. There are no schema, API, dependency, or stored-data changes. Reverting this change restores the entry and its secondary list.

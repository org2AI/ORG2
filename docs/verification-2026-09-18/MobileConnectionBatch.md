# MobileConnectionBatch — isolated PR validation

Based on develop `23fdfe996a566f5fd2b3e58b957273f0f5169fde`. This batch excludes the original worktree's turn-timing commit and every unrelated mobile batch. Related files shared with another batch were split by behavior, not copied wholesale.

## Verification run after rebasing and splitting

- `node_modules/.bin/vitest run --config config/vitest.config.ts --maxWorkers=2 src/modules/MobileRemote/MobileRemoteApp.reconnect.test.ts src/modules/MobileRemote/platform/tauri/nativeSocketPreparation.test.ts src/modules/MobileRemote/components/MobileConnectionNotice.test.ts src/modules/MobileRemote/app/MobileRemoteProviders.test.ts src/modules/MobileRemote/connection/mobileRpcClient.test.ts src/modules/MobileRemote/screens/SessionsScreen.features.test.ts src/modules/MobileRemote/screens/devices/ConnectionDevicesScreen.test.ts`: 7 files, 132 tests passed
- `node_modules/.bin/tsgo --noEmit --pretty false`: passed
- `node_modules/.bin/eslint src/modules/MobileRemote/MobileRemoteApp.reconnect.test.ts src/modules/MobileRemote/MobileRemoteApp.tsx src/modules/MobileRemote/connection/types.ts src/modules/MobileRemote/platform/tauri/nativeSocketPreparation.test.ts src/modules/MobileRemote/platform/tauri/nativeSocketPreparation.ts src/modules/MobileRemote/screens/SessionChatScreen.tsx src/modules/MobileRemote/components/MobileConnectionNotice.test.ts src/modules/MobileRemote/components/MobileConnectionNotice.tsx src/modules/MobileRemote/connection/mobileConnectionFeedback.ts src/modules/MobileRemote/app/MobileRemoteProviders.tsx src/modules/MobileRemote/app/MobileRemoteProviders.test.ts src/modules/MobileRemote/screens/SessionsScreen.tsx src/modules/MobileRemote/connection/mobileRpcClient.ts src/modules/MobileRemote/screens/devices/ConnectionDevicesScreen.tsx --max-warnings 0`: passed
- `node_modules/.bin/prettier --write <this batch's changed files>`: completed; final format check run before commit
- `node scripts/quality/check-test-placement.mjs`: passed
- `git diff --check`: passed
- TypeScript AST inspection of changed production files: no raw button/input/textarea/select, native React createElement control, or clickable div/span was introduced. Actions reuse Button; file tabs reuse the Button-backed TabPillSurface

The accompanying UI/architecture reports contain historical checks from the original integrated worktree. They are not fresh simulator results for this branch. No post-rebase native simulator screenshots, VoiceOver, large accessibility type, physical-device, or paired Desktop/iOS run was performed. Unit/type checks do not establish native visual parity, cold-launch stability, or CPU/RSS improvement. These gaps must remain visible in the PR.

Local Git hooks could not start because `.husky/_/husky.sh` is absent. Commits use a per-command hook override after explicit typecheck, scoped lint, tests, whitespace/test-placement checks and commitlint; no repository hook configuration is changed.

## Producing boundary and lifecycle

Trusted ticket HTTP response → bounded body parsing and timestamp validation → typed local error → provider-owned retry → localized recovery view → initialize success clears the error. The client admits at most 5 seconds above its 60-second upper TTL bound; expired/malformed/account-mismatched grants still fail, and server expiry/single-use enforcement remains authoritative. Local error metadata is not a server wire-format change. Tests cover bad grants, clock skew, abort, retry cause retention, success clearing, pending action coalescing and recovery failure. No historical cleanup or migration. Revert this batch to restore prior admission/feedback behavior.

After rebasing, shared PageNotice includes a copy control. Notice tests now select the reconnect action by its label rather than assuming the first button is reconnect. Production retry semantics were not changed to satisfy the fixture.

Architecture: ten-layer review retained in NativeRelayTicket.md. No new polling/cache/subscription owner. Performance verdict: blocked for fresh native runtime measurements; automated cancellation, stale-account and retry lifecycle coverage passes. No timing or memory improvement claim.

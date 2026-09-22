# Native Relay ticket clock tolerance

## Diagnosis and contract

The real iOS app retained its roster but stayed in `connecting/offline`; Desktop reported its Relay connection as connected. A temporary, credential-free diagnostic showed `Invalid Relay connection ticket`. The HTTP grant had a correctly formatted ticket, matching account/session expiry, and a remaining admission lifetime of **60,236 ms** measured against the phone clock. The client rejected anything above exactly 60,000 ms. This identifies the reconnect failure; the original WebSocket close reason was not retained and is not established by this evidence.

Authoritative input: the trusted Relay's connect-ticket response. Owning boundary: `createNativeSocketPreparation`, before creating a WebSocket. There is no invalid persisted session or roster to clean up. Temporary diagnostics were removed.

The client now allows at most 5,000 ms of clock offset above the existing 60,000 ms admission bound. It still rejects locally expired tickets, malformed values, ticket expiry beyond account expiry, and account expiry beyond the credential used for the request. Relay-side expiry and one-time redemption remain authoritative and unchanged. A larger clock mismatch still fails closed; this is not arbitrary clock correction.

Flow: reconnect → current account session → trusted HTTP ticket request → validate grant → ticket-only WebSocket → initialize → online roster. Network errors continue through the existing retry owner; denied authorization remains terminal; cancellation and account changes discard stale grants.

## Lifecycle review

| Area               | Verdict | Evidence                                                                                       | Change or reason kept                                                         | Verification                                                     |
| ------------------ | ------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Background work    | keep    | Existing reconnect controller owns one timer and one flight; ticket fetch owns a 10 s deadline | No new retry, timer, listener, or polling                                     | Reconnect-controller tests, cancellation and timer cleanup tests |
| Memory             | keep    | Ticket body capped at 4 KiB; no grant cache                                                    | Only component-local retry pending/failure flags; no cache                    | Existing admission tests and source inspection                   |
| Scope/isolation    | keep    | Trusted endpoint, matching user/session, generation cancellation                               | Clock tolerance affects only the maximum admission timestamp                  | Auth-switch cancellation and malformed/overlong grant tests      |
| Rendering/hot path | keep    | One shared notice consumes existing connection state                                           | Cause remains visible during automatic retry; successful initialize clears it | Real simulator recovered online and reloaded sessions            |

## Verification

- `pnpm exec vitest run --config config/vitest.config.ts src/modules/MobileRemote/platform/tauri/nativeSocketPreparation.test.ts src/modules/MobileRemote/connection/remoteReconnectController.test.ts src/modules/MobileRemote/MobileRemoteApp.reconnect.test.ts` — 3 files, 19 tests passed
- `pnpm exec eslint src/modules/MobileRemote/platform/tauri/nativeSocketPreparation.ts src/modules/MobileRemote/platform/tauri/nativeSocketPreparation.test.ts` — passed
- `pnpm exec tsgo --noEmit` — passed
- `pnpm exec vitest run --config config/vitest.config.ts src/modules/MobileRemote/app/MobileRemoteProviders.test.ts src/modules/MobileRemote/auth/MobileAuthGate.test.ts` — 2 files, 115 tests passed
- `git diff --check` — passed
- Live iOS Simulator: after loading the fix, the native app connected to the existing Desktop and populated its roster without re-pairing or restarting Desktop; a subsequent Home → app foreground transition also recovered online

No performance speedup is claimed. No server/protocol/persistence migration is required. An overnight real-device run and the initial disconnect trigger remain unverified.

## Recovery feedback follow-up

The request was extended to explain failures to users. Previously `runReconnect` erased `connection.error` at every attempt and the sessions page rendered the same progress text regardless of the error. The producing boundary now emits a typed ticket error; the common error mapper preserves a local category for ticket validation and authorization. A shared localized notice provides recovery guidance and invokes the existing provider-owned retry. Automatic retries retain the latest failure until initialize succeeds. Terminal authorization errors still stop automatic retries and offer re-pairing.

Source-level regression: invalid HTTP admission payload → typed local error → provider failure → next automatic attempt retains the category → initialize success clears it. Rendered tests cover cause copy, no raw server text, double-click protection, disabled pending action, retry failure, and automatic dismissal. Sessions and device settings share the notice; chat and the terminal error screen share its category-to-copy mapping.

Architecture review covered all ten checklist layers: compilation (tsgo); reachable producer/mapper/render paths; category naming; separation of transport status and failure cause; safe generic fallback; UI copy outside transport; explicit comments for ownership; no wire serialization change (the optional category is local only); common initial/manual/automatic admission path; and common cause mapping across consumers. No Rust/runtime/session resolver changes were needed; no history cleanup or persistence migration applies.

Performance verdict: pass for the bounded validation and feedback change

## Final feedback verification

- Final focused command: `pnpm exec vitest run --config config/vitest.config.ts src/modules/MobileRemote/components/MobileConnectionNotice.test.ts src/modules/MobileRemote/platform/tauri/nativeSocketPreparation.test.ts src/modules/MobileRemote/app/MobileRemoteProviders.test.ts src/modules/MobileRemote/screens/SessionsScreen.test.ts src/modules/MobileRemote/screens/SessionsScreen.redesign.test.ts src/modules/MobileRemote/screens/devices/ConnectionDevicesScreen.test.ts src/modules/MobileRemote/screens/SessionChatScreen.test.ts src/modules/MobileRemote/MobileRemoteApp.reconnect.test.ts src/modules/MobileRemote/screens/ConnectionErrorScreen.test.ts src/modules/MobileRemote/connection/mobileRpcClient.test.ts`
- ESLint for all touched production TypeScript and regression tests, tsgo, and diff whitespace check passed
- Native simulator: light and dark failure feedback verified with a temporary local admission failure; injection removed, light appearance restored, live roster online again and feedback absent
- No new polling/subscriptions. Retry feedback is component-local and guarded against unmount; transport single-flight and generation ownership remain in the provider

## Isolated PR validation after rebase

See [`MobileConnectionBatch.md`](../verification-2026-09-18/MobileConnectionBatch.md) for the current branch results and remaining runtime/visual gaps. Earlier counts and simulator notes above describe the original integrated worktree.

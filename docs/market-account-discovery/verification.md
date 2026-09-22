# Account package discovery verification

## Current behavior

The signed-in desktop account owns buyer package discovery. Opening the package
picker reuses a valid Market grant or establishes one through desktop OAuth and
the existing PKCE HTTPS endpoint. Website Open ORG2 links are optional navigation.
Seller provider authorization and package supply management belong to the website.
Valid historical buyer grants are not filtered by workspace naming conventions.

The catalog and authorization flights are scoped to the Jotai store and official
Cloud owner. Identity changes invalidate pending results, including A → B → A.
Focus reads a shared 30-second cache on demand. Closed pickers do not fetch, and
there is no recurring polling timer.

A picker waits at most 30 seconds. Closing it or reaching that deadline stops the
foreground wait and any queued catalog reread; the underlying one-time authorization
is not cancelled or replayed. Explicit Refresh and authoritative package-change
events invalidate the generation even during a request. Open consumers coalesce
one current read before publishing; multiple consumers of one event invalidate
once. A late result cannot replace a timeout or a new owner's data.

Legacy GoTrue logins remain supported. If their valid saved Market grant is usable,
no upgrade is needed. Otherwise explicit Retry or a website shortcut opens the
normal Cloud PKCE login, then refreshes mounted pickers. Merely mounting a picker
does not open a browser, and a network error does not initiate login.

A definitive HTTP 401 from the trusted Market authority marks the matching native
grant invalid in the credential store. The write holds the existing process lock
and compares the rejected access token, so a late response cannot invalidate a
replacement grant. No token crosses IPC. The catalog may authorize once and reread
using the returned connection metadata. A repeated denial is surfaced; model calls
and financial mutations are never replayed by this recovery path.

Retired seller/callback links remain inert. The unused authorization-saved DOM
event/listener, target parser and unused profile-loader wrapper have been removed.

## Automated verification (2026-09-20 cleanup)

Commands were run on the local cleanup layered over native head `d996528fa22f`:

- `pnpm test src/features/MarketConnect src/modules/MainApp/Settings/sections/HarnessConnections src/scaffold/GlobalSpotlight/palettes/UnifiedModelPalette/__tests__/useUnifiedModelPaletteData.test.ts src/scaffold/GlobalSpotlight/palettes/UnifiedModelPalette/__tests__/useUnifiedModelPaletteItems.test.ts src/features/Org2Cloud/org2CloudClient.refreshLifecycle.test.ts`: 19 files / 162 tests passed.
- `pnpm typecheck:fast`: passed.
- Changed-file `pnpm exec eslint ... --max-warnings 0`: passed.
- `cargo test --manifest-path src-tauri/Cargo.toml -p market-connect --lib -q`: 25 tests passed.
- `cargo clippy --manifest-path src-tauri/Cargo.toml -p market-connect --all-targets -- -D warnings`: passed.
- `git diff --check`: passed.

An isolated tree combining this cleanup with develop `1b89a68131` also passed
`pnpm typecheck:fast` and the same 19-file / 162-test frontend set. This is source
integration verification, not a rebase of the published branch or a native build.

Regression coverage includes invalidation during a pending read, explicit refresh
joining the foreground deadline, open/closed multiple consumers, close/timeout
before a queued reread, same-owner credential refresh, account/endpoint switches,
legacy login recovery, a remotely rejected saved grant, replacement metadata,
repeated rejection, network failure and late rejection after credential replacement.
The native credential comparison tests use injected writes and do not alter the
operator's real keychain.

## Prior native acceptance, not a test of this cleanup

The original session eventually exercised four real paths from the local unsigned
`d996528` macOS bundle: SDE Claude, Claude Code, SDE GPT-6 and Codex CLI. These produced
11 completed requests. Independent price-snapshot, cache-TTL and posting checks
reconciled buyer $1.323648 = seller $0.970676 + platform $0.352972, with no outstanding
reserve. This supersedes the earlier observations that supply was not enrolled.

The Claude rounds used Cloud `c13d2b4`; the GPT/Codex rounds used final Cloud
`91f06398`. Console `c9ed364e` has the same Console sources as `91f06398`. SJC routing
has same-window account placement and machine evidence; receipts do not contain an
immutable per-request node/region stamp.

The cleanup has not been rebuilt and exercised as a new native UI binary. Previous
native success is not evidence of this patch's physical keychain, browser callback
or restart behavior. No published desktop installer is covered. Cross-user
buyer/seller execution, the complete Stripe payment/payout/admin flow and
Windows/Linux runtime acceptance are not claimed.

## Lifecycle and architecture review

| Area               | Verdict | Evidence                                                | Change or reason kept                                                  | Verification                                              |
| ------------------ | ------- | ------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------- |
| Background work    | fix     | Mounted listeners; one bounded foreground wait          | Preserve dirty generation; abort reread continuation on close/deadline | Pending-event, multiple-consumer, close and timeout tests |
| Memory             | keep    | One cache/flight per store; weak event set              | No polling, retained event list or retry queue                         | Cache sharing and cleanup tests; no CPU/RSS claim         |
| Scope/isolation    | fix     | Official owner and native persisted grant own authority | Reject stale identity results; compare rejected token under lock       | A-B-A, endpoint, replacement-grant and recovery tests     |
| Rendering/hot path | keep    | Narrow owner subscription; shared picker projection     | Both model picker and external-app settings use the same loader        | Real React hook and palette tests                         |

Architecture review covered compilation, dead call paths, naming, identity versus
grant ownership, failure defaults, cross-domain ownership, readability, unchanged
IPC schemas, picker/deep-link entrypoint parity and replacement-connection binding.
No public IPC, persisted grant schema or dependency changes are needed. The invalid
record marker is already rejected by older grant decoders and can recover through
the existing PKCE path. No historical data migration or manual keychain deletion is
required.

Performance verdict: correctness tests pass; native runtime measurement remains
unverified. No CPU/RSS, frame-time or physical WebView improvement is claimed.

## UI consistency

ConnectionChoiceCard continues to use the shared Button with custom layout for
multiline selectable cards, token colors and existing pressed/disabled/focus states.
This cleanup adds no visual controls or styling; screenshots of unchanged card
geometry would not verify the changed asynchronous recovery behavior.

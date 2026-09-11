# Mobile managed-session identity and reply correlation

## Ownership and failure

The authoritative execution owner is `code_sessions`, constrained by its current `cli_session_id`, native transcript mode, and `code_session_native_transcript_ids` binding. Imported Codex cache rows are replay mirrors, not interchangeable execution identities. A stale mirror route previously loaded read-only model configuration and subscribed under a different ID.

A separate reproduced failure remained after resolving the owner: a mobile submit created a provisional round keyed by `turnIntentId`, while native Codex replay omitted that ID. The actual reply was persisted, but the provisional round could not reconcile with the native round. This was not fixed by hiding rows or matching titles/timestamps.

The producer now wraps Codex input with a bounded intent field inside the existing stripped IDE-context envelope. Legacy and paginated user-record readers carry that field into the canonical chunk; mobile snapshot projection preserves it. The model/send/subscription/navigation paths resolve the same current owner before mounting chat. Ambiguous, deleted, historical-fork, and unrelated-provider bindings do not redirect.

Historical data is retained. No schema changes, cache deletion, transcript rewriting, or automatic message resend. Previously completed uncorrelated provisional UI state can be cleared by reopening the conversation; the native reply remains intact.

## Lifecycle review

| State | Entry/exit | UI and permitted action | Durable effect |
| --- | --- | --- | --- |
| Resolving | Open route → owner response | Loading; chat actions not mounted | Read only |
| Offline | Connection unavailable → reconnect | Offline reason; no send | None |
| Resolution error | Invalid/ambiguous/failed response → explicit retry | Error plus retry; never fall back to a guessed write target | None |
| Ready | Unique owner or verified unchanged identity | Existing model and composer gates | None |
| Sending/accepted | User submit → execution completion | Existing provisional round and send status | Intent plus native provider user record |
| Reply hydrated | Exact intent echoed in native snapshot | Provisional round reconciles with authoritative reply | Native transcript remains source of truth |
| Superseded/closed | Route/client change or unmount | Old response ignored | No automatic resend/deletion |

| Area | Verdict | Evidence | Change or reason kept | Verification |
| --- | --- | --- | --- | --- |
| Background work | keep | Resolver runs on opening one chat; blocking SQLite work uses `spawn_blocking` | No new timers, polling, workers, subscriptions, or retry loops; explicit retry only | Screen retry and stale-client tests |
| Memory | keep | One local resolution record; IDs capped at 256 bytes; SQL result capped at 2 owners | No app-lifetime identity cache; metadata has constant per-turn size | Bounds and ambiguity tests |
| Scope/isolation | fix | Route/client captured for async resolution | Late results ignored after client/route/unmount; existing write permissions preserved | Read-only and late-response tests |
| Rendering/hot path | fix | Only resolved ID mounts existing chat hooks | Model, send, transcript and navigation share an owner; no global stream subscription added | Canonical action-routing tests |

## Provider/boundary matrix

| Provider | Raw transition | App/UI state | Topology/boundary | Expected invariant | Observed evidence |
| --- | --- | --- | --- | --- | --- |
| Codex paginated | Create then append a second raw user/final-answer turn | Warm catalog after first read | Provider JSONL → chunks → mobile snapshot | New reply contains exact submitted intent; transport metadata hidden | `managed_codex_native_reply_keeps_submit_identity_after_append` passes |
| Codex managed binding | Current owner, historical fork, owner deletion, ambiguity | Stale imported route | SQLite owner resolver | Only unique current owner redirects; no historical mutation | 5 resolver/input-boundary tests pass |
| Codex paginated | Live mobile submit | Open chat in iOS simulator | Relay → managed run → native transcript | Message executes and reply returns to same pending round | Pre-correlation run executed and persisted OK, reproduced missing mobile body; final repaired runtime verification recorded separately below |
| Codex legacy | Metadata parsing branch | Shared leading-envelope parser | Native user-record adapter | Same bounded correlation contract | Shared envelope test; legacy raw end-to-end not run |
| Other providers | Any | Any | Any | No redirect or behavior expansion | Not claimed; negative unrelated-provider resolver case only |
| Codex | Compaction, rotate, forked raw transcript rewrite | Active/pinned/restart | Local and remote | No cross-turn mapping | Not run; current-binding rejection is not raw-transition coverage |

## Compatibility and risks

`sessionIdentity` capability and `session/resolve` are additive. Older desktops retain prior behavior; they do not gain the fix automatically. The context envelope already existed, so older readers can strip the new field even without interpreting it. The field adds a small amount of native transcript/prompt text per managed Codex turn. Existing unmarked native records cannot be retroactively correlated. This is an identity/reply fix, not a guarantee of token-by-token streaming or recovery of every historical provisional row.

No throughput/idle-memory improvement is claimed. The desktop had unrelated background history work during measurements. Visible/hidden idle and post-close resource baselines, isolated second-instance behavior, and raw compaction/rotation were not measured.

## Verification

- Mobile: 107 tests pass across SessionChatScreen, useMobileSessionModel, MobileRemoteProviders, transcriptLoadState.
- Mobile scoped ESLint, full TypeScript check, scoped `git diff --check`: pass.
- Earlier full validation recorded all 48 mobile adapter tests passing. Post-rebase scoped verification passed 5 identity/input-boundary tests, the runner producing-boundary test, the raw native-append producer-to-snapshot regression, and the bounded correlation-envelope test.
- `cargo build -p org2`: pass, with the existing macOS linker unwind-table size warning; not a warning-free build.
- Runtime: old installed instance was closed; the app lookup by display name had reopened it during inspection, so it was closed again and subsequent inspection used Simulator only. No pairing data was removed.
- Final repair binary built and started through Tauri dev. Before the final post-correlation UI send, Computer Use reported that the Mac was locked and could not be unlocked automatically. Final new-message rendered round-trip is **blocked on manual unlock**, not marked passing. Earlier runtime evidence proved model-menu availability and reproduced the reply-correlation defect; it is not evidence that the final repair is visually verified.

Commands run (repository root unless stated):

```text
# mobile worktree
pnpm test src/modules/MobileRemote/lib/transcriptLoadState.test.ts src/modules/MobileRemote/screens/SessionChatScreen.test.ts src/modules/MobileRemote/app/useMobileSessionModel.test.ts src/modules/MobileRemote/app/MobileRemoteProviders.test.ts
pnpm exec eslint src/modules/MobileRemote/app/useMobileSessionIdentity.ts src/modules/MobileRemote/MobileRemoteApp.tsx src/modules/MobileRemote/screens/SessionChatScreen.tsx src/modules/MobileRemote/screens/SessionChatScreen.test.ts src/modules/MobileRemote/connection/types.ts
pnpm exec tsc --noEmit --pretty false
# desktop src-tauri
cargo test -p org2 --lib session_identity -- --test-threads=1
cargo test -p org2 --lib managed_codex_native_reply_keeps_submit_identity_after_append -- --nocapture
cargo test -p org2 --lib api::mobile_bridge::adapters:: -- --test-threads=1
cargo test -p orgtrack_core turn_correlation -- --test-threads=1
cargo build -p org2
```

Performance verdict: blocked — full visible/hidden/post-close measurements and raw rewrite/rotation matrix are not covered. This is not a performance green verdict from unit tests alone.

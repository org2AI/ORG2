# Channel Inbox native acceptance — 2026-09-24

## Environment

Two isolated macOS Tauri instances used a production frontend integrating ORG2 #2150 (1950bae92b) and #2151 (a96b003b0d) plus the read-state/error fixes in this commit. The native shell was develop 8f13b1b52e. Each instance had its own home, auth, WebKit storage and ports. Three synthetic identities used an isolated PostgreSQL 17 database with actual migrations through 0037, PostgREST 12.2.12 and a loopback reverse proxy. The proxy supplied fixture `/auth/v1/user` responses; JWT authorization and every channel/Inbox RPC ran through real PostgREST and database functions. It supplied no Realtime transport. No production endpoint/schema was changed.

GUI actions used native accessibility controls through CUA. Endpoint/auth fixtures were installed while the apps were stopped, with backups. Sending, member selection, navigation, read/unread, refresh, and restart were exercised in the actual desktop UI. SQL/HTTP readbacks verified persisted data independently.

## Results

| Scenario                               | Result and evidence                                                                                                                                                                                                                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A to B explicit public-channel mention | PASS: A selected B through the mention picker; the stored message contained B's UUID; B refreshed and received one unread item and badge with the exact body                                                                                                                         |
| B to A                                 | PASS: same flow in the reverse direction; A's detail identified B and the exact message                                                                                                                                                                                              |
| Ordinary human channel message         | PASS: stored without recipients; no additional Inbox item for any account                                                                                                                                                                                                            |
| Open source                            | PASS: the shared Open control opened the correct channel with the mentioned message visible; no Agent session was created                                                                                                                                                            |
| Private channel                        | PASS: authorized B received the private body; the control identity had no item and received ORG2_NOT_FOUND when attempting receipt mutation                                                                                                                                          |
| Read/unread and refresh                | Initially FAILED: explicit unread immediately caused another automatic read. After fixing the selection trigger, unread persisted through refresh and the durable receipt was absent                                                                                                 |
| Mark all read                          | PASS: the desktop badge cleared; independent API readback reported zero unread                                                                                                                                                                                                       |
| Concurrent receipt retries             | PASS: eight simultaneous authenticated HTTP read calls returned the original read timestamp without duplicate receipt rows                                                                                                                                                           |
| Private member removal                 | PASS: the production removal RPC revoked B; list and receipt APIs excluded/denied the private item; refreshing B removed both its row and currently open detail                                                                                                                      |
| Native restart                         | PASS: recipient restarted with persisted read state, and subsequent restarts retained the revoked-channel exclusion                                                                                                                                                                  |
| Failed write/recovery                  | Initially FAILED: a successful background list reload hid the rejected-write notice. After separating action feedback from hydration, injected HTTP 503 left an explicit error and authoritative read state; removing the fault and retrying preserved unread and cleared the notice |
| Human-only invariant                   | PASS: database held exactly four deliberately sent channel messages and zero cloud sessions throughout acceptance                                                                                                                                                                    |

The SQL migration suite separately covers mixed same-UUID/same-timestamp pagination, legacy endpoints, 105 unloaded rows in mark-all, forged arguments, self-mentions, tombstones, erasure and grants. CI's PostgreSQL 16 migration job passed on backend head 4dc955fa5fd24d65ce622b7b28bebf572416a774.

## Regression evidence

- The new read-action test failed before the selection fix, including repeated writes in StrictMode and after failed-write refresh; all three cases passed after it.
- The new pagination test failed before action-error separation; it now covers subscribed reload, explicit refresh, viewer switch and stale completion isolation.
- `pnpm test src/modules/MainApp/TeamInbox src/features/Org2Cloud/teamInboxMentionsClient.test.ts src/features/Org2Cloud/org2CloudCapabilities.test.ts`: 30 files / 231 tests passed.
- `pnpm typecheck:fast`, changed-file ESLint and production `pnpm build`: passed.

## Follow-up: real Realtime and measured lifecycle

The subsequent [Realtime acceptance](realtime-acceptance.md) supersedes the transport and idle-performance gaps below: real bidirectional push, same-account receipts, outage recovery, hidden/foreground catch-up, automatic ACL eviction and a 1,000-message burst were exercised. Full performance is still blocked by measured retained WebKit allocations and the separate large replay/file workload.

## Original run limits

This is same-machine isolated native acceptance with a real REST/database boundary. It does not prove live Supabase Realtime broadcasts, same-account cross-desktop automatic read synchronization, OS notifications, full hidden/idle performance or physical two-machine behavior. Those remain open; refresh-driven success must not be presented as automatic push success. Auth refresh and hosted OAuth were fixture prerequisites, not test subjects. Source navigation opens the channel rather than scrolling an arbitrarily old transcript to a message ID. The original 164-item provider transcript discrepancy and Luna acceptance are unaffected.

Backend Quality CI remains blocked by pre-existing `services/harness-plane/test/unit/capacity-model.test.ts:281` (`no-regex-spaces`), introduced in #148 and unchanged by #151. No runner fallback or blind rerun was used.

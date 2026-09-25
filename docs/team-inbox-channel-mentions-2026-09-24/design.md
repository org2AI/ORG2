# Channel mention delivery to Team Inbox

## Behavior and ownership

A channel message's `mentioned_user_ids` is the authoritative recipient list. The frontend never searches body text for notification recipients. The previous Inbox RPC only queried session comments; it could not deliver a stored channel mention. The channel composer repair in ORG2 #2150 supplies explicit identities. This follow-up consumes those identities through a capability-gated Inbox API.

The existing Inbox mention category presents both sources, with distinct `session_comment` and `channel_message` targets and source-qualified item IDs. Channel rows display `#channel-name`, the author and the actual message. Opening the shared detail marks it read once per viewer/selection transition; explicit unread survives subsequent snapshot refreshes; the existing Open control opens the corresponding cloud channel. It does not yet scroll an older channel transcript to the specific historical message; the exact mentioned body is available in the Inbox detail.

The existing native notification tracker and badge consume the same coordinator snapshot. No second notification store, body parser, polling loop, or model execution path is introduced. Initial historical rows do not generate notification bursts. Existing persisted explicit channel mentions become queryable when the capability is enabled; no historical body or recipient rewrite is performed.

## Backend contract

Migration `0037_channel_mention_inbox.sql` in ORGII-cloud-infra adds:

- `channelInboxMentions`, preserving all existing capability flags
- `cloud_list_team_inbox_mentions_v2(org, cursor, limit)` with a single descending `(created_at, source_kind, source_id)` cursor across both sources, bounded to 100 rows
- `cloud_set_team_inbox_mention_read_v2(org, source_kind, source_id, read)` and `cloud_mark_all_team_inbox_mentions_read_v2(org)` returning unified unread totals
- A channel mention receipt table protected by RLS with no direct authenticated/anonymous access

All APIs derive the viewer from the JWT. List, count, and receipt validation use one eligibility relation. Channel eligibility requires an explicit recipient, a live message, active org membership, and current channel visibility; self-mentions are excluded. Private-channel membership revocation removes both read and unread notifications. Session comments retain their conversation ACL and retention rules. No message body enters the org-wide invalidation signal.

Profile erasure cascades receipt deletion; channel hard deletion cascades through messages; org soft deletion explicitly removes receipts. No deployment, production schema mutation, or destructive historical cleanup is included in the desktop change.

## Refresh and isolation

The existing `channelMessages` invalidation plane refreshes Inbox content, including remote receipt changes. Its existing reconnect/coarse recovery owns recovery after missed broadcasts. Channel ACL/list revision is part of the coordinator generation: a channel membership change clears stale snapshots and aborts in-flight work before revalidation, even if the next request fails. Unrelated org versions do not change the effective revision. Existing comments/focus recovery also refreshes the unified listing.

The coordinator retains its existing single-flight requests, bounded cache, request cancellation, mutation ordering, and 15-second content-refresh floor. Channel ACL changes bypass that content floor by starting a new scope. There are no new timers or listeners; a signal burst can arm the existing one-shot trailing refresh. Runtime CPU/RAM and native Realtime delivery for the new API have not been measured. Local native REST acceptance is documented below.

## Compatibility and rollout

Land the backend and deploy its additive migration before expecting the feature to work. Deploy the desktop consumer and #2150's explicit channel mention composer. Desktop and backend PRs can land independently: older endpoints keep session-comment Inbox behavior; old clients keep the unchanged legacy RPCs. A client restart re-probes cached endpoint capabilities after a backend upgrade.

Rollback the desktop commit to restore the old consumer. To disable the new capability, restore `get_cloud_capabilities()` to delegate to `channel_inbox_base_capabilities()` without the added flag, then restart clients. Keep the v2 functions and receipts during rollback so in-flight/newer clients remain compatible and receipt data is preserved. Do not drop the table as a routine rollback.

## Architecture review

All ten layers assessed: (1) TypeScript compilation; (2) one coordinator and one backend eligibility relation; (3) source IDs instead of channel values disguised as session IDs; (4) mention presentation category separated from target identity; (5) explicit channel branches and legacy capability fallback; (6) human channels never enter Agent session navigation; (7) rollout and navigation limits documented; (8) source-typed receipts, UUID collisions and cursor wire tests; (9) first page, pagination, read/unread and mark-all all choose the same endpoint capability; (10) title, visibility and target derive from the same authoritative row. Rust/provider parsing is unchanged and not retested by this feature.

## Performance and lifecycle review

| Area               | Verdict | Evidence                                              | Change or reason kept                                               | Verification                                                             |
| ------------------ | ------- | ----------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Background work    | keep    | Shared Inbox coordinator and existing Realtime planes | No new recurring work; existing one-shot content floor and recovery | Burst/unmount tests and message invalidation test                        |
| Memory             | keep    | Existing capped coordinator cache                     | No second retained message list; generation resets on ACL changes   | Existing cache-bound tests and new channel reset test                    |
| Scope/isolation    | fix     | Channel content previously had no Inbox target        | Current ACL enforced in SQL and ACL revision clears client scope    | Authenticated SQL denial tests, hook scope transition, coordinator reset |
| Rendering/hot path | keep    | Existing row, detail, notification tracker and badge  | Channel payload hydrated only for bounded page                      | Mixed-page/receipt tests and rendered component tests                    |

Performance verdict: blocked for complete native performance/Realtime acceptance. Two isolated native instances ran against a loopback PostgREST endpoint with the actual migrations and fixture authentication. That environment intentionally has no Realtime service, so refresh-driven delivery is proven, not automatic broadcast delivery, disconnected catch-up, or OS notification delivery. Visible/hidden CPU/RAM and separate-machine network behavior remain unmeasured. The two fixes retain one selection key and one scoped action error; they introduce no timer, listener, retry loop, or growing cache. This is distinct from the earlier Share Sessions WebKit investigation.

## Verification

- `pnpm test src/modules/MainApp/TeamInbox src/features/Org2Cloud/teamInboxMentionsClient.test.ts src/features/Org2Cloud/org2CloudCapabilities.test.ts`: 30 files, 231 tests passed
- `pnpm typecheck:fast`: passed
- `pnpm exec eslint <changed TypeScript files>`: passed
- Companion backend: fresh local PostgreSQL migrations, repeat migration, production-writer fixtures and authenticated API checks passed; mixed-source same-time/same-ID pagination, 105-row unloaded mark-all, private outsider, revocation, tombstone, erasure, privileges and legacy contract covered
- Existing shared UI geometry and controls are retained. Rendered tests cover the channel-specific subtitle, absence of fictitious thread counts, and the shared Open action. Native screenshot/AX inspection covered empty, unread, read, and failed-write states in the task; no screenshot binary is included in this PR.
- Native and HTTP acceptance: see [acceptance.md](./acceptance.md)

## Native acceptance fixes

The first native run found two issues in the shared Inbox read flow. The receipt table was correct; the desktop produced an unwanted second write when its auto-read effect reran after a manual unread snapshot. Auto-read now follows a viewer-scoped selection transition instead of every snapshot replacement. A rejected write also triggered a successful list refresh that overwrote its error notice. Page hydration and action feedback now have separate state owners; explicit refresh or a successful action clears the notice, and callbacks from an obsolete scope cannot change the new viewer's feedback. Neither issue needs historical data cleanup: users can set unread again, and no message or recipient data was changed.

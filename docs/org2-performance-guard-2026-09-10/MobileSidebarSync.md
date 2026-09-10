# Desktop/mobile sidebar synchronization

## Cause and authoritative boundary

The desktop connector renders the authoritative local/My Sessions projection,
including locally backed pinned rows. The existing
`mobile_remote_sync_sidebar_sessions` command had no production frontend caller.
Consequently `session/list` used its database aggregation fallback instead of the
desktop's scope, resolved labels, and loaded ordering. Those extra history rows
are real stored records, not data to delete or hide by title pattern.

The connector now publishes its final `sessionMenuItems` intersected with its
session map. The existing Rust command validates and atomically replaces the
snapshot, then emits `session/list_changed`. Mobile reads and replaces its roster;
search remains an independent full-history query. No persisted history is edited.

## Lifecycle and limits

- Changes coalesce for 100 ms, with one in-flight IPC and one pending snapshot.
- Identical snapshots produce no new IPC; one failure retry is bounded to 1 second.
  Focus/online or later changes recover after the retry budget is exhausted.
- Refresh within one scope retains successful data. Identity/org changes clear
  the previous projection before replacement; unmount clears the backend snapshot.
- Publishing continues when the desktop is backgrounded: a paired phone needs
  current session state even when the desktop window is not foreground. No polling
  or visibility-triggered scanner is introduced.
- The existing backend contract caps snapshots at 200 rows. Desktop preserves the
  first 200 projected rows; mobile explicitly requests 200 so older backends do
  not silently return only their default 50. Cloud-only team rows and drafts have
  no backing local session and remain outside this local-control contract.
- A newly mounted publisher compares its pending scope with the last completed
  publication, so an old in-flight completion is cleared before replacement.
- Mobile invalidation uses one active read and one trailing refresh flag. Old
  generations cannot overwrite a new connection/reset. Empty snapshots replace
  old data; only explicit pagination appends.

| Area | Verdict | Evidence | Change or reason | Verification |
| --- | --- | --- | --- | --- |
| Producer ownership | fix | Existing command had no production caller | Wire final connector projection to existing command | Hook tests inspect ordered IPC payloads; connector call inspected |
| Idle work | fix | New publisher needs bounded lifecycle | No periodic timer; dedupe, coalescing, one retry | Fake-timer idle and failure tests |
| Retained state | keep with reason | Phone needs a desktop process snapshot | Existing 200-row backend limit; one pending/in-flight snapshot | Projection bound and remount tests |
| Request overlap | fix | Every mobile notification previously launched a read | Single-flight plus trailing invalidation | Provider notification burst tests |
| Scope | fix | Previous rows must not survive org/account owner changes | Serialized clear/replacement, completed-scope check, and generation guards | Scope switch, in-flight remount, unmount, reset tests |
| Runtime performance | unverified | Active app changed during validation | Do not infer CPU/RSS improvement from unit tests | Visible/hidden steady-state sampling not completed |

## Architecture review coverage

Compilation is covered by scoped lint/typecheck results reported at delivery.
Call-chain/dead-code review found and connected the unused production API (layer
2). Naming distinguishes roster from history search (3–4); fallback and empty
snapshot semantics are preserved (5). Local projection policy stays in the
desktop connector, transport remains generic (6–7). Existing wire fields and
200-row limits were inspected with hook payload/consumer fixtures (8). Initial
mount, refresh, reconnect, and unmount are covered separately (9). Row title,
order, status, and workspace use the same canonical projection (10). No protocol
schema, provider ingestion, database migration, or turn-state-machine rewrite is
included.

## Remaining runtime gate

During verification the development Desktop process had exited, while the
installed `/Applications/ORG2.app` instance was running. The simulator showed
reconnecting. The user authorized a restart; the installed instance exited and
the development instance started alone. Its health endpoint returned `ok` and
the workstation accessibility tree loaded the current local session titles.
A subsequent simulator screenshot still showed reconnecting, so runtime paired
list verification and the performance verdict remain **blocked**, not passed.

Earlier validation recorded 7 desktop mounted-hook tests and 69 mobile
list/provider tests passing. In the post-rebase split, 8 desktop hook tests,
targeted ESLint, whitespace checks, and desktop whole-project TypeScript check
all passed. The final rebase added only the develop security baseline files.

No historical remediation is necessary: no user sessions or pairing data were
deleted. Rollback is to remove the connector publisher call and the scoped mobile
request coordinator; persisted data and the existing protocol remain unchanged.

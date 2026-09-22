# Session-memory commit ownership

## Source and root cause

`agent_sessions.sm_content` and `sm_last_seq` are authoritative. Previously the extraction helper published content, sequence, context-token baseline and consumed tool counters before `save_session_memory_state` ran. A failed SQLite update therefore left runtime ahead of durable state. A started `spawn_blocking` write also survived dropping the async task, and an UPDATE matching no session was reported as successful.

Extraction now returns an uncommitted candidate. A generation-owned lease cancels queued publication synchronously when its async owner drops. The blocking commit worker holds the runtime mutex, enters the bounded shared writer, checks cancellation and durable source identity, updates SQLite, then publishes runtime state while still holding both ownership boundaries. A commit that has already passed its cancellation check is allowed to finish and publishes consistently; cancellation is not a rollback of a completed write.

The source snapshot includes summary content/sequence, session creation identity and the latest durable message ID. Appends, truncations and compact-boundary insertion invalidate a prepared result. Missing rows are errors, stale snapshots are skips. Original transcript rows and existing summaries are not rewritten as historical cleanup.

## Lifecycle review

| Area               | Verdict              | Evidence                                                   | Change or reason kept                                                              | Verification                                                 |
| ------------------ | -------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Background work    | fix                  | Started blocking workers survive async cancellation        | Drop invalidates the lease synchronously; writer admission limited to one second   | Aborted-owner and busy-writer tests                          |
| Memory             | keep                 | One candidate and one lease per extraction                 | No global registry, cache, polling or repeated timer                               | Existing coordinator bounds retained                         |
| Scope/isolation    | fix                  | Older generations and history snapshots could publish late | Check runtime generation, summary snapshot, session identity and latest message ID | Replacement, append, compact, truncate and missing-row tests |
| Rendering/hot path | keep with limitation | Runtime mutex is held only for commit, not provider calls  | Same runtime→DB lock order as compaction; writer admission bounded                 | State publication tests; whole-app latency not measured here |

The mutex can still wait for SQLite I/O after writer admission; this is not a foreground-latency or whole-app performance improvement claim. Drop cleanup queues one generation-checked state cleanup task only for interrupted owners. Normal completion cleans up inline. Physical cancellation cannot undo an already-linearized database write; the worker completes runtime publication in that case.

Performance verdict: blocked for whole-app acceptance pending packaged visible/hidden/active/repeated-cycle measurements. The bounded commit lifecycle has unit evidence; this does not close the earlier WebView/aggregate CPU or retained-memory findings.

## Architecture coverage

| Layer            | Verdict / evidence                                                                              |
| ---------------- | ----------------------------------------------------------------------------------------------- |
| 1 Compilation    | Targeted session-memory tests and strict all-target Clippy run; exact final results in PR       |
| 2 Structure      | One candidate producer and one owning commit worker; no alternate summary store                 |
| 3 Types          | Uncommitted extraction is a distinct value; conditional commit returns applied/skipped or error |
| 4 Naming         | Extraction, commit, generation and durable snapshot have separate roles                         |
| 5 Defaults       | Missing session errors; cancelled or stale source skips; failure never advances summary state   |
| 6 Boundaries     | Provider helper produces a candidate; session persistence owns SQLite and publication           |
| 7 Lifecycle      | Owner drop invalidates pending work; old cleanup cannot clear a newer generation                |
| 8 Wire           | No provider request schema, IPC or serialized persistence-format change                         |
| 9 Initialization | Lazy restore unchanged; tests use the production SQLite schema and writer                       |
| 10 Resolution    | Same persisted/runtime summary pair checked before publication; provider policy unchanged       |

## Remaining scope

No schema migration is required; rollback is a code revert. Runtime growth-baseline persistence and compaction rebasing are a separate follow-up. Generic compaction bookkeeping writers retain their existing behavior; this change prevents extraction results based on an older transcript from overwriting them. It does not claim every historical database-failure path is now transactional.

## Reactive compaction review follow-up

Reactive compaction changes only the live request frame. It clears the runtime sequence anchor while leaving the durable sequence intact, because mid-turn history can contain open tool exchanges. A new extraction may therefore begin with two legitimate, different anchor values. Validate the runtime against its own candidate snapshot and the database against its own durable snapshot; do not require equality between the two anchor views. The SQL comparison still rejects a durable change occurring after the snapshot.

The regression invokes the real reactive compaction pipeline, verifies the deliberate runtime/durable anchor difference, then runs the production extraction-and-commit boundary twice. This complements the existing concurrent append/compact/truncate and stale-generation rejection tests.

The one-second budget applies only to admission to the process-local writer lock. Waiting for the runtime state lock, connection acquisition, SQLite locking and I/O are outside that budget; there is no one-second end-to-end latency guarantee.

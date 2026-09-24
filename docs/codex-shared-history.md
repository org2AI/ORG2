# Native Codex history handoff

Market opens Codex with its own `CODEX_HOME` and Electron data directory. This preserves account and routing isolation, but previously gave it a separate conversation catalog. The handoff copies native history between the primary home and the authenticated owner's Market home automatically. It adds no session picker or sync page and does not change either profile's auth or configuration.

Only the user's `RECENT_CONVERSATIONS` (50) most recently updated, unarchived primary conversations start crossing into the package, together with the frozen ancestors their forks need. A conversation that has already crossed keeps syncing both ways even after newer ones push it out of that window, and every conversation the package creates returns to the primary. Older primary history is never copied on its own; continuing it natively makes it recent. The isolated Claude Desktop import uses the same window over Claude Desktop's `lastActivityAt`.

## Supported boundary

The adapter was audited against Codex Desktop **26.915.31945**, bundled Codex **0.155.0-alpha.9.2**, `state_5.sqlite` and `thread_history_1.sqlite`. Compatibility with the release currently installed is decided by the data it writes, not by its version number:

- the schema gate (`store/schema.rs`) requires the audited tables, columns, types, foreign keys, triggers and migration checksums exactly; anything unknown fails closed on every store access;
- the settings-shape gate (`routing::native_shape_gate`, run on every rescan) reads the `thread_settings_applied` events the native app itself wrote into the most recent primary rollouts and requires every field our continuation binding emits to still be present with the same value type and the same payload envelope. Events that carry only our own minimal field set are not samples; with no native sample the schema gate alone applies.

A failed gate pauses the handoff and is shown in Settings with its reason and the Codex Desktop version that was seen. The current local GUI uses the state-only catalog. Generic CLI file-backed provider-filtered listing is not claimed supported.

Native JSONL bytes, immutable rollout IDs, fork byte cutoffs, and all four history projection tables are retained. Continuation gets an appended native settings event for the destination's own provider/model. Existing destination permissions and grouping stay local; newly imported conversations get read-only, on-request permissions. Neither credentials, account settings, plugins, nor native control-plane tables are copied.

The destination writer locks must be available. A loaded source may be read only when all selected turns are terminal (`completed`, `failed` or `interrupted`), the projection frontier exactly matches the raw file, and fresh metadata/checkpoints/file stamps still agree after staging. Otherwise it is deferred. A loaded native conversation can retain its writer lock after its turn ends. The audited GUI normally unloads inactive owners only after its own inactivity policy (up to three hours, with earlier eviction above ten inactive owners), not immediately when selecting another conversation. The handoff therefore does **not** promise live refresh of a conversation still loaded in the destination native process. Never bypass this lock to make a GUI test appear to pass. Actual native unload or process exit releases the boundary.

ORG2 app-server producers may keep authentication in an account-scoped `CODEX_HOME` while writing a different `sqlite_home`. Native thread locks follow the former, so those producers additionally hold a shared `.org2-native-writer.lock` in the actual store before spawning. The child inherits the locked descriptor; the engine holds that store fence exclusively for target publication and pending recovery, alongside the native thread locks. Existing account lock directories are neither moved nor linked. Multiple producers can share a store, but writeback into any thread in that store waits until its producers finish. Terminal source snapshots still flow outward; an older failed or interrupted turn does not make a fully projected history incomplete. Unknown statuses and active turns remain fenced.

Producer teardown closes the parent's descriptor and uses a distinct descriptor for the same inode to confirm exclusive availability before changing the fence timestamp. Cancellation can drop the parent before its child closes; only that release event starts bounded asynchronous checks (100 ms, at most ten seconds) on the existing Tokio runtime. The existing observer then reselects the latest revisions. If the parent crashes while its child remains alive, the inherited descriptor preserves data safety; after an orphan's exit outside the cleanup bound, without an available runtime, or after runtime shutdown, reconciliation may wait for the next native event or explicit invalidation. This does not add an idle polling timer. Processes started by an older build need to finish before the new producer fence can protect their stores.

## Reading the current generation

The native SQLite `threads.rollout_path` is authoritative for an indexed Codex
store. Managed transcript reads, revision checks and follow-up turns resolve that
row again instead of retaining a path merely because its old file still exists.
A retained rollout generation may carry the same canonical thread ID while no
longer being the current conversation. An invalid or unreadable indexed binding
is reported as an error; it must not silently select a stale imported cache or
an account-profile copy. Stores without an index retain bounded legacy discovery,
which rejects ambiguous matching files.

No native schema or history migration is required. Old retained generations and
backups remain intact; deleting them is unnecessary and would discard recovery
material. This correction addresses a real C7 finding where a successful reply
reached both current stores but ORG2 reread the previous physical generation.

## Status

Settings → App connections → Codex shows the observer state under the connection: active with the number of shared conversations (and how many need attention), idle while the profile is not the managed connection, or paused with the gate reason. The state comes from the last observer outcome and is never polled.

## Lifecycle and resource limits

- One owner-scoped observer and a shared serial queue for native history operations; logout/owner replacement cancels work and fences publication.
- Native history/configuration/writer-lock events drive work. A 750 ms event-coalescing delay and the authentication expiry deadline do not create a periodic scan.
- Startup/rescan checks files. Ordinary SQLite events compare catalog metadata first; unchanged known rollouts are not repeatedly inspected. Raw event IDs resolve both stable thread IDs and immutable IDs after revert.
- At most 128 queued file IDs and 16 completed copies per batch. Progress schedules another batch; busy/dependency states alone do not schedule retry loops.
- Rollouts are staged as APFS clones truncated to the inspected source length, so a multi-gigabyte history shares blocks with the source instead of being duplicated (the 18 GB primary on the reference machine consumed about 0.7 GB, mostly projection rows). Filesystems without cloning fall back to a 1 MiB buffered copy with cancellation checks. Head/tail parsing is bounded; fork comparisons stream their frozen prefixes.
- Bounds include 10,000 catalog threads, 30,000 inventory entries, 64 ancestors, 64 MiB metadata and 256 MiB / 500,000 projection rows per prepared snapshot. Unsupported/compressed or oversized inputs remain untouched.
- The primary profile is never initialized or probed with a native process. Its route is read from `config.toml` only; without an explicit `model` there, conversations still flow into the package and the return direction waits (reported as busy, not as a conflict) until one is configured.
- The package default model is resolved once per configuration fingerprint. An empty package history store is initialized through a private disposable native thread without starting a model turn, then that owned thread is deleted. Auth/configuration are preserved. A failed bootstrap is remembered for that fingerprint and retried only on configuration change or an explicit Open, never by native events.
- The observer subscribes to the user's native home only while this profile is the managed Market connection. Restoring the original setup drops the subscription; ordinary rollout appends do not re-check the managed state, only configuration/catalog metadata events and explicit reconfiguration do. Transient lock contention restores the pending invalidation instead of dropping it.

## Recovery and conflicts

Each thread has an independent pending journal. A private, immutable SQLite snapshot contains only that thread's metadata and selected lineage projections. Destination writer locks remain held from prepare through publication. Available source locks are held too; a loaded source instead requires the strict terminal-snapshot checks described above. Files are staged privately, fsynced, journaled, then published; replaced target rollouts are backed up outside native discovery. Directory entries are flushed before the journal can depend on them.

Recovery uses the saved snapshot rather than rereading a source that may have continued, moved or disappeared. It recognizes its own already-published inode after rename, revalidates skipped ancestors and destination configuration, and can replay SQL publication before committing the new baseline. When the native app opened the conversation between the rename and the SQL step, it projected exactly the file we placed and rewrote the row's own metadata; recovery accepts that (every placed file is still our published copy and the native projection frontier sits at its end), keeps the native projection and only binds the route. A newer native append is preserved; an obsolete unpublished selection is cancelled and the latest revisions are reselected instead of overwriting newer target data. Snapshot cleanup follows the committed journal; other threads continue.

The adapter selects complete native revisions by last-write order; it does not merge individual messages or fields. Equal clocks with different data select the primary deterministically, and mtime changes without data changes do not create new revisions. Previously shared deleted data is not resurrected. Changed destination configuration or frozen dependencies preserve the originals and pending recovery material. Operator recovery must inspect the specific journal and backup; do not delete a pending journal or restore a whole profile over newer native work.

## User-message correlation

New ORG2 Codex turns carry their durable intent in the native app-server
`turn/start.clientUserMessageId` field, namespaced as `orgii-turn-intent:<id>`.
The user input stays literal. Native history persists this as `client_id` and
returns it as `userMessage.clientId` after reopening; ORG2 consumes it at both
current `item_completed/UserMessage` and legacy `user_message` ingestion
boundaries. Fresh, resumed and context-recovery turn starts share this writer.

Historical leading `<ide_context>` correlation envelopes remain readable, but
are no longer produced. Native metadata takes precedence; malformed IDs in our
namespace are rejected rather than silently borrowing an old body identity.
Unrelated native client IDs are not interpreted as ORG2 intent IDs. Existing
raw histories are not rewritten: old envelopes can still be visible in native
Codex until separately authorized historical remediation. No database migration,
sidecar, timer or additional history scan is introduced.

## Architecture audit

The reviewed path is Cloud owner/configure → automatic observer or Open → native initialization → shared reconciliation engine → native rollout/catalog/projection. Background and explicit-open paths use the same engine and owner fence. Native schema/route handling belongs to the lower history adapter; Market owns identity and lifecycle; the existing app-server transport owns native bootstrap. No frontend state, route token, periodic API call, or manual session choice is a source of truth.

The audit covers compilation, dead/duplicate paths, naming, defaults, dependency direction, ownership and cancellation, persistence/wire format, cold-start parity and resolver symmetry. Historical formats are explicit vendor representations, not synthetic compatibility aliases. The existing connection description is updated in all locales to describe automatic history and the native restart limitation; no UI layout or controls are changed.

## Verification contract

Unit and native app-server checks are separate from GUI acceptance. The reproducible native driver uses disposable homes and a loopback model endpoint; its requests are not production SJC acceptance.

```sh
cargo test --manifest-path src-tauri/Cargo.toml -p agent_cli --lib --no-default-features
cargo clippy --manifest-path src-tauri/Cargo.toml -p agent_cli --lib --tests -- -D warnings
cargo build --manifest-path src-tauri/Cargo.toml -p agent_cli --example codex_history_probe
python3 src-tauri/crates/agent-cli/examples/codex_history_native_probe.py --engine src-tauri/target/debug/examples/codex_history_probe --live-writers
python3 src-tauri/crates/agent-cli/examples/codex_history_native_probe.py --engine src-tauri/target/debug/examples/codex_history_probe --fork
python3 src-tauri/crates/agent-cli/examples/codex_history_native_probe.py --engine src-tauri/target/debug/examples/codex_history_probe --cold-target
```

The native matrix checks bidirectional list/search/continuation, restart, repeat no-op, frozen fork prefixes, and writer contention. Producing-boundary fixtures cover realtime/tool/compaction payload retention, rename/SQL/journal interruptions, source advancement during recovery, target/configuration divergence, missing ancestors, archive/unarchive, revert, and cancellation during large copying.

Required desktop acceptance remains: visible history in the actual managed Codex window, continuation and reverse handoff after native unload, restart with unchanged connection settings, and observer CPU/RSS/I/O while idle, generating, and stopped. Until those checks run, report them as pending rather than calling app-server probes GUI acceptance.

Recorded results for this checkout are in [codex-shared-history-evidence.json](codex-shared-history-evidence.json). The full `agent_cli` suite passed 159 tests, including 36 history regressions. The bootstrap helper passed four unit tests and five native scenarios with no model calls. Three native engine scenarios passed with 14 loopback requests and 13 clean native process exits. Full application `cargo check` passed. GUI and observer resource measurements remain pending.

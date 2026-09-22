# Automatic Claude history handoff

ORG2 automatically reconciles compatible Code conversations between the primary Claude Desktop profile and the managed package profile. There is no session-sync page, status section, selector or manual sync action. Keep ORG2 running, quit Claude Desktop and Claude Code, and allow synchronization to finish before reopening Claude.

Compatible user/assistant payloads and completed tool results retain their message UUIDs. Parent references may be redirected across validated, omitted runtime records. The source environment, project instructions, runtime tool definitions, permissions, account configuration and credentials are not transferred. This is conversation reconciliation, not a lossless execution-environment copy.

## Native ownership and triggers

The native service derives roots from the verified Cloud owner and managed profile. Auth verification/restoration and applying a profile start or wake it; the managed Open action awaits a safe reconciliation pass. Owner invalidation, profile restoration/removal and application shutdown stop its resources. Lease expiry ends write authority and releases its resources before requesting one bounded refresh through canonical authentication. A valid refresh updates its deadline without requesting another history scan. Main-window focus/online recovery also covers sleep crossing expiry; account generations invalidate late recovery, and failures do not schedule periodic retries.

One service per owner owns a filesystem watcher, a bounded dirty set and at most one process-exit waiter. Filesystem callbacks only mark UUIDs or catalog state dirty and wake the coordinator. Overflow/rescan invalidations request a bounded recovery pass. Configuration-manifest changes revalidate the managed profile. Blocking inspection and filesystem work run outside the async executor. Reconciliation is serialized, including the managed Open entry point.

All Claude Desktop and Claude Code writers must be closed. A bounded same-user kernel snapshot identifies writers; kqueue waits for identified processes to exit. Registration checks process identity again to detect exit/PID replacement. Exit callbacks invalidate the snapshot rather than granting write permission. The waiter publishes completion before waking the coordinator, preventing an early wake from being lost. File events while waiting accumulate dirty work without repeatedly creating threads. Cancellation wakes and joins the waiter; its one-second fallback only checks cancellation and never polls processes or initiates synchronization.

The coordinator has no frontend IPC, status event or listener. Opening or closing settings has no effect on synchronization. Internal progress and compatibility failures are diagnostic logs, not a separate user workflow.

## Reconciliation and recovery

- Existing pairs must agree on transcript UUID, Desktop ID, cwd and current account/profile binding. Duplicate or ambiguous catalogs, conflicting continuations and unknown formats fail closed.
- New compatible conversations can be registered in the destination catalog. Registration uses a validated, restricted discovery row with destination-safe controls, not copied account settings or permission grants. A missing/ambiguous destination identity or organization is not guessed.
- Transcript and new catalog publication form a journaled operation. The transcript is prepared before the discoverability row is published; recovery checks recorded identity and hashes. Existing rows or changed files are not blindly overwritten.
- Symlinks, hardlinks, foreign-owned files, rewound/branched records, incomplete tool pairs, pending queues, unsupported thinking payloads and unaudited tools are refused. Queued text must be dequeued and match a retained user message.
- Runtime attachments are omitted only after closed-schema validation. Projection ledgers retain source/target and parent-basis hashes; physical baselines advance independently for repeated and reverse handoffs.
- Transcript replacement keeps a preimage backup and pending journal. Interrupted work is reconsidered automatically on a later safe pass. Changed source/destination state is preserved for inspection instead of silently rolling back.

For manual recovery, first quit all Claude writers and preserve both transcripts plus the profile's `history-handoff` directory. Never restore a backup over a newer continuation without inspecting that history. Removing the feature does not reverse already synchronized conversations; retain unresolved journals.

## Important limits

Official Claude does not honor ORG2's advisory locks. Kernel checks and precommit file checks reduce risk but do not provide OS-enforced exclusion: an independently launched process can race after the final check. Managed Open can order reconciliation before dispatch; a Dock launch cannot be fenced. A running Claude process may retain its own in-memory catalog or conversation. This implementation does not promise live refresh or seamless concurrent editing in both profiles. A normal quit/reopen may be necessary after synchronization.

Support is limited to audited record schemas. `edited_text_file`, unsupported thinking records and unaudited tools are not silently discarded to manufacture success. Large histories can exceed finite limits. The reconciliation path retains bounded pair selection, per-file/output limits, a shared read budget and a cooperative deadline; catalog discovery is also bounded. A limit or unsupported result is an internal unresolved diagnostic, not evidence that every daily session synchronized.

## Evidence and remaining acceptance

The combined acceptance build compiled successfully and passed Clippy with `--lib --tests -- -D warnings`. Handoff fixtures and an independent production macOS kqueue harness verify schema, journal, parent-chain, cancellation and writer-exit behavior. These are separate from native business acceptance.

Actual native acceptance has confirmed that a new package conversation appears automatically in the primary Claude application with the same Desktop/CLI identity. The primary application displayed the prior user/assistant turn and correctly recalled a synthetic token when continuing through its own provider. The settings panel was closed during the handoff; no manual sync action was used. The primary continuation then returned automatically to the package profile; the official Gateway application displayed it and its real package response correctly recalled both the original token and primary-side marker. A second new package conversation also registered exactly once in the primary catalog. Another primary cold launch displayed both test sessions, and the first session showed all six messages including the final package-side answer.

The dedicated sync UI and status IPC have now been removed. The native round trip and removal of the sync surface passed in the combined acceptance build. The final authentication-expiry source passed 90 native Market tests, including expired-owner authority and retiring-task races, plus strict Clippy and the final combined macOS App build. That final build cold-started and loaded the configured Advanced Coding package with no sync section. Normal shutdown removed the previous process; hidden-idle samples were 0.0–0.1% CPU with no remaining history-exit waiter. Independent Dock-launch races, timed lease expiry, crashes and complete resource measurements are not claimed as accepted.

See [architecture and performance matrix](architecture-performance.md) and [UI audit](../frontend-ui-audit-2026-09-21/AppConnectionPage.md).

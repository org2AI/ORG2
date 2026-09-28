# Codex history retention and safe reclamation

Status: design, 2026-09-23. **Automatic physical ancestor reclamation is not implemented.** This document defines its prerequisites; it does not grant permission to delete existing history or turn earlier native checks into GC acceptance.

## Current retention policy

When a publication would replace an existing rollout with non-extension bytes, the history engine creates a new physical UUID. It preserves the old raw file and its projection rows, then updates the stable thread's current rollout pointer. Native frozen children can reference that old physical UUID even though it has no current `threads` row.

Retained generations remain discoverable in `sessions` or `archived_sessions`. Archive, Restore, sign-out, lack of recent activity and a file's age do not authorize deletion. The engine bounds inventory at 30,000 entries and depth four, and refuses a new alias once inventory reaches 4,096 physical rollouts. That is a conservative capacity limit, not a reclaim policy. It can eventually prevent further generation creation.

The existing narrow cleanup in `finish` removes an immutable SQL handoff snapshot only after the durable ledger no longer needs it. It does not reclaim published rollouts or ancestor projections. See [the compatibility guide](../native-history-compatibility.md#native-specific-boundaries) for implemented publication and recovery behavior.

## Native observations and their limits

Experiments with Codex `26.917.62051`, bundled core `0.155.0-alpha.16.3`, established that `thread/fork` and `thread/read` can succeed while the parent writer lock remains held; `thread/resume` refuses that lock. Cold native reads consumed successive physical generations, and old children retained their frozen history. Removing an old generation's projection rows in a disposable experiment made inherited child read/resume return no turns even while its raw file remained. Projection rows are therefore part of the retained history object, not a disposable cache.

The inspected bundled core's API schema also permits `thread/fork` with an explicit rollout `path`, which takes precedence over `threadId`. A new process need not resolve a candidate through the current stable thread row. These observations concern the inspected runtime, not a permanent version allowance or a completed destructive GC test.

The inspected request schema exposed no physical-history GC or prune contract. `thread/delete` accepts a stable thread ID and provides no operation for reclaiming only one superseded physical generation. `fs/remove` is ordinary filesystem deletion. `thread/compact/start` provides no physical ancestor reclamation guarantee; context compaction is not disk GC. Official `thread/revert` itself retains old generations. None is a substitute for a documented reference-safe collector.

## Two unresolved safety prerequisites

### A native-cooperative exclusion boundary

The journal's `sync.lock` coordinates its ORG2 writer. The profile/configuration locks coordinate ORG2 configuration. `WriterLock::acquire` briefly holds `.coordination.lock` while acquiring a per-ID writer lock, then releases the coordination lock. None currently excludes all native lineage readers and creators throughout collection.

A concrete race remains:

1. A collector scans and finds no current reference to physical generation A.
2. A native fork reads A and captures its byte/ordinal cutoff, including through an explicit path.
3. The collector removes A and its projections.
4. The fork publishes a child referencing A and completes its database write.

A zero-process snapshot, repeated reference scan or SQLite `BEGIN IMMEDIATE` does not close that interval. The database lock does not establish an ordering for native raw-file reads and child-head publication. Moving A into a hidden quarantine already breaks native lookup; recoverability alone does not make that move safe online.

Whether holding `.coordination.lock` throughout collection provides a stronger boundary is unproven. Its role in writer-lock file coordination is insufficient evidence. Every path-based fork, loaded-parent fork, read, revert and scan-repair entry point would need to honor the barrier before resolving or publishing a reference, including during recovery.

Preferred solutions are a vendor-owned GC/maintenance contract or an isolated environment whose supervisor controls every process allowed to access the home. The latter must stop existing consumers, prevent new access and retain admission control across collector crashes. Blocking only ORG2's Open action or asking the user to close the GUI does not provide that property for a shared primary home.

### Durable artifact ownership

`Pending.rollout_alias` records a generation while publication is pending. Successful publication removes that pending entry and leaves only the current `Pair` versions. The ledger has no completed-generation ownership registry.

A UUID filename, filesystem owner, non-current catalog path or differing stable/physical IDs does not prove ORG2 created a file. A future collector must not adopt existing native generations from those heuristics.

For new files, persist a creation receipt with the publication intent before native visibility. It must bind the profile/home identity, operation ID, stable and physical IDs, relative destination, staged file identity and full content digest. Transfer the receipt into a completed ownership record when publication commits. Existing pending operations may migrate only from verifiable recorded evidence; older generations without such evidence remain unmanaged.

Ownership is necessary but insufficient. Native code may append unique user content after ORG2 creates a file. Eligibility also requires a sealed generation, unchanged identity/content since sealing, a committed successor and proof that reclamation loses no unique conversation data. A digest or absence from `threads` alone does not prove content preservation. Mutation or uncertainty revokes eligibility.

## Required acceptance before implementation can reclaim

- Native races: path-based and loaded-parent forks arriving before, during and after the barrier; new process admission; archive, revert and scan-repair.
- References: current and archived roots, unregistered heads, shared-home journals, multilevel frozen children, duplicate/unknown/oversized records and native-mutated owned files.
- Recovery: interruption at every state transition, separate file/SQL completion, repeated recovery and no native reopen before recovery finishes.
- Native consumption: cold indexed parent/child read and resume retain every expected message and projection after collection. GUI Configure/Open and visible continuation remain separate acceptance cells.
- Resources: bounded active work, no idle/hidden scans, cancellation, repeated maintenance and unchanged no-op behavior.

Run destructive cases only in disposable native homes. A design review, successful copy, prior GUI run or lack of observed corruption does not satisfy this matrix. Until exclusion, ownership and recovery are implemented and accepted, preserve physical ancestors and their projections.

# Package source switch: snapshot before native child creation

## Failure and source invariant

The private f1f40ad55 desktop artifact completed two Claude Code calls. Switching the same conversation to another Package created `cliagent-1789657228377-ee35ddf83ae148908527eaad45a7b3dd`, then failed before dispatch. The frontend log at local 2026-09-17 08:00:28.492 reports `QueuedConversationRecoveryPendingError: provider-native conversation changed while its canonical timeline was being read`. Read-only SQLite inspection found pending status, no native transcript binding, no turn intent and zero chunks. The prior source session was completed with two completed turn intents. The source selections differed. This is a local preparation failure; it does not establish a provider or settlement failure.

The canonical child catalog is authoritative. The no-compatible-runtime path previously created a native child before reading its source timeline. That child immediately entered the catalog with a null native revision, making its own canonical snapshot unstable on every attempt. Its already-published runner receipt retained the queue recovery state.

The fix takes the consistent source snapshot before creating a fresh execution, while the singleton durable queue holds its existing root lock. The new child cannot contaminate that snapshot. Native materialization, source identity checks, owner authorization, round-trip validation and provider dispatch retain their existing order after creation. Other creation paths already receive frozen timelines. Missing or changing native history still fails closed; no child is globally ignored and null revisions are not treated as empty history.

## Timing, lifecycle and limits

The tradeoff is later publication of the native pending row for large histories. The durable delivery already exists in `preparing` state. `withCanonicalConversationTurnLock` holds its Web Lock across the complete awaited execution; it has no lease timeout. No concrete `prepareUserIntent` starts during the snapshot, so its 60-second dispatch dead-man is not armed. After creation, `confirmUserIntentPreparation` still promotes the generation before native materialization. No timer, cache, background scan or subscription is added.

The snapshot-order fix alone did not repair an already-created empty child. The follow-up below makes normal Retry possible only after an authoritative native proof of an unstarted empty child. No live database or history is edited or deleted; GUI acceptance of the recovery artifact remains separate from source tests.

## Verification

- Continuation, canonical snapshot and ConversationContinuation regressions: 4 files, 108 tests passed.
- The new regression uses the real canonical snapshot loader and the native catalog boundary: a created child is immediately visible but its native revision stays null until materialization. While a deferred snapshot is pending, no child or provider send exists. A successful snapshot carries the original history and the newly selected Package into exactly one created execution and one dispatch.
- Failed snapshots now assert no created child, lifecycle mutation or provider send. Existing source propagation tests fail at materialization after creation so they still exercise the actual source write boundary.
- Full `tsgo --noEmit --pretty false`, changed-file ESLint and `git diff --check` passed.
- Independent source review approved the change. New-source GUI switch/restart and resource measurements remain pending; earlier f1 runtime evidence does not validate this source.

## Architecture review

| Layer                     | Verdict   | Evidence                                                                        |
| ------------------------- | --------- | ------------------------------------------------------------------------------- |
| 1 Compilation             | pass      | Full TypeScript check and changed-file lint                                     |
| 2 Ownership/deduplication | fix       | Root queue still owns one execution; snapshot precedes publication              |
| 3 Naming                  | keep      | Existing snapshot/child terminology; creation comment corrected                 |
| 4 Domain semantics        | keep      | Preparing child is not provider acceptance or durable history                   |
| 5 Defaults                | keep      | Null/unstable native revisions still fail closed                                |
| 6 Boundaries              | fix       | Source read completes before the native catalog write                           |
| 7 Discoverability         | fix       | Comment records the concrete self-contamination hazard                          |
| 8 Wire protocol           | unchanged | No RPC/schema changes                                                           |
| 9 Init parity             | unchanged | No startup or instance-path changes                                             |
| 10 Resolver symmetry      | keep      | CLI and SDE fresh creation share the same snapshot boundary; reuse is unchanged |

## Performance and lifecycle review

| Area               | Verdict | Evidence                                                       | Change or reason kept              | Verification                                              |
| ------------------ | ------- | -------------------------------------------------------------- | ---------------------------------- | --------------------------------------------------------- |
| Background work    | keep    | Existing root lock and demand-triggered read                   | No timers or extra reads           | Source trace and single-read regression                   |
| Memory             | keep    | One existing timeline retained for materialization             | No new registry/cache/copy         | Frozen timeline passed by reference                       |
| Scope/isolation    | keep    | Root lock plus unchanged runtime/source/owner checks           | No ambient credential fallback     | Exact Package source and model assertions                 |
| Rendering/hot path | fix     | Pending native child previously caused repeated recovery reads | Publish only after stable snapshot | Deferred-read regression; runtime performance not claimed |

| Provider    | Raw transition                                | App/UI state          | Topology/boundary                | Expected invariant                                              | Observed evidence                                       |
| ----------- | --------------------------------------------- | --------------------- | -------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------- |
| Claude Code | Switch Package after completed turns          | Existing f1 root open | Isolated Instance 89             | One new execution after complete old history                    | Actual failure and zero accepted intents recorded above |
| Claude Code | Pending native child becomes materialized     | Unit catalog fixture  | Actual canonical snapshot loader | No self-read before materialization; one dispatch               | Regression passed                                       |
| Claude Code | Source switch on fixed artifact, then restart | GUI                   | Isolated desktop                 | Successful selected-source call without replay or double charge | Not run in this change                                  |
| Codex / SDE | Fresh Package creation                        | Unit boundary         | Source write/materialization     | Preserve selected source without Account Key fallback           | Existing regression passed; no new GUI claim            |
| All         | Idle/hidden/close/delete                      | Runtime               | Resource lifecycle               | No added background resource                                    | Source inspection only; no new CPU/RSS claim            |

## Historical unstarted-child recovery

After restart, read-only inspection of the old failed child found no user input,
process ID, native ID, token-usage field, event/cache metadata, turn/intent,
chunk, resume binding (any account), native-ID ledger, history mutation, image
reference, shell replay, LLM span or token-usage row. This is distinct from a
started execution whose provider file has disappeared. The existing native
revision command returned `native: true, revision: null` for both cases, so the
canonical loader blocked before its already-existing empty-prefix Retry path.

The native persistence owner now proves the narrow case in a single SQLite
read. Only failed/cancelled native children with a nonempty parent and no
persisted dispatch, materialization, history or usage evidence get a stable
opaque `unstarted-native-child-v1` revision. Roots, live/completed/idle sessions,
any binding (including another account or an old fork), any accepted intent,
and ambiguous/missing real history retain the existing unavailable result.
Database errors propagate. The current account's normal native-file path is
unchanged. The token includes session/parent/status/creation/update identity;
new acceptance or history removes eligibility and the existing bracketing
revision reads reject the changed snapshot.

No frontend history predicate, cleanup path, retry timer or dispatcher is added.
The real canonical loader can now read the zero-length child prefix. Existing
source/owner checks reuse that child, synchronize the complete prior history,
and send the same durable turn intent through normal Retry. The frontend
regression asserts no second child and exactly one send. Already accepted
intents remain under the existing authoritative recovery path. An independent
review traced native synchronization: missing native ID plus nonempty canonical
history reaches the existing materializer on the same session.

### Recovery architecture review

| Layer                     | Verdict | Evidence                                                                                                                      |
| ------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 1 Compilation             | pass    | Six production-schema Rust producer tests, full TypeScript check and changed-file ESLint passed                               |
| 2 Ownership/deduplication | fix     | One persistence proof called by the existing native revision command; no alternate Retry implementation                       |
| 3 Naming                  | keep    | `unstarted_native_child_revision` names the narrow proof; unavailable still means unavailable                                 |
| 4 Domain semantics        | fix     | Proven unstarted empty history is distinguished from missing started history                                                  |
| 5 Defaults                | keep    | Every non-proven native case remains null; SQL errors remain errors                                                           |
| 6 Boundaries              | fix     | Historical classification is decided at native SQLite authority, never by UI filtering                                        |
| 7 Discoverability         | fix     | Comment documents every witness and why missing files cannot prove empty history                                              |
| 8 Wire protocol           | keep    | Existing `{native, revision}` shape; revision is already opaque and compared for equality                                     |
| 9 Init parity             | keep    | Tests use the production multi-table sandbox schema and real create/accept lifecycle                                          |
| 10 Resolver symmetry      | keep    | Native revision first resolves the same account-scoped binding as history and resume; proof rejects evidence from any account |

### Recovery performance/lifecycle review

| Area               | Verdict | Evidence                                                               | Change or reason kept                                                       | Verification                                                      |
| ------------------ | ------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Background work    | keep    | Existing demand-triggered revision command                             | One additional read only for unbound native sessions; no timer/subscription | Native call-chain review                                          |
| Memory             | keep    | One short opaque revision                                              | No retained cache/registry/history copies                                   | Source inspection                                                 |
| Scope/isolation    | keep    | SQLite session-ID predicates and unchanged root catalog query          | Other roots/children cannot supply or erase this child's evidence           | Real SQLite isolated-child fixture; exact source reuse regression |
| Rendering/hot path | keep    | Normal bound sessions return through their existing file-revision path | Session-indexed `NOT EXISTS` probes short-circuit on evidence               | Query-plan check; no CPU/RSS claim                                |

| Provider                  | Raw transition                                              | App/UI state                 | Topology/boundary                                 | Expected invariant                                                    | Observed evidence                                     |
| ------------------------- | ----------------------------------------------------------- | ---------------------------- | ------------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------- |
| Claude Code               | Old child failed before any native materialization/dispatch | Restarted historical fixture | Read-only isolated desktop DB                     | No provider/history witnesses                                         | All listed witnesses absent; live data unchanged      |
| Claude Code               | Terminal empty child gets accepted or gains history/binding | Production-schema sandbox    | Real native revision producer and chunk loader    | Stable only while proven empty; errors/real missing files fail closed | Targeted SQLite regressions                           |
| Shared native boundary    | Retry old failed child with full previous Package history   | Unit fixture                 | Actual canonical loader and existing continuation | Same child, preserved history, one durable intent dispatch            | Frontend regression passed                            |
| Claude Code               | Normal UI Retry, completion, restart                        | Existing historical root     | New private desktop artifact                      | Recovery without deletion and without duplicate charge                | Not run in this change; parent owns native acceptance |
| Codex / OpenCode / Cursor | Same historical empty-child transition                      | Runtime                      | Provider adapter                                  | Preserve native files and accepted intents                            | Not run; no adapter compatibility claim               |

Performance verdict: blocked for final runtime acceptance. The change introduces
no owned background resource, but GUI Retry/restart and runtime CPU/RSS are not
validated by compilation or unit tests.

### Recovery verification commands

- `cargo test --manifest-path src-tauri/Cargo.toml --lib transcript_revision_tests -- --test-threads=1`: 6 passed against the real sandbox schema. Tests call the native revision producer and native chunk loader; each history/dispatch witness independently disqualifies emptiness.
- `vitest run --config config/vitest.config.ts src/engines/SessionCore/conversations/localConversationContinuation.test.ts src/engines/SessionCore/conversations/localConversationExecutionTail.test.ts src/features/ConversationContinuation/canonicalConversationDispatcher.recovery.test.ts src/features/ConversationContinuation/externalHistoryContinuation.test.ts`: 4 files, 110 passed.
- `tsgo --noEmit --pretty false` and changed-file ESLint: passed.
- `node scripts/quality/check-test-placement.mjs`: passed across 607 directories.
- Final proof SQL on the live isolated DB was executed read-only and matches the historical failed child. `EXPLAIN QUERY PLAN` uses session-index lookups for the root and all 12 evidence probes; no full scan.
- Independent source review found no blocker. No installable artifact or release was published. Native GUI Retry/restart and settlement acceptance remain pending in the parent task.

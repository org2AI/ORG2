# Native Retry acceptance — 37a4

Measured on the private immutable `37a4edf28d` build on September 18. This is
ORG2's Codex CLI GUI, not the official Codex App. No installer was published.

## Actual original-message Retry

After complete native-history hydration, the original failed outage-recovery
message retained an enabled Retry action. Clicking it once returned the stored
conversation marker. Independent raw-provider, native usage, gateway trace,
receipt journal and ledger checks agree:

| Boundary              | Observed result                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------- |
| Provider context      | Original A and B plus the retried C each occur once; the superseded failed C is absent                        |
| Execution             | One new completed intent, one native turn, one provider attempt                                               |
| Route                 | Luna through the same account's healthy Reserve shard; not distinct-seller rotation                           |
| Usage                 | 15,409 fresh input, zero cached input, 25 output tokens                                                       |
| Settlement            | Buyer 1,711 / seller 1,089 / platform 622 microUSD, using frozen admin-configured prices and half-up rounding |
| Persistence           | One new native usage row; all previous usage and auxiliary rows unchanged                                     |
| Ledger                | One completed request, four postings, zero new outstanding holds; protected historical rows unchanged         |
| Primary configuration | All 44 protected primary files unchanged                                                                      |

Cache input was zero. This call does not establish a positive cache hit on this
binary. Ordinary-model routes currently have exhausted supplier quotas; no quota,
circuit or enrollment was changed to bypass that limitation.

## Normal shutdown and reopen

Normal menu Quit and confirmation stopped the exact tested process, its measured
WebKit processes and both local listener ports. Three post-exit resource samples
were zero. Reopening the same immutable build and private root preserved login
and the original conversation's successful Retry result without copying credentials.
This verifies persisted state, not a new post-restart inference or official-App Restore.
The earlier foreground sample overlapped menu activity and is not a clean idle
performance benchmark.

## Remaining native history defect

The UI shows four user turns: A, B, the old failed C and the successful C.
The model received only A/B/new C, so this is not duplicate dispatch or billing.
The authoritative retry lineage is durably stored, but native history hydration
and terminal reconciliation merge only failed-delivery sidecars and drop lineage
control records. The repair must retain validated lineage at that shared loading
boundary. It must not delete historical data or deduplicate by prompt text.

The existing error diagnostic remains historical evidence. The superseded user
prompt should not reappear as a separate logical turn. The source repair retains validated local control metadata in both native loading
and terminal reconciliation. Five frontend suites passed 69 tests, and the real
Rust EventStore replacement/derived regression passed. The two new loader regressions
failed on the previous implementation. The new immutable-build reload check remains
pending; this report does not declare merge readiness.

## Other delivery gates

After the user normally quit the isolated official Codex App, the product
Configure → Restore flow succeeded on `37a4`. The isolated configuration returned
to its exact pre-Apply hash; the existing native session file was unchanged, and
route metadata was cleared. This does not establish a new official-App invocation
or inference after Restore. The previous default state was independently traced
to an earlier normal ORG2 Quit, whose existing shutdown handler restores managed
configurations. Four primary Claude files changed during this later check. Read-only provenance
review found a concurrent main Claude launch and confirmed that the available
exact CLI baseline differs only in runtime/cache fields. The audited Codex
Apply/Restore paths target its isolated profile; no write path to those Claude
files was found. Without writer tracing and three of the before-file contents,
exact write attribution remains unproven. Do not extrapolate the earlier 44-file
equality result to this interval or roll back concurrent primary-App activity. Positive-cache evidence from older builds remains separately labeled.
Current-head CI must run after the consolidated source and documentation push.
No ORG2 installer, tag or release is authorized.

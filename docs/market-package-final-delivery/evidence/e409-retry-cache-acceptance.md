# Native Retry and cache acceptance — e409

Measured on the immutable private `e409db95b7` build on September 18, including
upstream develop `7fcbcd7f97`. This is ORG2's Codex CLI GUI. It does not establish
official Codex App acceptance or production Reserve availability.

## Actual failed message and original Retry

The local gateway was gracefully stopped only after checking loopback ownership,
no active connections or new holds, and the protected historical ledger. Sending
a new D message failed visibly. The gateway was restored and health/readiness
returned HTTP 200 before the original message's Retry was clicked once.

| Boundary          | Measured result                                                                                                                         |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Failed D          | No new Market request, attempt, posting, hold or native usage                                                                           |
| Retry             | One completed request, one supplier attempt, four postings                                                                              |
| Route             | Luna to Reserve through the same supplier's local s4                                                                                    |
| Provider usage    | Inclusive input 8,346, cached input 7,680, output 20                                                                                    |
| Native usage      | Fresh input 666 + cache read 7,680 + output 20 = total 8,366                                                                            |
| Settlement        | Buyer 171 / seller 109 / platform 62 microUSD at frozen administrator 55% / 35% rates                                                   |
| Persistence       | Exactly one new native usage row; previous usage and auxiliary rows unchanged                                                           |
| Ledger protection | New holds cleared; all old requests, attempts and postings unchanged, including the protected 9,252 hold and unattributed 2,306 request |

This is a real positive cache hit on this binary. Cache was not counted twice.
The reply recalled the original marker. That reply alone does not establish that
every prior user turn appeared exactly once in the provider context.

## History projection remains a merge blocker

The initial cold load showed the intended three logical turns A/B/retried C,
retained the old error audit and displayed the successful C reply. Sending D
then resurrected the old failed C, showing five turns instead of four. After
D Retry completed, terminal reconciliation temporarily showed only A/B/D, omitting
the successful C. A later update showed four turns but attached the C reply to
the old failed C timestamp, with an incorrect 59-minute duration. Normal Quit and
reopen preserved login and the D reply, but displayed the old failed D again as
a fifth turn with Retry. This restart is evidence of a remaining defect, not a
passing final regression. Screenshots and accessibility states were retained privately for
root-cause review. Neither a successful response nor correct billing makes this
history projection acceptable. The affected continuation/reconciliation writers
must be repaired without deleting historical data or deduplicating prompt text.

## Source validation and delivery limits

Before this run, the normalized native wire correction passed 113 frontend tests
and the Rust normalized-history contract. The shared local-history projection
repair passed 69 frontend tests and a real Rust EventStore replacement regression;
two new loader tests fail against the previous source. Latest develop integration
passed 14 suites / 227 tests, full fast typecheck, changed-file ESLint and normal
commit hooks. The private debug build and signature verification passed.

These source checks did not cover the observed live continuation defect. A new
immutable build must pass continuation, reload and normal restart/resume after
the next correction. CI must run on the final published source. Five short samples of the app plus its individually verified WebKit processes
measured visible idle CPU of 0.14–0.16% of one core and 754–755 MiB summed physical
footprint; menu-hidden CPU was 0.10–0.12% and 762–763 MiB. All tracked identities
exited after normal Quit, with three zero-resource post-exit samples. These
build-specific samples exclude CLI/tool processes and do not establish a
long-term performance verdict.

Official Codex Configure/Restore passed on the earlier `37a4` build, with exact
isolated config restoration and unchanged native session history; it did not
include a new official-App invocation after Restore. See the scoped report.
Cloud #117/#118/#119 are merged and deployed. The successful local Reserve calls
still depend on an unpublished CPA adapter; production currently pins the older
adapter. No installer, Beta, release or tag is published.

## Follow-up source repair

The settled and streaming snapshot writers now share the full projection's
validated Retry identity check. Changing or removing lineage invalidates the full
baseline because it changes historical rows outside the current delta. Normal
assistant/tool chunks still process only changed records; changed user records
construct a temporary identity set. No timer, cache, subscription, persistent
state or additional database read is added.

Native execution selection now checks superseded identities before comparing
provider-portable text. It skips an explicitly superseded empty failure when the
remaining transcript is a valid prefix, preserving raw audit history and using
a safe execution episode. Unexpected additional output still blocks continuation;
it does not silently rebuild or erase history. The old affected test transcript
is preserved and is not claimed repaired by this prevention guard.

Actual source commands:

```sh
pnpm test src/engines/SessionCore/conversations/localConversationContinuation.test.ts src/engines/SessionCore/conversations/localConversationExecutionTail.test.ts src/engines/SessionCore/conversations/queuedRetryLineage.test.ts
pnpm typecheck:fast
pnpm exec eslint src/engines/SessionCore/conversations/localConversationExecutionTargets.ts src/engines/SessionCore/conversations/localConversationContinuation.test.ts --max-warnings 0
cargo test --lib retry_lineage_ -- --nocapture
cargo test --lib streaming_snapshot_delta_tests -- --nocapture
git diff --check
```

The frontend suites passed 109 tests; typecheck and ESLint passed. The new
same-text/different-identity regression failed on the previous implementation.
The Rust lineage filter passed four tests; the two new settled/mutation
regressions failed on the prior implementation. The full streaming delta suite
also passed. Rust commands ran from the native crate with the shared local target
cache. Independent peer review found no new boundary/performance blockers.
These checks do not replace the next immutable-build acceptance.

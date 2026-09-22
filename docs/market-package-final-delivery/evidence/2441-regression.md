# 2441 real regression — 2026-09-18

Immutable source `2441ed610ebbb552fbf0f16ef00666c41446d625` integrates
`develop` through `7cf6d3060`. Normal ORG2 Quit completed before launch into
the same isolated root, with a SQLite backup and strict bundle signature check.
No credentials were copied and no installer was published.

## Passed: real cache read and absence of stale failed-turn usage

A new Codex CLI / Coding for beginner / Terra conversation returned `READY`,
then recalled a private acceptance marker absent from the second prompt.

The second call at 15:14 UTC reported upstream inclusive input 9693, cached
input 8704 and output 10. Native persistence stored fresh input **989**, cache
read **8704**, output **10**, total **9703**. These counters now agree.
Frozen administrator 45% buyer / 35% seller pricing independently reconciled
to **1727 / 1344 / 383 micro-USD** buyer/seller/platform, with zero reserve.

After that call settled, the named local gateway alone was gracefully stopped.
The next resumed turn failed with a real connection 502. Native usage remained
at 11 rows with identical hashes; Market remained at 337 requests, 277 attempts
and 717 postings. No stale usage or new charge was produced. Gateway restart
restored health/readiness 200 and preserved the historical 9252 hold and 2306
request.

Cache writes were zero; write semantics are not validated by this result.

## Failed: original-message Retry still absent

The real 502 displayed Agent request failed and Replay turn, with no Retry.
Replay was not invoked. Read-only tracing found the native suffix contained
the anchored user prompt and an empty task-completed lifecycle event. The
shared settled-tail reader counted that lifecycle event as agent output,
skipping the strict empty-failure proof path.

Read-only authority tracing confirmed this was a local conversation: personal
scope, no parent/import/fork, no per-session Cloud tag or push metadata, and no
matching repository scope for the scratch directory. Earlier notes attributing
this observed failure specifically to Cloud authority were premature. Cloud's
source-level tests remain separate evidence and do not establish a real Cloud run.
The producing boundary requires correction and another actual Retry test.
Historical queue owners and events are not backfilled or changed.

## Failed: existing Codex conversation after normal ORG2 restart

An old conversation was rejected before inference: expected provider openai,
actual provider orgii, with matching thread ID, directory and title. The
short-lived managed launch configuration had been normally released, while
the thread's provider identity persisted. Metadata synchronization read the
missing configuration as the default openai before execution could re-create
the temporary route. No new Market request was issued by this failed resume.

The follow-up preserves the trusted managed-session provider identity without
weakening external profile checks or rewriting history. It still needs final
source verification and real restart acceptance.

## Source and artifact checks at 2441

- 12 related Vitest suites: 276 passed
- Fast typecheck and all 9 changed TypeScript files passed scoped ESLint
- Parser tests: 212 passed, 5 existing ignored
- Managed-configuration tests: 83 passed
- Scoped org2/agent_cli Clippy, normal commit hooks and diff checks passed
- Private debug/no-bundle build and strict signature verification passed

CI and any later source changes need their own checks. Official Codex GUI
reopen/Restore still needs the user's normal exit of the isolated App; its
primary host is untouched. This is not a merge-ready full-acceptance report.

## Follow-up source checks

The shared settled-tail correction passed 13 Vitest suites / 292 tests,
including raw lifecycle-only failures and hidden reasoning/tool-result
negatives, fast typecheck and scoped ESLint. Failed accepted recovery records
proof without another send; completed and cancelled outcomes do not become Retry.

The managed-provider correction passed 214 parser tests (5 existing ignored).
The catalog suite was also run with `--include-ignored --test-threads=1`: all
10 passed, including actual installed app-server metadata operations after
production launch-configuration release and two subsequent resumes. NativeApp
project/resume still passed; provider tampering, symlinks and non-files remained
rejected. Scoped org2 Clippy with `-D warnings`, formatting and diff checks passed.
No model request or credential was created by the catalog tests.

These checks do not replace the next immutable build's actual Retry and restart.

## Actual fb0d follow-up: provider rejection and another Retry boundary

After normal Quit and an immutable `fb0d3cdee9` launch into the same test root,
the old Codex conversation passed the prior provider mismatch and reached Market.
The supplier rejected the first upstream attempt with HTTP 429; subsequent
requests ended with `model_temporarily_unavailable` 503. This proves the metadata
resume progressed, not that resumed inference succeeded. No Retry control was
visible after the failure. Read-only ledger reconciliation found nine cancelled
requests, one rejected upstream attempt and eighteen hold/release postings.
Every new reserve returned to zero; buyer, seller and platform charges were all
zero. Historical rows and both protected records were unchanged.

Further raw-event inspection found that the native terminal event also contained
an error diagnostic. Its reader emitted an ordinary error activity chunk, which
was treated as substantive assistant output. The earlier lifecycle-only fixture
did not cover this real shape. A producing-boundary correction and another real
Retry acceptance are required; ordinary assistant errors or partial output must
not be broadly ignored. Persisted historical events are preserved.

A short `fb0d` idle sample covered ORG2 and its individually verified WebKit
services only. Six visible samples measured 486–487 MiB physical footprint
and 0.02–0.09% CPU; six samples after menu Hide measured 507–508 MiB and
0.04–0.05% CPU. The window was restored via its normal accessibility action.
These short samples do not establish long-term memory stability or include
vendor/CLI processes. All 44 protected primary-file existence/hash checks
remained unchanged after this failure.

The subsequent source correction tags only Codex task-terminal diagnostics at
the parser boundary. Empty-failure proof requires the matching failed native
turn; ordinary errors, partial replies, tools and reasoning remain substantive.
A shared real 503-envelope fixture exercises Rust parsing and frontend recovery.
An older materialized diagnostic echo is excluded from provider context only
when the same history contains its typed receipt with the identical source ID.
Unproven echoes in older child transcripts stay fail-closed; no historical
records are deleted or rewritten.

Focused follow-up verification: 114 Codex source tests passed (3 existing
ignored), four frontend suites / 91 tests passed, fast typecheck and scoped
ESLint passed. The final integrated artifact still needs actual Retry acceptance.

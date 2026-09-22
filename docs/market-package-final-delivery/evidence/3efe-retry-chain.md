# 3efe two-Retry acceptance — September 18

Immutable source `3efe529d4b` includes develop `63203db40f`. This run verifies real
Package calls and exposes two remaining read-projection defects. It is **not a
merge-ready result**. No desktop installer or release was published.

## Real calls and accounting

A fresh conversation remembered a unique marker. Its sequence was A success,
B gateway failure, original B Retry, C continuation, D gateway failure, original
D Retry. Both failures used the controlled local gateway; the gateway was
restored and verified healthy before each Retry. No supplier quota was bypassed.

| Successful call | Fresh input | Cached input | Output | Buyer / seller / platform (microUSD) |
| --------------- | ----------: | -----------: | -----: | ------------------------------------ |
| A               |       8,116 |            0 |      5 | 896 / 570 / 326                      |
| B Retry         |      15,379 |            0 |     36 | 1,715 / 1,092 / 623                  |
| C               |         627 |       14,848 |     12 | 240 / 153 / 87                       |
| D Retry         |      15,451 |            0 |     23 | 1,715 / 1,091 / 624                  |

Each successful call has one request, one attempt and four postings. The totals
are buyer 4,566, seller 2,906 and platform 1,660 microUSD, using the frozen admin
55%/35% settings. Both failed phases added zero requests, attempts, postings or
native usage. New holds returned to zero; all pre-existing protected records and
auxiliary usage remained unchanged. C's native total was 627 + 14,848 + 12 =
15,487: cached tokens were not counted twice.

These are local Luna-to-Reserve calls on the same healthy supplier account.
They do not prove distinct-seller rotation or deployment of the local CPA adapter.
Native correlation uses unique model/time/usage and archived receipts; it is
not a captured native HTTP request ID.

## Native context versus rendered history

The original A transcript remained unchanged after both Retries. B Retry created
one new native execution containing A and its reply, then one new B and its
successful reply. C continued that execution and recalled the marker. D Retry
created another native execution containing A, successful B, C and their replies,
then exactly one new D and the correct `RECOVERED` reply. Neither superseded
failed prompt was re-executed or copied into the successful child.

The UI retained three logical turns after B Retry and C. After successful D,
it incorrectly showed only A/B/C. Normal Quit and reopening the conversation
reproduced the missing D. The native reply and settlement existed. Investigation
identified provider-local positional IDs colliding when distinct child episodes
were projected into one root timeline; the projection must preserve globally
scoped native source identity before rewriting ownership.

A separate presentation defect was also reproduced: the old failed B diagnostic
was grouped under A after its superseded user header was removed. That group
absorbed A's lazy reply placeholder and made A's elapsed time incorrect. The raw
A reply remains intact. The effective projection needs an explicit audit boundary
so historical failure diagnostics cannot attach to a different logical turn.

Historical raw transcripts remain preserved. A future source change or unit test
is not evidence that either corrected-build runtime gate passed.

## Resources and restart

Five short visible-idle samples measured 0.03–0.09% CPU after the initial sample
and approximately 691 MiB summed physical footprint. Five samples after the hide
shortcut measured 0.03–0.04% and approximately 690 MiB. Three samples after normal
Quit found zero remaining footprint/CPU for the exact tracked app/WebKit process
identities. CLI/tool processes are outside this sample, and it is not a sustained
active-load or long-term memory benchmark.

Normal restart retained the signed-in account and searchable conversation.
Reopening still reproduced the three-turn rendering defect, so restart acceptance
remains failed for final history presentation.

## Follow-up source correction

Landed and live child projections now compute the global native source identity
before changing their session ownership. Both carry that identity forward, so
provider-local positional IDs cannot collide across execution episodes and the
same live response can become its landed representation without duplication.
A production projection-to-canonical-UI regression reproduces the old missing D
and passes after this correction. Live overlay comparisons still ignore fresh
wrapper allocation when the underlying values have not changed.

For a proven superseded empty attempt, full and delta snapshots retain a
structural audit boundary with the old row's identity. The original EventStore
prompt/error stays untouched. The boundary gives the diagnostic its own group,
without adding a user turn or entering the provider context, Messages or Simulator.
The TypeScript fallback follows the same contract. Shared Rust/TypeScript fixtures
cover lazy prior replies, original failed audit, successful replacement, malformed
lineage and unchanged raw history. Ordinary streaming chunks still inspect only
changed records; no background resource or persistent cache is added.

The historical native catalog's end timestamp can include idle time before the
next turn. This correction does not claim to repair that separate duration issue.
The default 4 GiB `tsc` invocation exhausted its heap; the project's full fast
`tsgo` typecheck passed. A new immutable runtime is still required to establish
that both presentation defects are corrected in the actual App.

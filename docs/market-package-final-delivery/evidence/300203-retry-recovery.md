# 300203 preserved-history and third-Retry acceptance

Immutable source `3002038f23` includes develop `785402f812`. This run separates
actual native calls, rendered history and navigation. No installer or release
was published.

## Restored history

Opening the existing four-turn conversation restored A's `READY` and D's
`RECOVERED` response from preserved native records. All four user prompts and
successful replies appeared once. The previous failure diagnostic remained in a
separate headerless audit group. The three native transcript hashes matched their
prior checkpoints; no raw history was repaired, rewritten or deleted.

The navigator still counted the audit group as an extra `Round 2`. This is a
presentation failure: four logical user turns displayed five navigation entries.
The follow-up correction explicitly marks proven audit groups in projection
metadata and excludes only those groups from turn pagination/navigation. Their
diagnostics remain visible; ordinary headerless groups retain existing behavior.
A subsequent immutable build must verify that correction.

## Real continuation and original-message Retry

E recalled the original marker with `RESTORED`. F was sent during a controlled
local gateway outage and failed with 502. The gateway was restored and health
checked before the original F `Retry` was activated. Its successful response was
`RETRIED` followed by the original marker. G continued the same conversation and
returned `STABLE` with that marker.

The third Retry execution contained exactly six logical prompts A–F and their
successful responses. Superseded failed B/D/F intents were not copied into the
new native context; all three durable failure lineage links remain preserved.
The earlier root and first child hashes stayed unchanged. The second child
legitimately appended E and the failed F while retaining its prior byte prefix.

| Call    | Fresh input | Cached input | Output | Buyer / seller / platform (microUSD) |
| ------- | ----------: | -----------: | -----: | ------------------------------------ |
| E       |         689 |       14,848 |     12 | 247 / 157 / 90                       |
| F Retry |      15,524 |            0 |     23 | 1,723 / 1,096 / 627                  |
| G       |         766 |       14,848 |     11 | 255 / 162 / 93                       |

All three successes settled once using frozen admin 55%/35% settings. E's native
usage was 689 + 14,848 + 12 = 15,549, with no duplicate cached input. F's failure
added zero requests, attempts, postings, native usage or auxiliary usage. All
protected old ledger records remained unchanged and new holds returned to zero.
G's native usage was 766 + 14,848 + 11 = 15,625. The three successes total
buyer 2,225, seller 1,415 and platform 810 microUSD. The subsequent build's restart
results require separate runtime evidence.

These calls used the same local Luna-to-Reserve supplier route. They do not prove
distinct-seller failover, production delivery of the local CPA adapter, or official
Codex App GUI behavior. Existing native duration labels can include idle time;
that separate catalog issue remains outside this correction.

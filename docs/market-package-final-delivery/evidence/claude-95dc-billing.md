# Claude Desktop Package billing acceptance — 95dcff53a

Verified on 2026-09-18 against native build `95dcff53a`: two Packages in one
official Claude Desktop conversation, continued after normal quit/reopen and
after Restore followed by Configure/Open. All four foreground calls, and every
additional financial event in the captured windows, reconcile. Both Packages
use Sonnet 5; this does not establish switching foundation models.

## Capture boundaries

All times below are UTC on 2026-09-18. Snapshots were taken in read-only,
repeatable-read database transactions. Each interval uses the preceding
snapshot as its baseline; earlier snapshots and reports remained frozen.

| Window                            | Baseline     | Final snapshot | Native prompt → response    |
| --------------------------------- | ------------ | -------------- | --------------------------- |
| A: Coding for beginner            | 13:34:39.018 | 13:42:56.518   | 13:42:24.773 → 13:42:26.384 |
| B: [Acceptance] Sonnet overlap    | 13:42:56.518 | 13:43:46.926   | 13:43:32.501 → 13:43:33.932 |
| C: quit/reopen, Package B         | 13:43:46.926 | 13:45:44.536   | 13:45:33.789 → 13:45:35.517 |
| D: Restore/reconfigure, Package B | 13:45:44.536 | 13:52:05.451   | 13:51:52.993 → 13:51:54.836 |

Saved Desktop session metadata maps one unchanged local conversation ID to one
unchanged CLI conversation ID. The official usage ledger retains that local ID
across all four turns, changes Package alias from A to B, and keeps B after both
lifecycle operations. Timestamped native assistant usage exactly matches one
new Market receipt per foreground turn. B, C and D return the original marker
without their prompts repeating its value. This establishes routing and context
continuity without publishing private conversation content or identifiers.

## Foreground usage and settlement

Token columns are provider-reported counts. Cache-write counts below are all
five-minute writes; one-hour writes are zero. Monetary columns are micro-US
dollars (µUSD), where 1,000,000 µUSD = $1.

| Turn | Input | Output | Cache write | Cache read | Buyer µUSD | Seller µUSD | Platform µUSD |
| ---- | ----: | -----: | ----------: | ---------: | ---------: | ----------: | ------------: |
| A    | 8,549 |     14 |      68,871 |          0 |     85,237 |      66,295 |        18,942 |
| B    |   125 |     10 |       8,615 |     68,871 |     16,048 |      12,482 |         3,566 |
| C    |    42 |     10 |      81,310 |          0 |     91,557 |      71,211 |        20,346 |
| D    |    42 |     10 |      81,399 |          0 |     91,657 |      71,289 |        20,368 |

Every request's frozen price card matches its admitted admin contract: buyer
**45%**, seller **35%**, within the configured **35–80%** range. Settlement follows
those admin settings, rather than assuming the buyer pays the range maximum.

The independent calculation multiplies each usage dimension by its contracted
rate, adds the exact integer numerators, and rounds half-up once. Claude input
excludes cache tokens, so cache creation and reads are priced separately. Buyer,
seller and platform amounts match receipt results and ledger postings exactly.

## Complete window accounting

| Window    | New requests | Completed: charged / zero usage | Cancelled | New attempts | New postings |  Buyer µUSD | Seller µUSD | Platform µUSD |
| --------- | -----------: | ------------------------------: | --------: | -----------: | -----------: | ----------: | ----------: | ------------: |
| A         |           18 |                          2 / 16 |         0 |           18 |            8 |      86,115 |      66,978 |        19,137 |
| B         |           45 |                          3 / 33 |         9 |           36 |           12 |      24,118 |      18,759 |         5,359 |
| C         |           21 |                          1 / 16 |         4 |           17 |            4 |      91,557 |      71,211 |        20,346 |
| D         |           21 |                          1 / 16 |         4 |           17 |            4 |      91,657 |      71,289 |        20,368 |
| **Total** |      **105** |                      **7 / 81** |    **17** |       **88** |       **28** | **293,447** | **228,237** |    **65,210** |

There are 88 completed requests in total. Buyer charges total **$0.293447**:
four foreground turns cost **$0.284499**, and three additional calls cost
**$0.008948** (878, 34 and 8,036 µUSD). These additional calls reconcile fully,
but their exact helper purpose is **unproven**; they are not attributed to title
generation, probing or memory updates. Zero-use and cancelled request purposes
are likewise not inferred from their amounts.

Every new reserve ends at zero. Per-request buyer wallet debits, seller credits
and platform credits reconcile, and all 28 new postings belong to the captured
new requests. Zero-use and cancelled rows create no postings. No new request
remains nonterminal.

All preexisting requests, attempts and postings remain unchanged, including the
protected historical **9,252 µUSD hold** and **2,306 µUSD charge**. The former
remains the sole historical nonterminal request; this audit does not release it.
The latter's original helper-purpose attribution remains unresolved. Shared
account-load sequence values advance normally with these new calls and are not
claimed unchanged.

## Scope of evidence

This audit used frozen database snapshots, independent integer arithmetic,
selected native usage records and the official Desktop usage ledger. The auditor
made no inference requests, configuration changes or database writes. App launch,
normal Restore behavior, primary configuration fingerprints and process isolation
are separate lifecycle evidence. Financial reconciliation alone does not prove
those behaviors, Keychain identity preservation, or a different model's support.

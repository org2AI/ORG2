# Session Sources lifecycle audit

Source requests are session scoped, single-flight while pending and released by consumer reference count. Pending request ownership is removed at settlement/disposal; no completed-result global cache. Hidden documents pause noncritical refresh; visibility return revalidates. Session-keyed renderer prevents stale list/gallery/page state crossing sessions. Inactive tabs do not read history or resolve images. Old rows survive failed refresh; retry is explicit.

Reader work is bounded at input-line, reference, pending-call, nested-resource and tool-action boundaries. Native SQL extracts compact visible source messages, not entire session objects. Structured references and completed tool facts are separate; errors never masquerade as successful resources, and edit receipts do not synthesize attachments.

Category arrays and semantic detail maps live with the mounted view. Four category page counters start at 30 rows each (at most 30 image thumbnail reads); activity details start at 20 unique rows per action type. More content loads by explicit action. Duplicate display actions retain original call IDs and occurrence totals. No new recurring poller, worker or network transport.

Validation covers coalesced reads, refresh/session races, hidden/inactive lifecycle, retry, page reset, image identity/gallery, activity aggregation and actual provider transcript readers. No native CPU/RSS sampling, large-history benchmark, dual-machine sharing run or complete packaged-app E2E in this PR. Verdict: scoped/bounded lifecycle supported by tests; no measured performance claim.

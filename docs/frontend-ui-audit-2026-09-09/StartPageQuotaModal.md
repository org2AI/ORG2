# StartPageQuotaModal UI audit

| Line                         | Element         | Verdict          | Reason                                                                                    | Suggested change |
| ---------------------------- | --------------- | ---------------- | ----------------------------------------------------------------------------------------- | ---------------- |
| `StartPageQuotaModal.tsx:38` | Spotlight shell | keep with reason | Standard shell props preserve placement and dismissal                                     | None             |
| `StartPageQuotaModal.tsx:49` | Pill header     | keep with reason | Shared path/back pill and trailing refresh slot; explicit end alignment applies only here | None             |
| `StartPageQuotaModal.tsx:72` | Scroll region   | keep with reason | 70vh bounds content on short viewports; no matching shared height token                   | None             |
| `StartPageQuotaModal.tsx:73` | Body            | keep with reason | Canonical SpotlightFormBody spacing and modal-only four-account pagination                | None             |

Verdict totals: **0 fix**, **4 keep with reason**, **0 abstract**.

Visual desktop verification was not run. Component tests cover shell, header, and pagination props.

Pagination controls are portaled into the modal header immediately before refresh; the local page state stays with the grid and the portal is removed on unmount.

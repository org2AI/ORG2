# Provider manager UI audit

| Line                               | Element                       | Verdict          | Reason                                                                                                                                                | Suggested change |
| ---------------------------------- | ----------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `ProviderProfileLibrary.tsx:63`    | Search input                  | keep with reason | Uses the shared Input, accessible label, and existing clear affordance; filtering stays local                                                         | None             |
| `ProviderProfileLibrary.tsx:81`    | Responsive card grid          | keep with reason | Standard spacing and breakpoint tokens; reviewed at 1200px and 720px                                                                                  | None             |
| `ProviderProfileLibrary.tsx:95`    | Profile card                  | keep with reason | Noninteractive grouping has a profile label; named buttons provide keyboard actions; all colors and border/spacing values use theme tokens            | None             |
| `ProviderProfileLibrary.tsx:119`   | Profile metadata              | keep with reason | Semantic description list suits three key/value pairs; wrapping preserves endpoints and model IDs                                                     | None             |
| `ProviderProfileLibrary.tsx:146`   | Profile actions               | keep with reason | Shared Button handles disabled/loading states; wrapping keeps actions accessible at narrow widths                                                     | None             |
| `ProviderProfileEditor.tsx:146`    | Configured connection summary | keep with reason | Shared theme tokens and Button; deliberately remains outside filtered results and identifies configured state separately from selection/test evidence | None             |
| `HarnessConnectionsSection.tsx:50` | Per-app navigation            | keep with reason | Existing SegmentedTextPill remains the single app selector, with dirty/busy protection                                                                | None             |

Verdict totals: **0 fix**, **7 keep with reason**, **0 abstract**.

Scope: the three changed TSX components. D1–D5 covered: no new raw interactive controls, arbitrary color/size values, or repeated three-site shell needing extraction. One library serves all three targets. New labels exist in all 13 settings locales. Static component previews cover light/dark, narrow, loading, empty, testing, and failed-read states; they do not establish native runtime behavior or full accessibility compliance.

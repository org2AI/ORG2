# Review search UI audit

| Line                                                                            | Element                   | Verdict          | Reason                                                                                                                                                    | Suggested change |
| ------------------------------------------------------------------------------- | ------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `src/components/FindCard/index.tsx:236`                                         | Review scope controls     | keep with reason | Optional slot reuses the shared search card without changing session/file consumers. Review uses the existing SegmentedTextPill.                          | None             |
| `src/modules/WorkStation/shared/DiffSectionList/search/useReviewSearch.tsx:261` | Floating search placement | keep with reason | Uses the same outer pane surface and top/right spacing as consolidated search.                                                                            | None             |
| `src/components/FindCard/index.tsx:272`                                         | Result status             | keep with reason | Existing status region accepts error and capped-result text; no second notification surface.                                                              | None             |
| `src/features/CodeMirror/Diff/index.scss:596`                                   | Deleted-text selection    | keep with reason | Theme-token bridge highlights CodeMirror deletion widgets, which are outside its editable document. Native search decoration still handles document text. | None             |

Verdict totals: **0 fix**, **4 keep with reason**, **0 abstract**.

Source audit only. Native visual verification was not run because computer control is not authorized. Relevant checks cover the search hook and real CodeMirror navigation in jsdom; screenshots, theme, and viewport appearance remain unverified.

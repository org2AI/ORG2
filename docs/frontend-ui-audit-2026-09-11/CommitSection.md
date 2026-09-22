# CommitSection UI audit

Updated for the shared-header and visible-actions follow-up on 2026-09-13.

| Line                    | Element           | Verdict          | Reason                                                                                                                            | Suggested change |
| ----------------------- | ----------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `CommitSection.tsx:247` | Control spacing   | keep with reason | Sidebar keeps its inset; spotlight controls have no padding so SpotlightFormBody owns the one p-3 inset                           | None             |
| `CommitSection.tsx:493` | Message field     | keep with reason | Existing Textarea retains accessible labelling and autofocus                                                                      | None             |
| `CommitSection.tsx:533` | Commit operations | keep with reason | Available actions use visible shared Button controls with validation and loading guards; wrapping accommodates constrained widths | None             |
| `CommitSection.tsx:702` | Header            | keep with reason | The shared SpotlightFormLayout header prop renders the same path row as workspace forms; no custom title/close row remains        | None             |

Verdict totals: **0 fix**, **4 keep with reason**, **0 abstract**.

D1–D5 reviewed. Rendered coverage verifies available buttons, disabled empty-message actions, each callback, header rendering, Escape, and reopening with the controlled draft. Desktop visual verification was not performed because computer control was not authorized. The shared spotlight shell does not provide the former ModalSystem Tab focus trap or automatic focus restoration; keyboard traversal remains a shared-shell limitation.

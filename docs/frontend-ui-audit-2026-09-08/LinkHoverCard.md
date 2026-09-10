# LinkHoverCard UI audit

| Line                                                    | Element     | Verdict          | Reason                                                                                                                   | Suggested change |
| ------------------------------------------------------- | ----------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| `src/components/MarkDown/LinkPullRequestSummary.tsx:27` | Header      | keep with reason | Status, repository/number and updated age follow the supplied reference; status uses shared Tag mini pill with 14px icon | None             |
| `src/components/MarkDown/LinkPullRequestSummary.tsx:60` | Title       | keep with reason | Loaded title uses its natural line count without a minimum height; longer titles wrap without clipping                   | None             |
| `src/components/MarkDown/LinkPullRequestSummary.tsx:79` | Footer      | keep with reason | Avatar and author share a row with plain diff and file-count text, using shared components and localized count           | None             |
| `src/components/PrStatusBadge/index.tsx:92`             | Pill size   | keep with reason | Existing size prop selects mini for xs and small for sm; non-pill badge sizing remains unchanged                         | None             |
| `src/components/SessionHoverCard/HoverCardBase.tsx:375` | Panel width | keep with reason | Opt-in wide panel uses w-96 and viewport clamp; other cards retain default width                                         | None             |

Verdict totals: **0 fix**, **5 keep with reason**, **0 abstract**.

PR cards follow the supplied header/title/footer format. Branch row and visible URL are omitted. Existing action footer retains text-only Open PR with dropdown arrow. Skeletons share the header/footer line boxes and show two placeholder title lines; loaded titles use their natural height, including a single line for short titles.

Structural tests verify layout order, mini pill, 14px icon, wrapped title, author/avatar, age timestamp and file/diff counts. Desktop visual verification was not run because computer control was not requested.

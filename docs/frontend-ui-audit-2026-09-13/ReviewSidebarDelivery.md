# Review sidebar delivery audit

| Line                                            | Element                | Verdict          | Reason                                                          | Suggested change                                                             |
| ----------------------------------------------- | ---------------------- | ---------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `FileHeader/index.tsx:255`                      | Hosted header controls | fix              | File rows could duplicate host controls                         | Applied: explicit host ownership and one menu destination                    |
| `GitCommitDetailContent/CommitTabHeader.tsx:76` | Commit breadcrumbs     | fix              | Slash-delimited titles were parsed as paths                     | Applied: explicit SHA and summary segments                                   |
| `StashContent/index.tsx:405`                    | Stash navigation       | fix              | Nested headings and custom actions differed from sidebar layout | Applied: one section header with count, back navigation and standard actions |
| `GitFileList/index.tsx:447`                     | Second-level actions   | fix              | Visibility and styling differed from the primary sidebar        | Applied: scoped shared action group and sidebar Button props                 |
| `config/workstation/tokens.ts:55`               | Shared action geometry | fix              | Discard glyphs and compact button radius were oversized         | Applied: 12px discard glyph and small radius with unchanged hit areas        |
| `GitHistoryContent/index.tsx:533`               | Fixed virtual rows     | keep with reason | Graph lines and virtualization require matching heights         | Retain fixed height and use horizontal insets                                |

Verdict totals: **5 fix**, **1 keep with reason**, **0 abstract**.

Verification: isolated branch typecheck and i18n checks passed; targeted ESLint passed. Fifteen targeted Vitest suites ran: 103 passed initially; the one failed Spotlight padding test exposed an incomplete local token change. Updating the owning body token made that test pass on rerun. The git commit hooks rerun staged checks. No desktop visual verification was performed because computer control requires explicit opt-in. No runtime performance improvement is claimed.

Architecture coverage: component ownership, stale selection reset, explicit breadcrumb segments, and removal of duplicate header wrappers. No persistence schema, API, or wire changes. Existing settings and request owners remain authoritative. Mount/unmount, graph/list switching, menu placement, and category transitions have automated coverage; real-app multi-root layout and CPU/RSS remain unmeasured.

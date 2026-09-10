# CloudOrgRepoScopesSection UI audit

Scope: 1 custom notice(s) migrated to PageNotice. Checked shared component use, tokens, color/size overrides, accessibility, and duplicate notice markup.

| Line                                                                               | Element     | Verdict          | Reason                                                                                                                                                     | Suggested change |
| ---------------------------------------------------------------------------------- | ----------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `src/engines/ChatPanel/panels/CloudOrgPanelView/CloudOrgRepoScopesSection.tsx:248` | Page notice | keep with reason | Uses the shared neutral notice surface; existing message content and display condition are preserved. Existing action handler uses the shared action slot. | None.            |

Verdict totals: **0 fix**, **1 keep with reason**, **0 abstract**.

Verification: TypeScript and affected Vitest suites are recorded in the PageNotice architecture report. Desktop visual verification was not run because computer control was not requested.

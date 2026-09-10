# MarkdownEditor tab hook UI audit

Scope: extracting the shared tab-label hook and migrating its editor, Agent wizard and Policy form consumers. D1–D5 reviewed at the changed boundary; no markup, tokens, accessibility behavior or rendering structure changes.

| Line                                                                                 | Element               | Verdict          | Reason                                                                                                                   | Suggested change |
| ------------------------------------------------------------------------------------ | --------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| `src/modules/shared/components/MarkdownEditor/index.tsx:17`                          | Shared tab-label hook | keep with reason | The editor continues to render the same TabPill control and translated labels; only ownership moves to a React/i18n leaf | None             |
| `src/scaffold/WizardSystem/variants/Policy/PolicyRuleWizard/MarkdownRuleForm.tsx:13` | Policy editor imports | keep with reason | This form actually renders MarkdownEditor and keeps that import; its tab labels now share the same leaf as Agent wizard  | None             |

Verdict totals: **0 fix**, **2 keep with reason**, **0 abstract**.

No visual evidence is needed for an import-only change with identical JSX. Native visual verification was not performed. The dependency regression establishes the hook's source boundary, not emitted bundle savings.

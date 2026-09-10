# InlineCredentialImport UI audit

Scope: 2 custom notice(s) migrated to PageNotice. Checked shared component use, tokens, color/size overrides, accessibility, and duplicate notice markup.

| Line                                                                                                   | Element     | Verdict          | Reason                                                                                                                                  | Suggested change |
| ------------------------------------------------------------------------------------------------------ | ----------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `src/modules/MainApp/Integrations/KeyVault/CliClients/CredentialImport/InlineCredentialImport.tsx:128` | Page notice | keep with reason | Uses the shared neutral notice surface; existing message content and display condition are preserved.                                   | None.            |
| `src/modules/MainApp/Integrations/KeyVault/CliClients/CredentialImport/InlineCredentialImport.tsx:133` | Page notice | keep with reason | Uses the shared neutral notice surface; existing message content and display condition are preserved. Title uses the shared header API. | None.            |

Verdict totals: **0 fix**, **2 keep with reason**, **0 abstract**.

Verification: TypeScript and affected Vitest suites are recorded in the PageNotice architecture report. Desktop visual verification was not run because computer control was not requested.

# Onboarding cleanup UI audit

| Line                                                                                                | Element              | Verdict          | Reason                                                                                       | Suggested change |
| --------------------------------------------------------------------------------------------------- | -------------------- | ---------------- | -------------------------------------------------------------------------------------------- | ---------------- |
| src/modules/MainApp/Integrations/KeyVault/CliClients/CredentialImport/InlineCredentialImport.tsx:30 | Import panel         | keep with reason | Existing shared buttons, notices and table retained; removed only unreachable wizard options | None             |
| src/modules/MainApp/AgentOrgs/Table/InlineExternalAgentsImport.tsx:7                                | Agent import wrapper | keep with reason | Shared import UI retained; removed unused prop forwarding                                    | None             |
| src/scaffold/Tutorials/CodeEditorTour.tsx:53                                                        | Code editor steps    | keep with reason | Removed three steps whose targets no longer render; retained tour chrome and controls        | None             |
| src/scaffold/Tutorials/generalLayoutTourConfig.ts:12                                                | General layout steps | keep with reason | Removed four obsolete dock-item steps; remaining targets have rendered owners                | None             |

Verdict totals: **0 fix**, **4 keep with reason**, **0 abstract**.

No real desktop visual check: computer control was not authorized. Shared UI layout is retained; new modal/menu appearance still needs visual review.

# Modal footer UI audit

Implementation follow-up to the modal audit. Scope is this PR only.

| Line                                                                                                                                                                                                                                                                                         | Element                  | Verdict          | Reason                                                         | Suggested change        |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ---------------- | -------------------------------------------------------------- | ----------------------- |
| `src/util/dialogs/gitAuthenticationDialog.tsx:47`; `src/modules/MainApp/WorkManagement/CreateIssueModal.tsx:104`; `src/scaffold/AppUpdater/index.tsx:57`; `src/scaffold/ModalSystem/variants/Quit/index.tsx:59`; `src/engines/ChatPanel/InputArea/components/AgentOrgOverviewPanel.tsx:1552` | Custom-footer prop sweep | fix              | Seven live sites supplied ignored default-footer configuration | Remove only inert props |
| `src/scaffold/ModalSystem/index.tsx:64`                                                                                                                                                                                                                                                      | Custom footer override   | keep with reason | Explicit footer content intentionally owns its actions         | Retain                  |

Verdict totals: **1 fix**, **1 keep with reason**, **0 abstract**. The fix is implemented; multi-site patterns count once.

Remove inert onOk/label/button props from git authentication and issue creation, and inert footerTopBorder props from updater, quit and three team-overview modals. Retain the explicit custom-footer handlers and styling. The eighth audited site is the dead Login modal, removed in the separate cleanup PR.

No user-visible behavior change is intended: removed props were bypassed by custom footers. Future default-footer migrations must supply their own configuration. Screenshots add no evidence for removal of ignored props; no native interactions were performed.

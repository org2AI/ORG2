# Remaining onboarding code audit

Scope: remaining onboarding routes, modal, tours, shared import options, settings and mobile welcome UI. Findings confirmed by source tracing; the authorized cleanup below has now been applied.

Covered architecture layers 2–7 (dead references, naming, ownership, branches, boundaries, discoverability). Compilation is verified as part of the final PR checks. Backend wire/init/resolver layers are unaffected.

## Confirmed findings

| Location                                                                                            | Finding                                                       | Evidence / disposition                                                                                                                                                                      |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| src/modules/MainApp/Integrations/KeyVault/CliClients/CredentialImport/InlineCredentialImport.tsx:33 | Dead wizard-only forceExpanded/onCompleted options and branch | All three production callers supply only onAfterImport. Remove these component options and the unreachable toggle branch; retain ordinary credential importing                              |
| src/modules/MainApp/AgentOrgs/Table/InlineExternalAgentsImport.tsx:9                                | Dead forceExpanded/onCompleted forwarding                     | Only caller AgentOrgsTableContent supplies cursorRepos/onAfterImport. Remove these wrapper options. The shared InlineExternalImport options remain live through SkillsTable                 |
| src/scaffold/Tutorials/codeEditorTourConfig.ts:6                                                    | Three stale tour targets                                      | repo-selector, branch-selector and dashboard have no rendered target anywhere in src. CodeEditorTour still includes their steps, including a branch fallback to the also-absent repo target |
| src/scaffold/Tutorials/generalLayoutTourConfig.ts:10                                                | Four stale dock item targets                                  | All Tabs, Code Editor, Browser and Projects target IDs have no rendered consumers; their tour steps remain reachable. This is stale active UI, not a dead tour component                    |

Tour findings require either removing obsolete steps/copy or attaching them to the current product controls. Do not remove the whole tour merely because some steps are stale.

## Retained with evidence

- OnboardingHost/Modal: live dev-mode account-menu flow.
- GeneralLayoutTour/CodeEditorTour: live via cards and GUI action dispatch.
- GuideHighlightOverlay, scheduler and highlight atoms: live through GUI actions and tours.
- MobileRemote WelcomeScreen: mounted from MobileRemoteApp.
- KeyVault initialAgentType: supplied by AccountCategoryView and HarnessConnectionsSection.
- Shared InlineExternalImport forceExpanded/onCompleted: supplied by SkillsTable.
- Cloud membership command hook: called by CollabOrgForm.
- general.setupWalkthroughProgress schema: deliberately retained compatibility data; no active progress reader/writer. Removing it changes settings parsing/serialization, not merely UI dead code.
- Retired walkthrough route test: validates that the old URL remains unregistered.

No additional standalone onboarding page was found. Removed the two dead wrapper options, seven obsolete tour steps and targets, associated translations, and their exclusive navigation branches. Shared import options used by SkillsTable remain intact. Credential import tests now expand/collapse through the actual toggle.

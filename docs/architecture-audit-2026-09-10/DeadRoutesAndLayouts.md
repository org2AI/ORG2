# Retired routes and unused layout code

**Status:** All confirmed removal candidates below were removed in the subsequent user-authorized cleanup. The audit-time observations are retained as evidence; see [cleanup verification](DeadCodeCleanup.md).

## Scope and method

Removed three orphaned routes at the user's request. Then audited additional unused layout UI and supporting frontend logic, without deleting those additional candidates. Working tree already contains unrelated ongoing changes; findings describe this checkout.

Traced the production router, startup/login redirects, SettingsSlot, AppBootstrap, navigation actions, native session-window launcher and mobile/OAuth entry points. Ran Knip with the repository config (desktop/mobile entries and test entries), then checked imports and callers for the findings below. An unused barrel export is not proof that its implementation is unused.

## Completed route cleanup

- Removed `/orgii/app/select-repo`, `/orgii/app/ideas`, and `/orgii/app/dev-tools/flow-awareness-test`, their lazy imports and route metadata.
- Deleted SelectRepo, FlowAwarenessTest, ComingSoonRoutePage and the now-exclusive MainAppShell.
- Removed the sidebar's select-repo exception, the exclusive max-width export, and exclusive SelectRepo/ideaArea/comingSoon translations across locales.
- Kept login's onboarding layout/video, active tutorial translations, Settings' MainAppPageHeader, production flow tracking, compatibility redirects, OAuth, mobile and detached-session routes.
- Old URLs now reach the existing error/catch-all path (subject to the auth guard); no persisted data cleanup or migration.

## Additional confirmed unused layout candidates — not removed

| File / symbol                                                      | Evidence                                                                                   | Suggested follow-up                                                                 |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `src/modules/shared/layouts/ListDetailSubpage/ConfigListItem.tsx`  | Knip unused file; no importer or component caller                                          | Remove file                                                                         |
| `src/modules/shared/layouts/SectionLayout/Table.tsx`               | Knip unused file; SectionTable only occurs in its own implementation/examples              | Remove file and check its four exclusive SECTION_TABLE tokens                       |
| `src/modules/shared/layouts/blocks/BrowseCard.tsx`                 | Knip unused file; only self references                                                     | Remove file                                                                         |
| `src/modules/shared/layouts/blocks/CollapsibleTableSection.tsx`    | Knip unused file; only self references                                                     | Remove file                                                                         |
| `src/modules/shared/layouts/blocks/SessionGroupPage.tsx`           | Knip unused file; no caller                                                                | Remove wrapper; do not infer that shared SessionTable is dead                       |
| `src/modules/shared/layouts/blocks/sessionHistoryListTokens.ts`    | Knip unused file; token object has no consumers despite the sharing comment                | Remove file                                                                         |
| `src/modules/shared/layouts/blocks/PageHeader/index.tsx`           | Knip unused file; no import of this header                                                 | Remove old header and its exclusive search/focus logic; keep MainAppPageHeader      |
| `src/modules/shared/layouts/SectionLayout/CategoryRow.tsx`         | Definition + unused barrel export only                                                     | Remove component and barrel entry; ContextCategoryRow is a different live component |
| `src/modules/shared/layouts/blocks/PanelFooterAction.tsx`          | Definition + unused barrel export only                                                     | Remove component/export; keep live PanelFooter and its same-named interface         |
| `src/modules/shared/layouts/blocks/ListPanelSearch.tsx`            | Definition + unused barrel export only; remaining references are documentation             | Remove component/export and update stale docs                                       |
| `src/modules/shared/layouts/blocks/BreadcrumbPillNav/index.tsx:38` | BreadcrumbPillNav has no consumers; BreadcrumbPillNavTrigger is used by SettingsBreadcrumb | Remove only unused component/props; keep file and trigger                           |

## Additional confirmed unused logic — not removed

| File / symbol                                                                           | Evidence                                                                                                                 | Suggested follow-up                                                             |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| `src/modules/MainApp/Settings/hooks/toolbarPlusConfigs.ts:29`                           | getPlusConfigForCategory has no caller. Live SettingsHeaderActions calls useRouteToolbarConfig, which does not import it | Remove helper and its private builders                                          |
| `src/engines/ChatPanel/ChatHistory/GroupChatView/useGroupChatFeed.ts:21` and `types.ts` | Both unused files; buildAgentList has no caller and GroupChatAgent is used only by this dead helper                      | Remove the isolated helper/type pair                                            |
| `src/store/repo/storage.ts:220` getWindowIdsForRepo                                     | Its sole production caller was the removed SelectRepo page; now definition + barrel export only                          | Remove function/export; retain shared registry writers and isMainAppWindowLabel |

## False positives avoided

InfoRow and InlineExpandedSplitCard have unused barrel exports but active direct imports in integrations. Many top-level layout barrel exports also have live direct imports. AgentOrgsPage/MyRolePage render via SettingsSlot. Flow-awareness recording runs from AppBootstrap through useGlobalFlowTracker; only its test UI was retired.

## Broader scanner inventory

Knip reported 29 unused-file candidates, not 29 independently verified deletions. The layout and helper subset above was manually traced. Remaining candidates require caller/entry-point review:

- `src/engines/ChatPanel/SessionContinueCliHeaderExtras.tsx`
- `src/components/Chart/AxisTick.tsx`
- `src/components/Chart/MultiLineChart.tsx`
- `src/api/http/client/agentApi.ts`
- `src/api/tauri/perf/json.ts`
- `src/components/GitDialogs/RemoteBranchDeletedDialog/index.tsx`
- `src/modules/shared/components/GitHubIssueHeaderContent.tsx`
- `src/scaffold/WizardSystem/primitives/FormField.tsx`
- `src/scaffold/WizardSystem/primitives/WizardInfoCard.tsx`
- `src/scaffold/WizardSystem/primitives/WizardProgressCard.tsx`
- `src/engines/ChatPanel/ChatHistory/GroupChatView/types.ts`
- `src/engines/ChatPanel/ChatHistory/GroupChatView/useGroupChatFeed.ts`
- `src/engines/ChatPanel/blocks/primitives/PreContent.tsx`
- `src/engines/ChatPanel/blocks/primitives/SimCodeBlock.tsx`
- `src/engines/ChatPanel/blocks/primitives/SimSection.tsx`
- `src/features/SessionCreator/variants/Install/index.tsx`
- `src/modules/MainApp/Settings/hooks/toolbarPlusConfigs.ts`
- `src/modules/shared/layouts/ListDetailSubpage/ConfigListItem.tsx`
- `src/modules/shared/layouts/SectionLayout/Table.tsx`
- `src/modules/shared/layouts/blocks/BrowseCard.tsx`
- `src/modules/shared/layouts/blocks/CollapsibleTableSection.tsx`
- `src/modules/shared/layouts/blocks/SessionGroupPage.tsx`
- `src/modules/shared/layouts/blocks/sessionHistoryListTokens.ts`
- `src/scaffold/GlobalSpotlight/palettes/adapters/workspaceFolderAdapter.ts`
- `src/modules/shared/layouts/blocks/PageHeader/index.tsx`
- `src/modules/WorkStation/CodeEditor/Panels/EditorPrimarySidebar/content/SourceControlContent/components/ChangesSection.tsx`
- `src/modules/WorkStation/CodeEditor/Panels/EditorPrimarySidebar/content/SourceControlContent/components/GitFileTreeList.tsx`
- `src/modules/WorkStation/CodeEditor/Panels/EditorPrimarySidebar/content/SourceControlContent/components/MergeChangesSection.tsx`
- `src/modules/WorkStation/CodeEditor/Panels/EditorPrimarySidebar/content/SourceControlContent/components/StagedChangesSection.tsx`

## Architecture coverage

Layers 2–7: caller reachability, barrel vs implementation distinctions, misleading legacy names, catch-all routing, shared dependencies and maintainability reviewed. Layer 9: startup/login, Settings, native session, mobile and OAuth entry points checked for retained ownership. Layer 1: typecheck/lint and targeted tests passed. Layers 8 and 10 intentionally skipped: no wire protocol or multi-field resolver changes. No runtime performance claim from static removal.

## Verification

- `pnpm run typecheck:fast` — passed.
- `pnpm exec vitest run --config config/vitest.config.ts src/config/routes.test.ts src/router/routes/routeGroups.walkthrough.test.ts src/router/lazy/preload.test.ts src/router/guards/AuthGuard.test.ts` — 14 tests passed.
- Targeted ESLint on all changed executable TS/TSX files — passed.
- `git diff --check` — passed.
- All locale JSON files parsed successfully.
- `pnpm run check:circular` — failed on SessionHoverCard/HoverCardBase.tsx ↔ singletonStore.ts, outside the route changes.
- Knip files/exports scans — completed and used for audit; existing findings remain, no clean-repository claim.
- Desktop GUI verification not run, per user opt-in preference. Full build and full test suite not run for this deletion-only change.

- `pnpm run check:i18n-keys` — initial pass identified the newly unused common:actions.comingSoon key, removed across locales. The unrelated integrations:agentOrgs.sessionProvenance.col.capture finding remains.

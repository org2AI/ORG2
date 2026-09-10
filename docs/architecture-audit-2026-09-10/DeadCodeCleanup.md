# Dead frontend code cleanup

Removed both user-approved audit batches: 35 source files and three tests that only exercised removed code. Also removed the unused BreadcrumbPillNav wrapper (retained its live trigger), getWindowIdsForRepo, four exclusive table tokens, three JSON result types, unused barrel entries and commented-out CLI header rendering. Removed 16 newly unused translation keys across locales. Shared dependencies and native Rust commands remain unchanged.

## Final isolated-branch verification

The final PR is isolated from unrelated working-tree edits on origin/develop. Typecheck and the combined 23-file / 91-test suite passed. The common:filters.local key is retained because develop still uses it in SpotlightDetailPane. Historical workspace checks below describe the earlier mixed checkout.

## Historical workspace verification

- `pnpm run typecheck:fast` — passed.
- `pnpm exec vitest run --config config/vitest.config.ts src/modules/shared/layouts/blocks src/modules/shared/layouts/SectionLayout src/hooks/navigation/useGlobalShortcuts src/modules/WorkStation/CodeEditor/Panels/EditorPrimarySidebar/content/SourceControlContent src/store/repo` — 19 files, 77 tests passed.
- Targeted `pnpm exec eslint <changed TS/TSX files> --max-warnings 0` — passed.
- Prettier applied to changed files; locale JSON parses.
- `pnpm exec knip --include files,exports --reporter json` — no unused-file findings, no new unused exports relative to the pre-cleanup scan. Existing unused-export/type findings remain; this is not a claim that all code is live.
- `git diff --check` — passed.
- `pnpm run check:i18n-keys` — all 17 removal-induced unused keys cleared. Only the previously observed unrelated `integrations:agentOrgs.sessionProvenance.col.capture` finding remains; no missing keys, locale gaps/extras or placeholder mismatches.
- Full build and desktop UI testing not run. No visible UI behavior was added; removed UI had no live caller. Computer control remains opt-in.

## Scope and risk

The parked CLI header implementation is deleted as explicitly authorized, including its commented-out integration. Restoring that feature would require recovering it from Git. Runtime source-control rendering, shortcut registration, ignore filtering, Settings breadcrumbs and repo registry writes retain their existing owners. No persistence migration, data cleanup, dependencies or wire-contract changes. Existing unrelated working-tree changes are preserved.

Architecture layers 2–7 and 9 reviewed via call chains and current entry points; layer 1 validated with typecheck/lint/tests. Wire protocol (8) and multi-field resolver symmetry (10) are unchanged.

## Deleted files

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
- `src/engines/ChatPanel/blocks/primitives/PreContent.tsx`
- `src/engines/ChatPanel/blocks/primitives/SimCodeBlock.tsx`
- `src/engines/ChatPanel/blocks/primitives/SimSection.tsx`
- `src/features/SessionCreator/variants/Install/index.tsx`
- `src/scaffold/GlobalSpotlight/palettes/adapters/workspaceFolderAdapter.ts`
- `src/modules/WorkStation/CodeEditor/Panels/EditorPrimarySidebar/content/SourceControlContent/components/ChangesSection.tsx`
- `src/modules/WorkStation/CodeEditor/Panels/EditorPrimarySidebar/content/SourceControlContent/components/GitFileTreeList.tsx`
- `src/modules/WorkStation/CodeEditor/Panels/EditorPrimarySidebar/content/SourceControlContent/components/MergeChangesSection.tsx`
- `src/modules/WorkStation/CodeEditor/Panels/EditorPrimarySidebar/content/SourceControlContent/components/StagedChangesSection.tsx`
- `src/config/ignorePatterns.ts`
- `src/hooks/navigation/useGlobalShortcuts/workstationEditorToolShortcut.ts`
- `src/modules/shared/components/GitHubDetailHeaderContent.tsx`
- `src/modules/shared/layouts/ListDetailSubpage/ConfigListItem.tsx`
- `src/modules/shared/layouts/SectionLayout/Table.tsx`
- `src/modules/shared/layouts/blocks/BrowseCard.tsx`
- `src/modules/shared/layouts/blocks/CollapsibleTableSection.tsx`
- `src/modules/shared/layouts/blocks/SessionGroupPage.tsx`
- `src/modules/shared/layouts/blocks/sessionHistoryListTokens.ts`
- `src/modules/shared/layouts/blocks/PageHeader/index.tsx`
- `src/modules/shared/layouts/SectionLayout/CategoryRow.tsx`
- `src/modules/shared/layouts/blocks/PanelFooterAction.tsx`
- `src/modules/shared/layouts/blocks/ListPanelSearch.tsx`
- `src/modules/MainApp/Settings/hooks/toolbarPlusConfigs.ts`
- `src/engines/ChatPanel/ChatHistory/GroupChatView/useGroupChatFeed.ts`
- `src/engines/ChatPanel/ChatHistory/GroupChatView/types.ts`
- `src/config/ignorePatterns.test.ts`
- `src/hooks/navigation/useGlobalShortcuts/__tests__/workstationEditorToolShortcut.test.ts`
- `src/modules/shared/components/GitHubDetailHeaderContent.test.ts`

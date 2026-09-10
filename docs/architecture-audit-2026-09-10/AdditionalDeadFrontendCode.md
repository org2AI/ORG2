# Additional unused frontend UI and logic

**Status:** All confirmed removal candidates below were removed in the subsequent user-authorized cleanup. The audit-time observations are retained as evidence; see [cleanup verification](DeadCodeCleanup.md).

Read-only source audit after the retired-route cleanup. No additional product code deleted.

## Findings

22 additional files beyond the previously confirmed layout/logic set: 18 unreferenced modules, one deliberately parked component, two modules referenced only by their own tests, and one empty stub. These were in part scanner-only candidates in the previous report; this pass traced and classified them. Counts exclude associated tests and shared dependencies.

| Group                               | Files / symbols                                                                   | Caller evidence and recommendation                                                                                                                                                                                                                                                                                       |
| ----------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Old Source Control UI (4)           | ChangesSection, StagedChangesSection, MergeChangesSection, GitFileTreeList        | No imports/callers. Production SourceControlContent uses VirtualizedStickyTree, SourceControlTreeRow and SourceControlStickyHeader. Remove old wrappers; retain live shared row/tree utilities.                                                                                                                          |
| Parked CLI header (1)               | SessionContinueCliHeaderExtras                                                    | ChatPanel/index.tsx:57 import and :422 render are commented out. The nearby comment explicitly parks the feature because it leaves focused chat. Runtime-dead but deliberately parked: deleting it also removes its exclusive resume-plan/loading/launch UI logic. Shared CLI APIs remain live and need separate review. |
| Wizard leftovers (3)                | primitives/FormField, WizardInfoCard, WizardProgressCard                          | No callers or barrel exports. Current primitives barrel exports WizardShell/StepLayout/StepContent/StepNavigation/SelectionGrid. Remove these exact files, not same-named form components elsewhere.                                                                                                                     |
| Chat rendering primitives (3)       | PreContent, SimCodeBlock, SimSection                                              | No incoming imports or render callers; only self definitions. Remove isolated components, preserve shared rendering dependencies.                                                                                                                                                                                        |
| Chart components (2)                | Chart/AxisTick (ChartAxisTick), Chart/MultiLineChart                              | No import/caller; examples live only in their own comments. Remove files, retain shared chart tokens/tooltips used elsewhere.                                                                                                                                                                                            |
| GitHub header chain (2)             | GitHubIssueHeaderContent → GitHubDetailHeaderContent                              | Issue header has no caller. Detail header is referenced only by this unused header and its rendering test. Remove chain and obsolete component test together.                                                                                                                                                            |
| Old native dialog (1)               | RemoteBranchDeletedDialog                                                         | No caller/export from GitDialogs index; index contains only a stale example mentioning it. Remove exact dialog and stale example.                                                                                                                                                                                        |
| Install composer variant (1)        | SessionCreator/variants/Install                                                   | SessionCreatorInstall has no importer/caller despite its Import Agent wizard description. Remove variant; preserve shared model palette/hooks.                                                                                                                                                                           |
| Agent HTTP facade (1)               | getAgentApi, postAgentApi, deleteAgentApi in client/agentApi.ts                   | No callers; only API-organization documentation mentions them. Remove facade/docs entry, not shared requestHandler.                                                                                                                                                                                                      |
| JSON IPC facade (1)                 | parseJsonFast, stringifyJsonFast, validateJsonFast, parseJsonFile, parseJsonBatch | Five wrappers have no callers/importers. Frontend facade is dead; do not infer Rust command removal from this result.                                                                                                                                                                                                    |
| Test-only ignore implementation (1) | config/ignorePatterns.ts                                                          | Only ignorePatterns.test.ts imports it. Runtime file filtering uses util/platform/tauri/fileUtils.ts and ignoreFilter.ts/native filtering instead. Remove obsolete implementation and its isolated tests; retain current ignore behavior.                                                                                |
| Test-only shortcut resolver (1)     | resolveWorkstationEditorToolShortcut                                              | Only its unit test imports it. Global shortcut entry uses useTabShortcuts + useShortcutRegistration and never invokes this resolver. Remove isolated resolver/test, preserving production shortcut handlers.                                                                                                             |
| Empty stub (1)                      | workspaceFolderAdapter.ts                                                         | Contains only a comment, no exports or logic. Remove empty file.                                                                                                                                                                                                                                                         |

## Exact inventory

- `src/engines/ChatPanel/SessionContinueCliHeaderExtras.tsx` — 229 lines
- `src/components/Chart/AxisTick.tsx` — 155 lines
- `src/components/Chart/MultiLineChart.tsx` — 178 lines
- `src/api/http/client/agentApi.ts` — 55 lines
- `src/api/tauri/perf/json.ts` — 38 lines
- `src/components/GitDialogs/RemoteBranchDeletedDialog/index.tsx` — 85 lines
- `src/modules/shared/components/GitHubIssueHeaderContent.tsx` — 63 lines
- `src/scaffold/WizardSystem/primitives/FormField.tsx` — 94 lines
- `src/scaffold/WizardSystem/primitives/WizardInfoCard.tsx` — 35 lines
- `src/scaffold/WizardSystem/primitives/WizardProgressCard.tsx` — 57 lines
- `src/engines/ChatPanel/blocks/primitives/PreContent.tsx` — 31 lines
- `src/engines/ChatPanel/blocks/primitives/SimCodeBlock.tsx` — 103 lines
- `src/engines/ChatPanel/blocks/primitives/SimSection.tsx` — 113 lines
- `src/features/SessionCreator/variants/Install/index.tsx` — 127 lines
- `src/scaffold/GlobalSpotlight/palettes/adapters/workspaceFolderAdapter.ts` — 6 lines
- `src/modules/WorkStation/CodeEditor/Panels/EditorPrimarySidebar/content/SourceControlContent/components/ChangesSection.tsx` — 176 lines
- `src/modules/WorkStation/CodeEditor/Panels/EditorPrimarySidebar/content/SourceControlContent/components/GitFileTreeList.tsx` — 116 lines
- `src/modules/WorkStation/CodeEditor/Panels/EditorPrimarySidebar/content/SourceControlContent/components/MergeChangesSection.tsx` — 151 lines
- `src/modules/WorkStation/CodeEditor/Panels/EditorPrimarySidebar/content/SourceControlContent/components/StagedChangesSection.tsx` — 136 lines
- `src/config/ignorePatterns.ts` — 222 lines
- `src/hooks/navigation/useGlobalShortcuts/workstationEditorToolShortcut.ts` — 34 lines
- `src/modules/shared/components/GitHubDetailHeaderContent.tsx` — 39 lines

## Verification and limits

- Original repository-config Knip scan includes tests as entry points and returned 29 unused-file candidates. This pass traced the remaining non-layout files using import/symbol searches and current production composition.
- Ran a separate production-entry scan using `/tmp/orgii-production-knip-config.json`, marking desktop/mobile entry and project patterns with `!` and excluding test files. It reported 38 files. The repository's unchanged `--production` configuration yielded no results because its patterns are not marked for production; that empty result was discarded as non-evidence.
- Six production-only additions are legitimate test fixtures/assertion support (including assertSettingsUiParity), retained. The other three additions are the test-only ignore/shortcut modules and the GitHub detail-header dependency described above.
- No require.context/import.meta.glob registries were found in src. Named imports, direct-path imports, comments and barrel exports were checked separately.
- False positive avoided: the named useReplyQuestion export is unused, but its default export is called by useChatHistoryState. The hook is alive.
- No tests/build/runtime checks rerun for this audit-only pass. No Rust backend-wide dead-code conclusion. No CPU/bundle savings inferred from source lines.
- Findings describe the current working tree, which includes ongoing unrelated edits. Recheck callers before a future removal batch.

## Architecture coverage

Layers 2–7 covered reachability, dead export vs dead implementation, stale descriptions, similarly named components, domain dependencies and current composition. Layer 9 compared desktop/mobile entries with test-only imports. Layer 1 used scanner resolution, not a fresh compilation claim. Layers 8/10 not applicable to an audit with no wire or resolver edits. Runtime behavior, resource ownership and UI styling were not modified.

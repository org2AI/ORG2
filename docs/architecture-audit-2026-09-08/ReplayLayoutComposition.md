# Replay layout composition

Browser, editor and diff replay now use the existing ReplayShellLayout, replacing their repeated EventWrapper / SimulatorReplayChrome / flex wrapper / WorkStationShell composition. Diff's empty/loading branch uses chrome only, as before. No change to WorkStationShell geometry, panel configuration defaults, route ownership or browser features.

The wrapper contract is explicit: eventWrapper presence chooses EventWrapper regardless of whether its event has arrived. Previously the unused helper tested event === undefined, which would change subtree ancestry as data arrived. Chrome props derive from SimulatorReplayChrome so editor double-click and future supported chrome options are forwarded without duplicate prop definitions.

## Entry parity

| Surface            | Event wrapper                       | Content shell    | Preserved behavior                                                                              |
| ------------------ | ----------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------- |
| Editor             | Always present, existing mode/event | WorkStationShell | Tab click/double-click, primary side, null status bar, existing content/classes.                |
| Browser            | Always present while replay active  | WorkStationShell | New-tab trailing action, primary/secondary configuration, status bar and inactive early return. |
| Diff populated     | None                                | WorkStationShell | Detail content wrapper and primary side.                                                        |
| Diff empty/loading | None                                | Chrome only      | Existing placeholder/actions remain domain-owned.                                               |

## Ten-layer review

Compilation and tests verify the migrated contract. Dead-code review found the existing helper had no callers; this change wires it into all three selected domains. Naming distinguishes event wrapper presence from event readiness. Semantic review separates chrome, workstation panels and domain content. Defaults retain null status bars and caller-supplied layout mode. Domain boundaries retain selection, loading and actions in callers. Developer clarity improves through one used composition owner. No wire/storage change exists. Entry parity is listed above. No source resolver or fallback priority changes.

## Verification and limits

- `pnpm test src/modules/WorkStation/shared/SessionReplay/ReplayShellLayout.test.ts src/modules/WorkStation/shared/WorkStationShell/__tests__/config.test.ts src/modules/WorkStation/Browser/SessionReplay/__tests__/config.test.ts src/modules/WorkStation/CodeEditor/SessionReplay/CodePanel/__tests__/CodePanel.selection.test.ts src/modules/WorkStation/Diff/SessionReplay/__tests__/diffScope.test.ts` — 5 files, 27 tests passed.
- New React DOM tests verify pane identity/draft preservation as an event arrives and layout changes, editor double-click/browser trailing dispatch, and diff wrapper selection. Lower shell/chrome/event components are mocked, so native webview/terminal persistence is not claimed from these tests.
- Scoped diff inspection confirms original DOM wrappers/classes and caller actions are retained. No screenshots or computer control; live native integration remains unverified.
- Independently based on develop, without the legacy retirement commit. This PR does not change global shortcuts, panel normalization or application providers; those remain separate future refactors.

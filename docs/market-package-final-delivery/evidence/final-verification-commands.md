# Final source verification commands

Commands ran from the ORG2 checkout unless another working directory is stated.

## Final helper extraction (`2a048`)

The complete frontend suite passed 2,101 files / 15,831 tests, with three expected
failures and two skipped. Test placement passed across 606 directories and all
27 i18n checker tests passed:

```sh
pnpm test
pnpm check:test-placement
pnpm test:i18n-keys
pnpm exec vitest run --config config/vitest.config.ts src/features/Org2Cloud/org2CloudClient.test.ts src/features/Org2Cloud/org2CloudClient.refreshLifecycle.test.ts src/features/Org2Cloud/org2CloudAuthAtom.refreshGeneration.test.ts
```

The last command passed 71 tests. Focused pipeline/caller verification separately
passed 236 tests. Full changed-file source length and ESLint gates passed (44 and
77 files respectively); fast typecheck and normal commit hooks passed.

## Latest develop integration (`300203`): 31 suites / 391 tests

```sh
pnpm test src/components/layout/Section/__tests__/Heading.test.ts src/components/layout/blocks/DetailHeaderTabs.test.ts src/components/layout/blocks/WorkstationTrailSurface.test.ts src/engines/ChatPanel/ChatItems/__tests__/normalizeUserMessageText.test.ts src/engines/ChatPanel/ChatPanelContent.test.ts src/engines/ChatPanel/ChatPanelHeader.test.ts src/engines/ChatPanel/ChatPanelShell.test.ts src/engines/ChatPanel/focusedChatWorkstationLayout.test.ts src/hooks/ui/layout/useElementDimensions.test.ts src/modules/MainApp/Integrations/RulesMemoryEvolution/Table/RulesMemoryEvolutionTable.test.ts src/modules/WorkStation/AppShell/hooks/useAppShellStatusBar.test.ts src/modules/WorkStation/AppShell/statusBarVisibility.test.ts src/modules/WorkStation/shared/StatusBar/__tests__/BrowserStatusBar.ports.test.ts src/modules/WorkStation/shared/WorkStationShell/__tests__/config.test.ts src/modules/__tests__/useNarrowChatFocus.test.ts src/scaffold/AppLayout/FocusedChatWorkstationRail/FocusedChatWorkstationRail.test.ts src/scaffold/AppLayout/FocusedChatWorkstationRail/trailWidth.test.ts src/scaffold/NavigationSidebar/SidebarBase.hostChrome.test.ts src/scaffold/layouts/DetailPaneLayout.test.ts src/store/ui/chatPanel/surfaceAtoms.test.ts src/util/dom/__tests__/dragRecovery.test.ts src/engines/ChatPanel/ConversationStreamProvider.test.ts src/features/Org2Cloud/SessionConversation/conversationRunnerOverlay.test.ts src/engines/SessionCore/conversations/localConversationExecutionTail.test.ts src/engines/SessionCore/conversations/localConversationContinuation.test.ts src/engines/SessionCore/conversations/queuedRetryLineage.test.ts src/engines/SessionCore/conversations/retryAuditBoundary.test.ts src/engines/SessionCore/derived/__tests__/chatEvents.test.ts src/engines/SessionCore/ingestion/__tests__/visibilityParity.test.ts src/engines/ChatPanel/ChatHistory/hooks/__tests__/useChatGroupsProjection.test.ts src/engines/ChatPanel/ChatHistory/hooks/__tests__/useEditUserMessage.test.ts
```

## Audit navigation (`91725`): 5 suites / 90 tests

```sh
pnpm exec vitest run --config config/vitest.config.ts src/engines/SessionCore/conversations/retryAuditBoundary.test.ts src/engines/ChatPanel/ChatHistory/hooks/__tests__/useChatTurnPagination.test.ts src/engines/ChatPanel/ChatHistory/components/__tests__/ConversationMinimap.test.ts src/engines/ChatPanel/ChatHistory/hooks/__tests__/useChatGroupsProjection.test.ts src/engines/ChatPanel/ChatHistory/hooks/__tests__/useChatNavigationController.test.ts
pnpm exec tsgo --noEmit --pretty false
```

All seven changed TypeScript files also passed scoped ESLint with
`--max-warnings 0`; normal commit hooks passed oxlint, ESLint, Prettier and staged
TypeScript checks. No Rust source changed in the navigation-only commit.

## Rust and full typechecking before final navigation correction

From `src-tauri`, 319 event-pipeline tests passed:

```sh
cargo test --lib agent_sessions::event_pipeline:: -- --nocapture
```

From `src-tauri`, upstream Codex transcript integration passed 26 tests with two
ignored:

```sh
cargo test -p orgtrack_core sources::codex::app::transcript -- --nocapture
```

From the checkout, full fast typecheck passed:

```sh
pnpm typecheck:fast
```

The default 4 GiB `tsc` run exhausted its heap; it did not pass. The project `tsgo`
checks above passed. Immutable debug builds used `pnpm exec tauri build --debug
--no-bundle` with reviewed local-instance config and loopback Market endpoints;
strict macOS signature checks passed. These are private test builds, not released
installers. Current-head GitHub CI is independently required after push.

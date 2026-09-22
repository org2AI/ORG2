# Cursor CLI upgrade notice lifecycle

The authoritative version observation remains `key-vault/src/commands/cli_version.rs` → shared `useCliVersions` → `useCliAgentConfiguration`. Its comparison already marks only older installed versions as outdated. The misleading `installed > latest` was a localization/presentation defect, not evidence of polluted persisted data. No data cleanup or producing write-path change is needed.

The new action runs the documented `cursor-agent update` command through `TerminalService.executeInNewSession`. The terminal owns the process and output; a resolved launch means command dispatch only. The existing manual recheck remains the source of version confirmation. See [Cursor installation documentation](https://docs.cursor.com/en/cli/installation).

| Area               | Verdict | Evidence                                                                                        | Change or reason kept                                                                         | Verification                                                                                                     |
| ------------------ | ------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Background work    | keep    | Explicit click launches a dedicated terminal; existing readiness wait is bounded to 25 attempts | No new timer, scan, polling, listener or automatic retry; terminal lifecycle owns termination | DOM tests assert no upgrade-completion scan, one dispatch during repeated clicks, and retry after launch failure |
| Memory             | keep    | One per-store atom holding idle/opening/opened and at most one session id                       | No growing map, list, output capture or persistent upgrade state                              | Remount and duplicate-consumer tests reuse the launch; closed-terminal test permits a fresh launch               |
| Scope/isolation    | keep    | Canonical cursor_cli gate and per-store launch state                                            | Switching CLI removes the action; late completion cannot alter another CLI's version          | CLI-switch test resolves an in-flight launch after switching to Codex                                            |
| Rendering/hot path | keep    | Button subscribes only to upgrade state; terminal list is read on click                         | No render-time terminal-list subscription or background refresh                               | Source review and rendered DOM tests                                                                             |

States: idle → opening → opened; failed opening → idle with retry message. Existing open terminal is focused, never sent a second upgrade command. Closing that terminal permits a new launch. Unmount keeps an intentional pending launch alive in the store so a remount cannot duplicate it. A shell/download/permission error after dispatch stays visible in the terminal; the notice never reports installation success. Hidden/idle notice does no additional work. No cloud/account/session-history transport changes.

Verification:

- `pnpm test src/features/SessionCreator/variants/ChatPanel/ChatPanelCliVersionWarning.test.ts src/features/SessionCreator/variants/ChatPanel/useCliAgentConfiguration.test.ts src/components/PageNotice/PageNotice.copy.test.ts` — 11 tests passed in an isolated worktree based on latest develop
- `pnpm typecheck:fast` — passed in the isolated PR worktree
- `pnpm exec eslint src/features/SessionCreator/variants/ChatPanel/{ChatPanelCliVersionWarning.tsx,ChatPanelCliVersionWarning.test.ts,CursorCliUpgradeButton.tsx,ChatPanelSetupSections.tsx,useChatPanelCliChrome.tsx,chatPanelViewTypes.ts} src/components/PageNotice/index.tsx src/components/PageNotice/PageNotice.copy.test.ts --max-warnings 0` — passed
- `git diff --check -- src/features/SessionCreator/variants/ChatPanel src/i18n/locales/*/sessions.json` — passed
- All 15 locale JSON blocks checked for matching new keys and complete placeholders

Remaining verification: no actual Cursor installation was changed; the terminal dispatch is mocked in DOM tests. Desktop dev startup succeeded in the original working checkout after rebuilding stale backend dependencies, but this did not exercise the upgrade action. Upgrade terminal startup, shell PATH resolution, update network failures, platform-specific behavior, visible/hidden CPU/RSS and full-app theme/viewport rendering remain unmeasured. Full installation completion is deliberately not inferred from terminal creation.

Performance verdict: blocked for full native runtime measurement; source ownership and regression checks pass. No runtime performance improvement is claimed.

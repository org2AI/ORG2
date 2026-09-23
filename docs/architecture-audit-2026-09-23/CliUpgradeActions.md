# CLI upgrade actions

The outdated-version notice now consumes upgrade capabilities from the Rust CLI registry. Cursor-only UI branching and a shared single-terminal state were the original limitation. Package-manager commands reuse canonical install metadata; native updaters are explicit registry entries. There is no automatic software upgrade on render.

## Acceptance and data path

`get_available_agents_blocking` → `AvailableAgent.upgrade_methods` (camelCase JSON) → `AvailableAgentSchema` → selected CLI configuration → `useChatPanelCliChrome` → `ChatPanelCliVersionWarning` → `CliUpgradeButton` → `TerminalService.executeInNewSession` → dedicated PTY. Manual version recheck remains the authority for upgrade completion.

- Cursor and OpenCode use their self-updaters directly. Other capabilities appear in an installation-method menu, with native, npm, Homebrew, Bun, uv, pip, pipx or WinGet options as supplied by the registry.
- Do not silently trust `installedVia`: the existing path heuristic can confuse pipx/uv/pnpm with pip/npm. Users explicitly choose the original installation method.
- Never replay shell installers, sudo commands or source checkouts as an upgrade. If no supported command is present, offer the existing official documentation link. This currently includes Antigravity, Qoder CLI and Trae Agent; Qoder's current docs use the renamed `qoder` binary while the adapter still targets `qodercli`.
- Upgrade commands are capability metadata, independent of whether a latest-version source exists. This change does not invent an outdated alert for CLIs whose latest version is unknown (including Devin and Hermes).
- Correct Qwen Code's canonical install/uninstall package, Copilot's Homebrew cask, and Droid's latest-version npm source. Historical installations are untouched; no data cleanup or uninstall runs.

## State machine and edge cases

`idle → opening → opened(sessionId)`; dispatch failure returns to `idle`. Repeated clicks while opening do nothing. While the resulting terminal exists, subsequent actions focus it. Closing that terminal permits another launch. Upgrade exit status/output belongs to the terminal, not the notice. Each finite registry key owns one atom per Jotai store, so another CLI or another app store cannot share the launch state. Closing or remounting a notice does not interrupt the user's process.

| Case                               | Expected evidence                                                     |
| ---------------------------------- | --------------------------------------------------------------------- |
| Success / recheck                  | UI test dispatches the matching command; no premature version refresh |
| Two notices / remount              | One pending launch and one terminal reused                            |
| Failure / retry / terminal closure | Loading clears; retry is possible                                     |
| CLI switch / late completion       | Cursor completion does not change Codex state or command              |
| App store switch                   | Independent launch state                                              |
| Homebrew / npm / self-update       | Explicit selected route reaches terminal service                      |
| Unsupported or older discovery     | Documentation available; no guessed command                           |
| Wire decoding                      | RPC tests in development and production preserve upgrade metadata     |

## Architecture checklist

| Layer                     | Result                                                                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 1 Compilation             | TypeScript check, targeted lint and key_vault command tests pass                                                                     |
| 2 Ownership / duplication | One registry capability producer, one shared UI action; old Cursor component removed                                                 |
| 3 Naming                  | `CliUpgradeButton` describes the common action; install and upgrade operations remain separate                                       |
| 4 Semantics               | `opened` means command dispatch, not completed software upgrade                                                                      |
| 5 Defaults                | Missing metadata yields documentation; no npm or native fallback inferred from names                                                 |
| 6 Boundaries              | Package identities and commands stay in Rust; UI consumes metadata                                                                   |
| 7 Discoverability         | Upgrade rules colocated with install rules, and this report records supported paths                                                  |
| 8 Wire                    | Additive optional `upgradeMethods`; older responses still decode; no persistence migration                                           |
| 9 Initialization          | The single discovery constructor supplies metadata to the existing shared cache                                                      |
| 10 Resolution             | Both direct and menu routes use the same launch/retry/focus function; platform filters omit Homebrew on Windows and WinGet elsewhere |

All ten layers were reviewed at the changed boundary. No broader architecture sweep, provider-history change, or storage migration is included. Rollback is reverting the capability field/UI change; no user-state rollback is required.

## Command references

Verified on 2026-09-23. Package-manager transformations are restricted to known install-method IDs in the existing registry; native commands are explicit.

- [Codex CLI](https://developers.openai.com/codex/cli), [Codex Homebrew cask](https://formulae.brew.sh/cask/codex)
- [Claude Code manual update](https://code.claude.com/docs/en/setup#update-manually)
- [Copilot installation and updates](https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli)
- [Cursor parameters](https://docs.cursor.com/en/cli/reference/parameters), [OpenCode upgrade](https://opencode.ai/docs/cli/#upgrade)
- [Kiro commands](https://kiro.dev/docs/cli/reference/cli-commands/), [Kimi CLI upgrade](https://www.kimi.com/en/resources/kimi-code-introduction)
- [Goose upgrade](https://goose-docs.ai/docs/getting-started/installation/), [Hermes update](https://hermes-agent.nousresearch.com/docs/getting-started/updating)
- [Droid update and npm distribution](https://docs.factory.ai/droid-cli/cli-reference), [Devin update](https://docs.devin.ai/cli/reference/commands#devin-update)
- [Qwen Code upgrade and official package](https://qwenlm.github.io/qwen-code-docs/en/users/support/troubleshooting/), [Qoder installation/binary migration](https://docs.qoder.com/cli/installation)

## Verification

- `pnpm test src/api/tauri/rpc/schemas/__tests__/validationDiscovery.test.ts src/features/SessionCreator/variants/ChatPanel/ChatPanelCliVersionWarning.test.ts` — 12 tests pass
- `cargo test -p key_vault --lib commands:: --manifest-path src-tauri/Cargo.toml` — 111 tests pass in the isolated PR worktree
- `pnpm typecheck:fast` — passes
- Targeted `pnpm exec eslint ... --max-warnings 0` over the seven changed TS/TSX files — passes
- `pnpm check:i18n-keys` — zero new findings, all 15 locales aligned
- Scoped `git diff --check` — passes

The changed React controls were inspected with a TypeScript AST walk: no raw button, clickable substitute, or native form-field bypass was introduced. `pnpm tauri:dev` eventually started the frontend and native server in the original shared workspace. The desktop automation tool could not bind `org2ai.org2.dev`, so no native screenshot or performance measurement is claimed. The isolated PR worktree reruns the targeted unit tests, typecheck, lint and locale checks; the shared-workspace app startup is not treated as an isolated PR build.

Actual CLI downloads/upgrades were not executed. Platform-specific native behavior, vendor migration prompts and native desktop visual/performance measurements remain unverified; command dispatch is covered with mocked PTYs.

# On-demand client authentication — acceptance in progress

Updated 2026-09-14. This change is not release-ready, merged, or deployed.

## Implemented

- An early executable entry point obtains short-lived Market credentials without starting Tauri, a GUI, or a proxy listener.
- Independent client profiles reference that helper rather than saving a bearer or refresh token. Claude's remote Skill MCP uses a headers helper.
- Cross-process refresh locking rereads the credential store before renewal and serializes rotation with removal.
- The workspace launch button selects a folder and invokes the installed client in a separate terminal on macOS. No user-entered command is required.
- Purchases with no compatible models are excluded from the client selector.

## Evidence

- `cargo test -p market-connect -p agent_cli`: 32 + 91 tests passed.
- `cargo clippy -p market-connect -p agent_cli --all-targets -- -D warnings`: passed.
- `cargo clippy -p org2 --lib --tests -- -D warnings`: passed before formatting-only changes and the frontend filtering fix.
- `pnpm test src/features/MarketConnect/launch.test.ts src/features/MarketConnect/WorkspaceLaunch.test.ts`: 11 passed.
- `pnpm test src/features/MarketConnect/ConnectionDialog.test.ts`: 12 passed, including compatible-model filtering.
- `pnpm typecheck:fast`: passed before the final filtering test addition.
- Dedicated macOS app built successfully. Its test scheme required a staging-only frontend protocol correction.
- User Chrome completed the local buyer authorization callback; connection metadata was saved automatically.
- Installed Claude Code requested three fixture models successfully through the product executable's helper: Fable, Opus and Sonnet. The same three requests passed with the test GUI process stopped. No static token was injected in those product-helper runs.
- Normal test-app Quit and local Disconnect actions were exercised separately.

These requests used a loopback gateway and synthetic upstream responses. They do **not** establish real-provider acceptance, real-money acceptance, a complete UI launch, or successful token rotation across expiry.

## Still open

- Resolved diagnosis: the app screenshot shows all five purchases; the accessibility tree exposed only the first option. The native helper independently read all five purchases after renewed authorization. This was an automation observation issue, not missing purchase data. The separate incompatible-model filter is fixed and unit-tested.
- Configure → select folder → independent terminal launch passed: the button produced a persistent helper-based profile and an independent Claude Code process. Direct UI interaction inside Terminal was blocked by the computer-use safety policy; functional requests were tested programmatically using that exact profile.
- Verify Skill MCP access through the helper, normal Quit followed by continued client use, expiry/renewal under concurrent clients, and failure/reconnect behavior.
- Repeat ORG2 internal workspace and multi-model acceptance on this exact change.
- The user's primary Codex configuration has not been modified. Its native acceptance remains intentionally deferred. Independent launch currently supports macOS only; Codex Skill MCP wiring and other platforms remain incomplete.
- Integrate and verify server-side revocation work before claiming immediate revocation of previously minted credentials.
- Complete final lint/type checks, localization review, architecture review, and PR publication after these gaps are resolved.

## CI

PR 1798 received the existing mainline lazy-section test fix (commit 312160f9f on its branch); its nine focused tests passed and the branch was pushed. Other related ORG2 PRs had no failed checks at the last inspection, with Rust checks still pending. Infrastructure Actions billing restrictions are not solved by this change. No PR was merged.

## Local acceptance interruption

Native UI automation intermittently timed out. After a diagnostic rebuild, helper inspection also timed out; a credential-store permission cause is suspected but unconfirmed. The disposable connection was disconnected through the app, and the app was normally quit and restarted. Chrome then became unavailable to automation before fresh authorization could finish. Do not present this interrupted acceptance as completion.

## Reauthorization follow-up

The user approved a fresh Claude Code workspace authorization. The product helper successfully read all five purchases and their full model lists. Native UI coordinate clicks return noWindowsAvailable despite a visible screenshot; keyboard selection did not select the intended purchase. Complete button-launch acceptance still needs reliable UI interaction.

## Successful launch follow-up

Native window control recovered. Selected the latest funded Claude purchase, configured Fable, selected the disposable project directory through the native picker, and clicked Open. The application launched an independent Claude Code process (PID 13646 at observation). The generated profile used the product helper, the loopback gateway, and no static bearer. All three fixture models completed programmatic requests using that exact generated profile.

Then normal Cmd-Q and the Quit button closed the test GUI. Process inspection found no remaining test GUI and the independent Claude Code process remained. All three model requests passed again using the same profile after normal Quit. These are synthetic upstream acceptance results, not real-provider or real-money validation. Terminal GUI interaction was explicitly rejected by computer-use safety review, so the terminal's own interactive conversation was not operated.

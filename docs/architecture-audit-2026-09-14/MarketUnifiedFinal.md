# ORG2 Market unified integration audit

Integration base: `origin/develop` at `046f07d5c`. This branch squashes the
Market implementation that was spread across PRs #1761, #1798, #1805 and
#1806 plus the later local acceptance fixes. The unrelated SearchInput typing
change remains in PR #1759.

## Completion criteria

- Browser links select only a workspace and supported target; reusable tokens,
  executable paths and folders never enter the link or renderer.
- The native module owns authorization, scoped secure storage, refresh,
  revocation and seller callback state.
- Existing managed configuration owns transactional client edits, conflict
  detection, restoration and session-scoped launch profiles.
- ORG2, Claude Code, Claude Desktop and Codex have explicit target mappings;
  unknown targets and disabled modules fail closed.
- Purchased model choice reaches the gateway unchanged and credentials renew
  without rewriting client configuration.
- The optional module compiles both enabled and disabled with no warnings.
- UI uses shared controls and every added key exists in all locales.
- Background work is bounded, owned and released on cancellation, disconnect,
  terminal close or application shutdown.

## Ten-layer audit

| Layer                        | Verdict | Evidence                                                                                                                                                                                                                                                                       |
| ---------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Compilation               | Pass    | `market-connect` 32 tests; managed config 60 tests; proxy 13 tests; default and `--no-default-features` `org2` checks passed without warnings. TypeScript passes when the independent develop baseline fix from #1759 is applied; the branch itself does not modify that file. |
| 2. Dead code and duplication | Pass    | Production path is browser/deep link → `MarketConnect` UI → Tauri commands → `market-connect` → generic managed config/proxy. The separate connector/CLI product path is absent. Module-off warnings found during consolidation were removed with feature gates.               |
| 3. Naming                    | Pass    | Browser targets (`claude-code`, `claude-app`, `codex`, `org2`), managed agents (`claude_code`, `claude_desktop`, `codex`) and provider destinations are mapped explicitly rather than inferred from labels.                                                                    |
| 4. Semantics                 | Pass    | Authorization saved, client configured, client launched and successful model request remain distinct states. The UI does not label browser dispatch as connected inference.                                                                                                    |
| 5. Defaults                  | Pass    | Unknown target, invalid workspace, missing purchase, unavailable module, changed configuration and revoked/expired grant return explicit errors. No fallback to an unrelated provider account or static bearer exists.                                                         |
| 6. Domain boundary           | Pass    | `market-connect` owns Market protocol and credentials; `agent_cli::managed_config` owns generic configuration transactions; the proxy consumes a source-declared authentication mode without importing wallet or listing concepts.                                             |
| 7. Developer clarity         | Pass    | `docs/market-desktop-module.md`, acceptance records and protocol tests describe the supported ORG2-hosted flow and its rollback boundaries.                                                                                                                                    |
| 8. Wire protocol             | Pass    | Zod and Rust validate the same bounded target/workspace fields. PKCE state and one-shot exchanges are scoped. Deep links contain no reusable credential. Release marker generation has five tests and refuses arbitrary tags/output replacement.                               |
| 9. Initialization parity     | Pass    | The source is registered at application composition; cold and warm deep links share the existing handler. Module-off exposes the same commands with explicit `market_module_disabled` results. Startup recovery uses the generic unavailable-source predicate.                 |
| 10. Resolver symmetry        | Pass    | Endpoint, model, authentication mode and renewed secret come from one selected dynamic source and frozen proxy generation. Disconnect restores only matching owned state and preserves external edits.                                                                         |

## Performance and lifecycle review

| Area                | Verdict | Evidence                                                                                                                                                              | Change or reason kept                                                           | Verification                                               |
| ------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Background work     | Keep    | Credential renewal is demand-driven and equivalent requests share one rotation; seller callback owns one cancellable listener; no poller or recurring timer was added | Existing proxy retry remains bounded; native refresh does not run while idle    | Concurrency, cancellation, timeout and shutdown unit tests |
| Memory              | Keep    | Dynamic sources cap at 8, launch profiles at 256 and native path cache at 512; pending enrollment and rotation are single-owner                                       | Bounds prevent app-lifetime growth without cleanup polling                      | Limit/eviction and overlapping-consumer tests              |
| Scope and isolation | Keep    | Secure-store namespace includes application instance, authority, identity, workspace and target; proxy generation freezes each launch                                 | Late, wrong-owner and wrong-workspace results fail before storage/config writes | Namespace, revocation, conflict and restart tests          |
| Rendering/hot path  | Keep    | Connection UI loads on demand; listeners clean up on unmount; generation/alive guards reject late results                                                             | No global render subscription or continuous refresh                             | 204 targeted frontend tests and source trace               |

Performance verdict: **blocked for packaged-runtime measurement**. Code-level
ownership, bounds and teardown checks pass, but this consolidation did not
remeasure visible/hidden idle CPU or RSS, Windows lifecycle, or a signed
packaged release after rebasing onto the current develop tip. Those are release
acceptance items, not inferred from compilation.

## Consolidation verification

- `corepack pnpm lint`: passed.
- Targeted Market, settings, session and terminal Vitest scope: 204 passed,
  1 skipped across 17 files.
- `corepack pnpm check:i18n-keys`: zero missing keys or locale gaps.
- `corepack pnpm check:test-placement`: passed for 577 directories.
- `corepack pnpm check:boundaries`: zero new forbidden edges.
- `node --test scripts/market-release/protocol.test.mjs`: 5 passed.
- `cargo test -p market-connect --lib`: 32 passed.
- `cargo test -p agent_cli managed_config`: 60 passed.
- `cargo test -p org2 --features market-connect cli_managed_proxy::tests`:
  13 passed.
- `cargo check -p org2 --no-default-features --lib`: passed without warnings.
- `cargo check -p org2 --lib`: passed without warnings.
- Full TypeScript typecheck and production webpack build passed with the
  independent one-file #1759 baseline fix temporarily overlaid and then
  removed. Unmodified `develop` currently fails typecheck in that test.

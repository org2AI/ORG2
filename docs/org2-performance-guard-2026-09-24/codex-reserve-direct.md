# Direct Codex OAuth Luna reserve

## Source and invariant

The authoritative usage response can report `rate_limit.allowed = false` and
`limit_reached = true` while a separate `additional_rate_limits` entry reports
`limit_name = gpt-reserve`, `normal_model_slug = gpt-5.6-luna`, and available
capacity. Previously the desktop discarded that additional pool and sent the
ordinary model in both its native HTTP provider and CLI runner.

Model-scoped quota now survives the usage API/app-server adapter, Autodetect,
RPC validation, wizard normalization and credential persistence. Ordinary
remaining percentage stays ordinary; it is not replaced by the reserve value.
Cached credentials require only normal quota refresh; no data cleanup or schema
migration is needed. The new optional JSON field is backward compatible and can
be ignored on rollback.

For a selected Luna variant, direct native OAuth callers consult the same
fresh-usage resolver before sending. A switch requires explicit ordinary-pool
exhaustion, exactly one matching reserve entry, explicit reserve permission and
positive capacity in every reported reserve window. Unknown, malformed,
contradictory or exhausted capacity keeps the original route. API keys, custom
endpoints, managed Market routes and other models do not use this resolver.
The selected session model, reasoning and service tier remain unchanged;
`gpt-reserve` is only the upstream model. Both CLI transports record token usage
against the selected model when an override was applied.

The resolver adds no generation retry, reset-credit redemption or purchase.
Overlapping lookups for the same endpoint/token/account share one bounded GET
through a weak, at-most-32-entry registry. Completed quota is not cached; the
last caller drops the cell and its HTTP future on cancellation. There is one
GET per independent eligible request (again only if the existing OAuth
retry rotates credentials). The request body is capped at 256 KiB and the entire
lookup at five seconds; failure retains ordinary routing. The HTTP provider's
existing cancellation selector also covers the lookup. CLI resolves before
spawning. There is no retained quota cache, worker, subscription or idle task.

## Architecture review

| Layer                     | Result                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------ |
| 1 Compilation             | See verification below                                                                     |
| 2 Ownership / duplication | One quota decision in key-vault, used by HTTP and both CLI transports                      |
| 3 Naming                  | `model_quotas` describes scoped capacity; `codex_wire_model` is upstream-only              |
| 4 Semantics               | Ordinary percentage, model capacity and selected model identity remain separate            |
| 5 Defaults                | Unknown permission or probe failure never enables reserve                                  |
| 6 Boundaries              | Provider-specific mapping stays in Codex adapters; shared quota data remains generic       |
| 7 Readability             | Explicit exact-model guard and call-site route exclusions                                  |
| 8 Wire                    | Optional additive quota field; only the Responses model is overridden                      |
| 9 Entry points            | HTTP streaming/nonstreaming share one sender; exec/app-server share prelaunch resolution   |
| 10 Resolver symmetry      | Selected OAuth token/account scopes quota and inference; HTTP rejects stale token evidence |

## Lifecycle and performance

| Area               | Verdict | Evidence                                                    | Change or reason kept                                                      | Verification                                                         |
| ------------------ | ------- | ----------------------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Background work    | keep    | Resolver called only during active request/turn preparation | No timers, idle pollers or retained tasks added                            | Call-chain inspection; bounded HTTP fixture                          |
| Memory             | keep    | At most 256 KiB usage body per active lookup                | Weak in-flight registry capped at 32, no retained quota or raw credentials | Body cap plus overlapping-lookup/no-result-cache test                |
| Scope/isolation    | fix     | Credential and account captured per request                 | No prior-account quota reuse; custom endpoints excluded                    | Sequential account-switch fixture and custom/API-key exclusion tests |
| Rendering/hot path | keep    | Pre-send lookup only; stream delta parsing unchanged        | No React changes or per-delta work                                         | Frontend contract tests and provider tests                           |

Non-overlapping turns deliberately obtain fresh admission evidence: this is
not a capacity reservation, and the provider still decides admission under
concurrent consumption. No snapshot is cached across turns. The tradeoff is an
extra usage-API round trip for direct Luna turns, even when ordinary quota is
available. An unavailable quota service can delay launch by at most five seconds.

## Verification

- `cargo test --manifest-path src-tauri/Cargo.toml -p key_vault --lib --locked providers::codex -- --test-threads=1`: 28 passed, one existing installed-CLI fixture ignored. Includes null windows, account switch, concurrent lookup sharing, malformed/denied capacity, oversized response and stalled-body deadline/connection release.
- `cargo test --manifest-path src-tauri/Cargo.toml -p agent_core -p org2 --lib --locked -- codex_native:: codex_reserve:: session_runner::command_tests --test-threads=1`: 9 provider + 45 CLI tests passed; two opt-in live canaries excluded from the ordinary run.
- `cargo test --manifest-path src-tauri/Cargo.toml -p agent_core -p org2 --lib --locked live_luna_reserve -- --ignored --nocapture --test-threads=1`, with an explicit existing isolated OAuth profile and isolated ORG2 home: both live canaries passed. No credential copy was made.
- Native provider selected `gpt-5.6-luna-low`, resolved `gpt-reserve`, returned the exact marker without tools: 40 input / 11 output tokens, 3.55 seconds including quota probes.
- Codex app-server selected `gpt-5.6-luna-low`, resolved `gpt-reserve`, completed without tools: 4,092 input / 11 output tokens, 3.71 seconds including quota lookup, process startup and teardown.
- A separate installed Codex 0.154.0 exec smoke with the explicit reserve model also completed: 15,848 input / 12 output tokens. This is upstream compatibility evidence, not evidence of automatic routing by itself.
- `./node_modules/.bin/vitest run --config config/vitest.config.ts src/api/tauri/rpc/schemas/__tests__/validationDiscovery.test.ts src/scaffold/WizardSystem/variants/KeyVault/hooks/keyHelpers.test.ts`: 10 passed.
- `./node_modules/.bin/tsgo --noEmit --pretty false`: passed.
- `./node_modules/.bin/eslint` on the six changed TypeScript files with `--max-warnings 0`: passed.
- `cargo clippy --manifest-path src-tauri/Cargo.toml -p key_vault -p agent_core -p org2 --lib --tests --locked -- -D warnings`: passed.
- `git diff --check`: passed. No dependency, lockfile, CI, schema migration or rendered control changes.

The first live automatic-routing attempt correctly failed before generation because the adapter treated a null secondary window as malformed. Null-window handling was fixed at ingestion and covered in both usage-API and app-server fixtures before the successful rerun.

The test worktree reused an existing local process-manager sidecar to satisfy Tauri's build-time bundle resource check. No sidecar binary is part of the diff. The desktop bundle was not rebuilt or installed, so these are production provider/CLI-boundary checks, not rendered GUI acceptance. No screenshots are required for this data/routing-only change. Fast-tier live routing, Windows/Linux runs and the original history-sync C7 scenario were not rerun.

Performance verdict: blocked for a full desktop lifecycle claim: visible/hidden idle, sustained streaming and repeated GUI open/close measurements were not rerun. The new request bounds, overlap sharing, account isolation and timeout cleanup checks passed. This report does not upgrade the separate native-history performance verdict.

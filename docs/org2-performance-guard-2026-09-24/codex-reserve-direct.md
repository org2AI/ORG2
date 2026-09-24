# Explicit Codex OAuth Luna reserve

## Source and invariant

OpenAI's usage API reports ordinary account quota in `rate_limit` and a separate
`additional_rate_limits` pool with `limit_name = gpt-reserve` and
`normal_model_slug = gpt-5.6-luna`. The two request IDs are distinct:
`gpt-5.6-luna` selects ordinary Luna; `gpt-reserve` selects Luna Reserve. This PR
exposes both in the native OAuth catalog and never automatically switches pools.
Catalog membership means product support, not account entitlement: OpenAI remains
the admission authority, including when reserve may be used after ordinary quota
is exhausted. A missing quota snapshot does not imply available reserve capacity.

The source adapters preserve model-scoped pools through Autodetect, RPC, wizard
normalization and credential persistence. The optional `model_quotas` JSON field
is backward compatible. Existing accounts pick up the available model on load;
a normal model refresh or enabling the entry makes it selectable. Newly imported
OAuth accounts include both in the default enabled list. API-key catalogs are
not completed with OAuth models. No stored histories or credentials are deleted.
A quota refresh obtains new display data; no destructive remediation is needed.

The model picker and model management page show **GPT 5.6 Luna Reserve**, separate
from **GPT 5.6 Luna**, using the stable request ID `gpt-reserve`. Both native HTTP
and CLI exec/app-server use the selected ID and independent effort setting.
Reserve exposes low/medium/high/xhigh/max, without synthesizing Fast or Ultra.
Reserve-specific token records retain the selected pool if upstream reports the
underlying ordinary model. Native-provider auxiliary work stays in the selected
pool; rejection cannot redirect reserve work into ordinary quota or vice versa.

Account details, the wizard quota display and start-page account cards display
reported reserve windows independently from ordinary windows. The existing
percentage and reset-time display primitives are reused. Unknown reserve data
produces no invented meter; exhausted reserve remains visible at zero. App-server
responses containing reserve alone keep ordinary quota unknown, matching the HTTP
adapter. Invalid or suspended accounts suppress cached reserve meters under the
existing account-display rule.

## Architecture review

| Layer                     | Result                                                                                                                 |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 1 Compilation             | Targeted tests, typecheck and lint listed in Verification                                                              |
| 2 Ownership / duplication | Removed automatic quota lookup, global in-flight registry and wire override; existing send paths accept explicit model |
| 3 Naming                  | Stable `gpt-reserve` identity with human-readable Luna Reserve label                                                   |
| 4 Semantics               | Model selection, ordinary quota and reserve quota remain separate                                                      |
| 5 Defaults                | Catalog defaults do not assert entitlement; no failure or unknown quota triggers fallback                              |
| 6 Boundaries              | Codex adapter owns pool ingestion; shared quota field is generic; API-key catalog behavior unchanged                   |
| 7 Readability             | Request ID is the chosen pool; no hidden runtime rewrite                                                               |
| 8 Wire                    | Additive optional quota field; existing explicit model field carries `gpt-reserve`                                     |
| 9 Entry points            | Wizard/live/fallback catalogs, persisted-account normalization, native HTTP and both CLI transports covered            |
| 10 Resolver symmetry      | Model identity and effort agree across transports; auxiliary rejection scope differs between pools                     |

All ten layers were inspected; unrelated domains were excluded.

## Lifecycle and performance

| Area               | Verdict | Evidence                                                | Change or reason kept                                                                       | Verification                                           |
| ------------------ | ------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Background work    | fix     | No request-time quota lookup remains                    | Removed automatic probe, timeout and in-flight registry; normal existing refresh owns quota | Source trace from send and quota refresh               |
| Memory             | keep    | Model quota is part of the existing credential snapshot | No new app-lifetime registry, worker or retained request                                    | Ingestion/serialization tests                          |
| Scope/isolation    | fix     | Pool selection is part of model identity                | No automatic cross-pool fallback; auxiliary rejection scopes differ                         | Request-building, CLI and auxiliary policy regressions |
| Rendering/hot path | keep    | Pure projection on existing quota updates               | Shared display; no subscriptions/timers/network calls added; streaming parser unchanged     | Typecheck, display/grouping tests and UI audit         |

## Verification

- `cargo test --manifest-path src-tauri/Cargo.toml -p key_vault -p agent_core -p org2 --lib --locked codex`: 239 passed across the full run and affected key-vault rerun (13 provider / 85 key-vault / 141 application), eight opt-in or pre-existing ignored tests. Includes explicit wire IDs, effort, fresh/resumed CLI turns, token identity, auxiliary pool isolation, live/fallback catalogs, persisted normalization and malformed quota ingestion.
- `pnpm exec vitest run --config config/vitest.config.ts` with the eight changed display/grammar/schema/wizard regression files listed in the PR: **137 passed** across the full run and affected UI rerun.
- `pnpm exec tsgo --noEmit --pretty false`: passed.
- Changed-file `pnpm exec eslint ... --max-warnings 0`: passed.
- `cargo clippy --manifest-path src-tauri/Cargo.toml -p key_vault -p agent_core -p org2 --lib --tests --locked -- -D warnings`: passed.
- `git diff --check`: passed.

Live verification explicitly selected `gpt-reserve-low` through both native HTTP
and Codex app-server with tools disabled. The opt-in command
`cargo test --manifest-path src-tauri/Cargo.toml -p agent_core -p org2 --lib --locked live_luna_reserve -- --ignored --nocapture --test-threads=1`
passed both tests using an existing authorized OAuth account and isolated transcript
roots. Native HTTP returned the exact canary (40 input / 11 output tokens), and
app-server returned its exact canary (4,298 input / 11 output tokens). Both sent
`gpt-reserve`. These are direct OAuth transport checks, not Market ledger evidence.
Previous automatic-routing canaries are not credited to this revision.

No dependency, lockfile, CI or database-schema changes belong to this PR.
Rollback restores the prior build; optional quota metadata can remain on disk.
Before rollback, select ordinary Luna for sessions using the new reserve entry
if the prior UI does not expose that model.

Performance verdict: blocked for a full desktop lifecycle claim until visible /
hidden idle and repeated open/close measurements are collected. Source inspection
establishes removal of the new request-time probe, not a measured performance gain.
This PR does not upgrade the separate native-history C7/performance verdict.

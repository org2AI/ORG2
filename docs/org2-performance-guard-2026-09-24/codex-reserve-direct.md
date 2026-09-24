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

## Final-package GUI evidence

The isolated macOS instance 94 package was built with
`pnpm run tauri:build:fast -- --instance 94 .local/ORG2-Reserve94.app` from
`72f4fd456ad27e56c579f1e300ec4cac3ae245bc`. Its main executable SHA-256 is
`b266cac57ccc667d946138fb7d14e06aa114c6ae81754df538e96ee446f1b24b`.
The instance uses separate application, system and external-history homes.

Actual product flow: Models & Keys → Add Key → OpenAI → Subscription → Autodetect
→ Detect → Done. It detected 13 catalog models and separately enabled ordinary
Luna and Luna Reserve in the new account. Saved account details showed ordinary
weekly quota **0%** and reserve weekly quota **94%**, each with its own reset time.
These screenshots were cropped from the running application to omit unrelated
identity/sidebar content; they are not mockups.

- [Autodetect model selections](../frontend-ui-audit-2026-09-24/assets/luna-reserve-autodetect.png)
- [Independent quota meters](../frontend-ui-audit-2026-09-24/assets/luna-reserve-quota.png)

Process-attributed macOS measurements sampled the exact instance executable and
its responsible WebKit processes every three seconds. CPU is a percentage of one
core, converting `proc_pid_rusage` Mach ticks using this machine’s 125/3 timebase
(checked against `ps` CPU time); RSS is summed within each process group. Process start timestamps guard
against PID reuse. Other builds were running, so this is runtime attribution,
not a clean-machine benchmark or comparative performance claim. Short-lived
processes between samples may be missed.

| Scenario                | Duration | App CPU | WebKit CPU | App RSS start → end | WebKit RSS start → end | Physical writes |
| ----------------------- | -------- | ------- | ---------- | ------------------- | ---------------------- | --------------- |
| Visible idle            | 30.09 s  | 0.639%  | 2.025%     | 95.42 → 79.19 MiB   | 44.47 → 42.92 MiB      | 0 B             |
| Hidden idle after Cmd-H | 30.02 s  | 0.671%  | 1.706%     | 79.50 → 71.72 MiB   | 45.81 → 38.38 MiB      | 0 B             |

Both samples retained one application and three WebKit processes without
membership changes. Physical reads were 897,024 B visible and 3,932,160 B hidden.
Cmd-H was sent through native UI control; JavaScript visibility state was not
independently sampled. Evidence labels are `reserve94-visible-idle` and
`reserve94-hidden-idle`, retained privately with the process sampler.

The actual GUI selected **GPT 5.6 Luna Reserve Medium** and returned exactly
`ORG2_RESERVE_GUI_OK_0924` in the chat. The session persisted as completed with
model `gpt-reserve-medium`; all four main/auxiliary usage records kept reserve
identity (`gpt-reserve-medium` or `gpt-reserve`), and no tool usage was recorded.
This establishes local product usage attribution, not an upstream monetary bill.
[Actual reply](../frontend-ui-audit-2026-09-24/assets/luna-reserve-reply.png).

The 55.10-second interaction sample included setup, one two-second model reply,
and subsequent idle: app CPU 2.444%, WebKit 10.122%, sampled peak RSS 115.67 MiB
and 417.64 MiB respectively, physical writes 16 KiB. It is not a sustained
streaming benchmark. After normal product Quit, a 15.23-second observation found
no instance process or attributable WebKit process. Reopening restored one session
with its exact reply and the reserve-medium selection.

A second normal quit left no instance/WebKit processes over 12.11 seconds. A
second reopen again showed exactly one session, the exact reply in order, and
reserve-medium selected. The two 20-second reopen samples ended at app/WebKit
RSS 88.86/51.28 MiB and 113.02/58.34 MiB; each had one app plus three WebKit
processes with no membership growth. Two cycles do not establish a long-run
memory bound. The test instance was then normally quit.

Performance verdict: blocked for the full lifecycle/performance matrix. The
measured macOS visible/hidden, short active, quit and two reopen scenarios are
complete, but no uncontended baseline, long streaming/load run, offline/reconnect,
account/endpoint switch, or Windows/Linux runtime measurement was performed.
The shared machine was under concurrent build load; the visible/hidden CPU
results are not a near-zero or improvement claim. Source review found no new
poller, subscription or unbounded retained state in this feature. These results
do not upgrade the separate native-history C7/performance verdict.

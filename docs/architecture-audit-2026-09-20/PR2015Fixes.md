# PR #2015 follow-up: OAuth recovery and source coordination

## Problem and authoritative boundary

The Vault record and native CLI credential stores are separate writers. Refresh/adoption completions previously wrote by key ID even after reconnect, organization-only Claude matching could select another user, and timed-out credential reads could survive their callers. Codex scan and recovery also resolved different source paths. UI filtering cannot fix these producer-side failures.

## Changes

- Explicit credential replacement increments a persisted generation. Success, failure, adoption and CLI sync compare the expected generation/material at the Vault write boundary. Manual disable is distinct from OAuth auto-disable; successful rotation preserves a manual disable.
- Claude adoption requires a verified user email, with available organization identity as an additional constraint. Codex rejects inconsistent file/account/token identities and incomplete access-only profile bundles.
- Scanning, suggestions and recovery share Codex source resolution. Proven sources are retained with private credentials and re-proven after replacement.
- Cooperating source-file writers use a nonblocking lock, unique owner-only temporary files and complete-content recheck before atomic replacement. A persisted hash records pending source writeback; later use retries once without consuming the refresh token again. Reconnect invalidates that intent.
- In-process Codex refresh requests coordinate by source so duplicate imports can adopt the first request's writeback. Lock-map entries retain weak references and are pruned on subsequent use.
- Scan and recovery share cancellable/in-flight-only Claude reads. macOS child processes are killed on cancellation; Windows blocking credential calls retain their concurrency permit until they really finish.
- Common CLI token-sync APIs carry generation, expiry and manual-disable protections for the dependent managed-profile PR. The existing runner initializes the added optional expiry field.
- Resolve the current develop UI conflict by retaining shared RefreshButton behavior and the PR's reconnect routing.

## Architecture coverage

All ten architecture layers were examined: compilation; live-call tracing/shared guards; generation naming; user versus organization identity; defaults/missing fields; provider/storage/runner boundaries; honest concurrency comments; local JSON and token request payloads; scan/refresh/init parity; and access/refresh/identity/source resolver symmetry. No complete layer was skipped. Native production OAuth and Windows runtime remain untested.

## Verification

Executed from this PR's delivery checkout:

- `cargo test --manifest-path src-tauri/Cargo.toml -p key_vault --lib`: **450 passed, 1 ignored**.
- `cargo clippy --manifest-path src-tauri/Cargo.toml -p org2 -p key_vault --all-targets -- -D warnings`: **passed**, including application/test target compilation.
- `pnpm exec vitest run --config config/vitest.config.ts src/config/mainAppPaths.test.ts src/hooks/keyVault/accountSetupMethod.test.ts src/modules/MainApp/Integrations/KeyVault/Accounts/Table/__tests__/accountInlineActions.test.ts src/scaffold/WizardSystem/variants/KeyVault/hooks/useWizard.test.ts`: **4 files, 33 tests passed**.
- Identical frontend source in the integration checkout passed `pnpm typecheck` and changed-file `pnpm exec eslint --max-warnings 0`; normal commit hooks also validate the delivery checkout.
- Regression coverage includes reconnect during success/failure/adoption, manual disable, duplicate-import refresh, failed-writeback recovery without a second exchange, mixed native identity, path resolution, private temporary-file cleanup and credential-process cancellation.
- Native executable fixture results and exact limitations: [NativeCodexRefreshVerification.md](NativeCodexRefreshVerification.md). Those observations do not establish production token-reuse rejection; the fake server deliberately rejects duplicate refreshes.
- UI audit: **0 fix / 3 keep with reason / 0 abstract**. Shared controls retained. No Tauri screenshots were captured; rendered reconnect/loading/error states remain a manual verification gap.

## Lifecycle and performance

| Area               | Verdict | Evidence                                               | Change or reason kept                                                   | Verification                                     |
| ------------------ | ------- | ------------------------------------------------------ | ----------------------------------------------------------------------- | ------------------------------------------------ |
| Background work    | fix     | Timed-out reader formerly survived                     | Shared cancellable read; no added polling; event-driven writeback retry | Credential subprocess and retry fixtures         |
| Memory             | fix     | Refresh-lock registry formerly retained completed keys | Weak references, pruning; pending intent is one optional hash per key   | Source inspection and concurrency tests          |
| Scope/isolation    | fix     | Old completion/manual disable/identity confusion       | Snapshot guards and identity/source validation                          | Producing-boundary regression tests              |
| Rendering/hot path | keep    | No new frontend subscriptions/timers                   | Existing shared controls and routing                                    | TS tests/typecheck/lint; rendered checks not run |

Performance verdict: **blocked for a full app CPU/RSS/Windows lifecycle pass**; these measurements were not run. Cross-native refresh exclusivity remains explicitly unsupported, rather than reported as a passing safety guarantee.

## Compatibility, risks and recovery

Four additive private JSON fields have defaults: generation 0, no bound source, no pending writeback, and no automatic-disable ownership. No SQL migration or new public KeyInfo fields. Unknown historical disable intent stays disabled. `fs2` is now a direct key_vault dependency at the version already present in the lockfile.

Native Codex does not participate in ORG2's locks. The network refresh overlap and final source check/replace window remain best-effort limitations. Live provider grace periods were not tested. Identity checks do not cryptographically verify local JWT signatures. No mandatory browser reauthorization or native-refresh subprocess was introduced.

No historical cleanup was performed. Before downgrading, stop active CLI work and preserve the latest credential files; never restore spent refresh tokens from an older backup. Older versions ignore the additive fields but also lose these guards. The implementation keeps the existing user-visible reconnect path for unrecoverable credentials.

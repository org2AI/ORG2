# Market execution recovery: verified boundaries and implementation contract

Historical baseline inspected: ORG2 `6764b26e97579e037be938df374ec9979328f99e`.
This is an implementation contract with chronological progress below, not passing acceptance evidence. The baseline list is historical; current source/runner/target/storage changes are described in the progress sections and remaining-review-findings.md.

## Current behavior confirmed from source

1. `MarketConnect/launch.ts` creates a normal TUI Session and then calls `cli_config_prepare_launch`. The selected model is now in the Session create payload. The selected dynamic credential identity is still only supplied to profile preparation.
2. `agent-cli/managed_config/launch.rs` snapshots the current global managed proxy URL/token into a separate native home. Release removes only owned config files, preserving history. This preserves the initial routing generation but does not create an independently resolvable session credential source.
3. `cli_managed_proxy::proxy_agent_handler` asks ContextResolver for the agent's current selection before checking the supplied token. Its production resolver reads `managed_selection_for_agent(agent_name)`. Switching that global selection invalidates an older launch token. The existing behavior intentionally fails rather than rebinding an old terminal, but cannot independently restore multiple workspaces.
4. `dynamic_credentials::Source` already separates destination from asynchronous credential resolution. Market's implementation rotates grants and caches per identity/workspace/target. This is the reusable credential boundary; KeyVault provider-specific OAuth refresh and the old hosted-key allocation path are different contracts.
5. The normal CLI runner resolves `CodeSession.account_id` through KeyVault, including provider-specific freshness calls before building the environment. It cannot currently interpret a Market dynamic selection. A string-prefix insertion alone would not implement execution recovery.
6. Desktop imported-history continuation uses the canonical timeline and selected target to discover/materialize native execution. It does not simply execute CliResumePlan.resumeArgs. Therefore missing original CODEX_HOME in that adapter alone is not proof that canonical continuation loses context.
7. Mobile imported Codex sends and the orgtrack direct-resume command do use the original native ID, with args and cwd but no recorded custom home. Those direct-resume paths require separate home and credential ownership handling; they must not be conflated with canonical materialization.

## Required implementation invariants

- A durable Session owns its credential-source identity, selected model and native execution identity. Persist no provider secret or rotating grant in this record. Choose an explicit source contract; do not silently reinterpret KeyVault-only account IDs or hosted-key billing.
- A running session's local proxy token resolves that session's selected source, independently of the global settings selection. Authentication must reject unknown/stale tokens before contacting a provider. Resource ownership must bound live entries and release them on every terminal path.
- Every upstream request uses the registered source's credential resolution so refresh remains native and does not require user config replacement. Module removal, disconnect or revoked entitlement must fail without selecting another account.
- Restart reconstructs routing from durable non-secret identity and current authorization. It does not reuse a stale local proxy token from a deleted configuration.
- Explicit account/workspace switching starts or reuses an execution episode only under the matching source identity. Canonical history reuse must compare that identity as well as runtime/workspace.
- Direct native resume locates the original home. Canonical continuation may materialize a new native episode, but must preserve the logical timeline and selected billing source. These are different valid mechanisms with different acceptance assertions.

## Acceptance matrix still required

| Scenario                         | Authoritative evidence required                                                                             |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Initial launch                   | Session persistence contains model/source identity; real request reaches the selected workspace and receipt |
| Close and restart                | Native history still readable; restored request charged to the same selected source                         |
| Two workspaces using one client  | Switching global settings does not rebind or break the other session; distinct receipts                     |
| Credential rotation during use   | Later requests resolve renewed credentials without config replacement or repeated login                     |
| Local disconnect / remote revoke | Further requests fail through that source; no default-account fallback; local recovery remains available    |
| Module unavailable               | Persisted source is reported unavailable before launch or credential consumption                            |
| Direct native resume             | Original native UUID found under the correct home and explicit source selected                              |
| Canonical continuation           | Complete timeline materialized/reused under a matching durable source identity                              |
| Crash and repeated open/close    | No secret-bearing orphan token, uncontrolled registry growth, or transcript deletion                        |

No item in this matrix is marked passed by source inspection or by the model-persistence patch. No production state or credentials were changed during this audit.

## Live-session routing implementation follow-up

The global-selection dependency in points 2–3 above is now removed for newly prepared Market TUI profiles. The application reserves a random process-local token for the exact session/agent/source/model, then writes that token through the existing profile generator. Each HTTP request resolves a session token before the global-settings path. Unknown, released or wrong-agent session tokens fail without trying the global selection. Normal global-client tokens retain their existing path.

Profile creation still validates the selected global configuration and external-file hashes. Failed preparation releases its reserved route. TUI release invalidates the token before parking the row, even when that database operation fails. Both ordinary CLI deletion and the agent-core deletion adapter release the route and owned profile before deleting the row. Native history is retained. Requests already admitted before release may finish; this is not an in-flight request cancellation mechanism.

The registry is capped at 256 live sessions, rejects duplicate session reservations, has no timer/polling, and drops with the process. Production entries retain non-secret source metadata and a local token; provider credentials still resolve per request through the existing dynamic source. This does not yet persist source ownership or reconstruct routes after app restart. It also does not make the ordinary KeyVault-backed session runner understand dynamic source identities.

Verification and remaining measurements are recorded in remaining-review-findings.md. This follow-up supersedes the old live-global-routing observation, not the entire acceptance matrix.

## Durable source identity follow-up

Launch preparation now persists the validated non-secret dynamic selection in `code_session_credential_sources`, owned by the existing `code_sessions` row. This uses the canonical CLI schema initializer, so existing databases receive an additive table without rewriting Session rows. The insert selects only a matching TUI/client/model row; repeating the same source is allowed and changing an existing binding is rejected. No provider credential, refresh grant or local proxy token is stored.

The sessions connection configuration does not explicitly guarantee foreign-key enforcement. The current bundled SQLite defaults to enforcement on, which invalidated an initial test assumption. Cleanup therefore uses a database trigger as well as the foreign key, and the regression exercises enforcement both off and on. Source deletion is atomic with the owning row's successful deletion; a failed owner deletion leaves the binding intact.

The live-route reservation is followed by a durable-owner recheck, with route rollback on failure. The synchronous agent-core deletion adapter revokes again after deleting the row to cover reservation concurrent with that adapter. Ordinary prepare/release/delete continue to use their shared control lock.

This is durable ownership, not completed restart execution. Regenerating a native profile after restart, surfacing source identity through canonical execution targets, and resolving it in the normal runner remain pending. An older application can ignore the new table and must not be treated as supporting these bound sessions. The additive table may remain on rollback; do not erase it or claim old-client recovery is safe. No production migration or installed-app upgrade occurred here.

## Recovery read-model progress

The native Session DTO and status RPC now expose the persisted non-secret `credentialSource`, separate from KeyVault `accountId`. Single and paged reads use the same indexed SQL projection; ordinary legacy rows remain compatible. The launch adapter consumes it when reconstructing a same-source native profile. Canonical execution-target selection and the standard runner still need explicit dynamic-source handling; a readable source is not yet a runnable restored conversation.

## Ordinary execution adapter progress

The normal CLI runner now consumes a durable source binding through an application-owned execution-profile guard. Configuration, Codex native store/MCP home, provider environment and token release share the same execution lifetime. The guard releases its exact token generation. The canonical frontend still needs to carry dynamic source identity through target selection, episode creation and dispatch; this runner work alone does not close installed-app restart acceptance.

## Canonical episode identity progress

Canonical targets and candidate matching now preserve the dynamic source separately from KeyVault identity. SessionService passes both source and selected CLI model into the launch bridge, which validates the source before creating the episode. Creation and source binding share a transaction, so a rejected binding cannot leave an unbound episode. Message dispatch continues using the immutable source on that episode's Session; it does not rebind the source per turn. Rendered picker behavior and native materialization into the managed home remain to be verified/integrated before real restart acceptance.

## ChatPanel source projection progress

The aggregate/list DTO, frontend Session and ChatPanel default/runtime target projection now carry the dynamic source, and override reconciliation includes it in identity. Ordinary explicit account picks remain available. The remaining native-storage work spans materialize/read/synchronize/discard and Claude/Codex catalog/index updates in native_materializer.rs; all must agree with the runner's managed home. Converter tests do not prove actual installed-app picker or recovery behavior.

## Native store owner progress

Native materialization now shares the runner's Session-owned native home when a durable dynamic source is present. This applies to the initial transcript, subsequent reads/suffixes, rollback and deferred catalog repair. Ordinary KeyVault storage keeps its existing behavior. No history migration or credential access is performed by path resolution. Local regression results are tracked in remaining-review-findings.md; actual main-app restart and provider execution remain release gates.

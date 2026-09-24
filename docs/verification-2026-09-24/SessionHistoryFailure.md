# Contain in-flight history read failures

The authoritative source is the provider's native transcript. During startup or after a failed provider launch, a persisted native session can reference a file that does not yet exist. Rust correctly rejects that history read. The in-flight frontend reconciler launched its Promise without a rejection handler, allowing that read failure to reach the global unhandled-rejection error page.

The lifecycle now owns the Promise, retries within the existing bounded ladder, retains live events, and reports exhausted failures through the active session's runtime error. It checks session and turn generation after asynchronous work so a stale read cannot update a different session or newer turn. Its own synchronous post-load lifecycle transition is carried into the next retry. Canonical full-history reads and missing-file errors are unchanged: an unavailable native transcript is never certified as an empty export.

Architecture review covers error ownership, default/failure branches, session versus application semantics, async entry parity, and stale-result resolution. No wire format, database schema, provider parser, file cleanup or canonical semantic changes. No historical remediation is performed; lost native files cannot be reconstructed by swallowing an error.

| Area            | Verdict | Evidence                            | Change or reason kept                        | Verification                      |
| --------------- | ------- | ----------------------------------- | -------------------------------------------- | --------------------------------- |
| Background work | fix     | detached rejecting reconcile        | caught, bounded retry ladder                 | failure/recovery tests            |
| Memory          | keep    | no new retained cache               | existing timer/read ownership                | unit tests                        |
| Scope/isolation | fix     | session/turn may change during read | generation and active-session checks         | stale-session failure test        |
| Rendering       | keep    | existing per-session error surface  | preserve visible events; no empty substitute | persistence/projection assertions |

Verification: `vitest run --config config/vitest.config.ts src/engines/SessionCore/sync/__tests__/sessionSyncReconcile.test.ts src/engines/SessionCore/sync/adapters/cli/__tests__/cliHistory.test.ts` — 31 passed. `tsgo --noEmit --pretty false`, changed-file ESLint and `git diff --check` passed. Existing terminal reconciliation and session-switch entry points already catch failures; this patch closes the unhandled peer. Real Claude login remains expired/revoked, and a valid real-provider rerun was not performed. This fixes a proved propagation defect; it does not prove that every historical App error had that same origin.

Performance verdict: blocked for real desktop lifecycle measurement; bounded retry and source-preservation tests pass. No UI controls or appearance changes; no new screenshots claimed.

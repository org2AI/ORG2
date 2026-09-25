# Shared continuation failure recovery

## Producing boundaries and invariants

Two independent shared sessions reproduced distinct failures. One failed its first continuation because a versioned materialized Codex tool result encoded interruption as exit code 130, but the parser reconstructed `status: failed` without `interrupted`. The tool output body was byte-for-byte equal; semantic verification correctly rejected the changed status. The parser now preserves interruption. Verification is not weakened and divergent native history is not silently discarded.

The second accepted a prompt and returned a real provider usage-limit error. `runConversationTurn` published a terminal error, then the durable delivery settlement wrote `deliveryStatus: failed` onto the accepted user's optimistic row. Native projection excludes undelivered user rows. The next send therefore compared 10 native items with 9 canonical items, while the UI rendered both a failed-send card and the published agent error.

Accepted empty execution failures now keep `deliveryStatus: sent` and carry a separate optional `executionError` on the local projection and held queue owner. The published terminal event owns the error detail; the user row retains a shared Button retry action. The held owner never automatically resends or blocks a later independent message. Explicit retry mints a new intent and retains existing native retry-lineage proof. Pre-acceptance send failures retain their existing failed-send behavior.

The exact typed native terminal diagnostic is propagated through settled continuation results instead of being replaced by a generic error. Ordinary tool results and previous turns' diagnostic text are not interpreted as this turn's failure.

## Recovery and retry design review

The equivalent-path review found two additional violations. Accepted recovery-blocked and turn-closed settlement still demoted the user projection to failed delivery. Also, the retired-owner retry branch reused the terminal intent when text was unchanged, despite describing the operation as a fresh submission. Its unconditional placeholder removal would delete an accepted prompt once retirement correctly preserved delivery status. Regression assertions now inspect the final persisted settlement, not merely an earlier successful acceptance write.

The acceptance criteria are: an accepted prompt stays in canonical history through execution failure and recovery retirement; retired terminal intents are never submitted again; accepted history without an empty-attempt proof is never removed by retry; persistence failure retains the same recovery owner without automatic provider re-execution. All four criteria have producer/retry-boundary regression coverage. Eight assertions failed on the preceding implementation and pass with this change.

| Term                         | Authority                                                                              | Meaning and invariant                                                                          |
| ---------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Delivery acceptance          | Native `session_turn_intents`, restored through `onAccepted` into the durable delivery | The provider accepted this intent; a later execution verdict cannot undo delivery              |
| Cloud admission / acceptance | Conversation-plane user event and Cloud FIFO ledger                                    | Publication and execution lease ownership; neither alone proves native acceptance              |
| Execution outcome            | Native terminal receipt / published terminal event                                     | Success, failure or recovery blockage; independent of delivery                                 |
| Retry ownership              | Durable held queue row, or an explicitly retired EventStore projection                 | A held empty attempt uses existing lineage; a retired owner always mints a new intent          |
| Safe supersession            | Sender-local native empty-attempt lineage                                              | Required before replacing an accepted attempt; arbitrary recovery errors provide no such proof |

| Entry / verdict                              | User projection                        | Owner / retry behavior                                                                     |
| -------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------ |
| Pre-acceptance blocked or stale intent       | Failed delivery                        | Hold existing row for explicit retry                                                       |
| Proven empty accepted failure                | Sent + execution error                 | Hold existing queue owner; explicit retry uses native lineage                              |
| Accepted recovery-blocked or turn-closed     | Sent + execution error + retired owner | Persist projection before retiring; retry appends a fresh intent and preserves old history |
| Turn-closed before native acceptance         | Failed delivery + retired owner        | Fresh intent on explicit retry; replace unsent placeholder only                            |
| Projection/storage failure during retirement | Existing accepted owner retained       | Existing bounded recovery backoff; no new provider send                                    |
| Unknown error after acceptance               | Existing accepted owner retained       | Recover the same native intent, never infer a safe resend                                  |

The same settlement function handles live acceptance and accepted rows restored after persistence recovery. Retry passes the new identity through either the canonical callback or ordinary submission. No new dispatch authority, timer, global cache, wire field or history migration is introduced. Strict divergence checks remain: preserving history does not authorize discarding an unpublished tool tail to make a retry succeed.

Architecture layers reviewed: compilation (targeted tests, typecheck and lint), duplicate control paths (all terminal queue verdicts), naming/semantic overloading (table above), defaults (unknown post-acceptance errors remain recovery-only), boundaries (queue versus native versus Cloud authority), understandability (explicit history-preservation comments), persistence/wire compatibility (existing local metadata only), entry parity (live/recovered/explicit retry), and resolver symmetry (retired retry identity is independent of whether text changed). Unrelated provider/account/workspace resolver chains and repository-wide dead-code analysis were intentionally excluded.

The original nine-character discrepancy is still unresolved. The two currently available materialized copies have identical 11,899-character outputs; trimming would remove only one character, and neither contains CRLF. That rules out those simple transformations for the available copies, but does not identify what happened to the unavailable 11,890-character artifact. No fuzzy comparison or historical rewrite is used.

## Historical remediation and compatibility

Legacy accepted failed-send projections are restored in canonical reads only when existing sender-local native retry lineage matches the root session, intent, and queue identity. Cloud user publication alone is not treated as acceptance. No native transcript, Cloud audit row, or historical error is deleted. Previously persisted duplicate error cards can remain in old UI history; new attempts use the corrected lifecycle.

`executionError` is additive local queue/EventStore metadata. Existing queue records remain valid, and retry/edit clears the field. No database migration, Cloud resource change, public protocol version change, or automatic quota change is required. Older clients do not understand the new retry presentation but the durable explicit-dispatch hold prevents automatic re-execution. Roll back the commit without deleting queue or transcript data; a current client may be needed to expose the accepted-failure Retry control.

## Resource review

| Area               | Verdict | Evidence                                                                                       | Change or reason kept                                                                                                                      | Verification                                                                                  |
| ------------------ | ------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Background work    | keep    | Existing root lock, accepted execution owner and bounded recovery scheduling                   | No new timer, subscription, scanner, worker or process; terminal failure becomes an explicitly held owner                                  | Dispatcher tests prove later messages proceed and accepted work does not automatically resend |
| Memory             | keep    | Read-local maps and arrays over already-loaded events; existing retry proof cap of 64 attempts | No app-lifetime cache added; terminal diagnostic scans only the final user suffix                                                          | Lineage scope/idempotence and terminal provenance tests                                       |
| Scope/isolation    | keep    | Repair key is root session + exact turn intent + queue identity; native proof is sender-local  | Unsent rows and unrelated scopes remain excluded; no text-based repair                                                                     | Legacy JSON replay and independent-message regression tests                                   |
| Rendering/hot path | fix     | Two failure owners previously rendered for one accepted turn                                   | Accepted user remains sent; one agent error, explicit retry action, no duplicate composer queue card; equality keys include executionError | Static component tests and real isolated macOS Tauri UI                                       |

## Provider and lifecycle evidence

| Provider             | Raw transition                                                                      | App/UI state                                             | Topology/boundary                                   | Expected invariant                                               | Observed evidence                                                                         |
| -------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Codex                | Materialized tool output with code 0, 1, 130                                        | Raw JSONL parser readback                                | Local native parser                                 | Preserve body, error and interrupted semantics                   | Rust raw-record test passes, including code 130                                           |
| Codex / GPT 5.6 Luna | Shared history continuation then quota failure                                      | Previously failing conversation open                     | Isolated macOS app, existing account, real provider | Canonical history retains accepted prompt; one new error card    | Two consecutive sends reached provider quota rejection, without native/canonical mismatch |
| Codex / GPT 5.6 Luna | Explicit Retry after failure                                                        | Native app stopped/restarted, same conversation reopened | Same isolated app/data home                         | Retry remains available; new intent, no automatic resend         | Real Retry reached provider and returned exact usage-limit detail                         |
| Codex                | Legacy failed optimistic row + local native lineage                                 | Persisted JSON replay                                    | Canonical read projection                           | Restore only proven accepted prompt without modifying audit data | Regression test passes; previously blocked live conversation resumed                      |
| Claude Code          | Failure/retry on this patch                                                         | Not run                                                  | Not run                                             | No compatibility claim from Codex-only evidence                  | Existing continuation unit tests only                                                     |
| Codex                | Original 164-item / nine-character output difference                                | Not reproduced with both original artifacts              | Not run                                             | Preserve exact tool output                                       | Still unresolved; not explained by the interruption-status fix                            |
| All                  | Offline, account/endpoint switch, hide/show, compact/rotate/delete, large histories | Not measured on this patch                               | Physical second machine not used                    | Full lifecycle and performance acceptance                        | Not run; no claim of full performance or multi-machine acceptance                         |

The desktop checks used the patched frontend with the existing isolated acceptance binary. The changed Rust parser was compiled and exercised through the native parser test suite; it was not rebuilt into that desktop binary. Real provider success remains blocked by the account's usage limit. A real CUA screenshot and accessibility states were inspected for the light-theme narrow chat pane, loading/sending and error states. Screenshots are not committed because they include existing team-session/account content. Dark theme and additional viewport checks were not run.

## Verification

- Targeted Vitest run: 16 suites, 382 tests passed (exact file list in the PR).
- Retirement/retry regression: `pnpm test src/engines/SessionCore/hooks/session/__tests__/useQueueDispatch.intervention.test.ts src/engines/ChatPanel/ChatHistory/hooks/__tests__/useEditUserMessage.test.ts`: 8 failed before the follow-up fix; 66 passed after it. This includes projection failure/recovery and another send failure during retired-owner retry. These follow-up fault paths were tested through the production hooks with injected dependencies, not re-exercised in the real desktop.
- `pnpm run typecheck:fast`: passed.
- `pnpm exec eslint <changed TS/TSX files> --max-warnings 0`: passed.
- `cargo test -p orgtrack_core sources::codex::app::transcript --lib`: 30 passed, 3 existing opt-in image acceptance tests ignored (local artifacts/resource acceptance required).
- `git diff --check`: passed.
- Changed action-control source inspected: new Retry uses shared `Button` with `variant="ghost"` and `size="small"`; no native/button substitute bypass introduced.

Performance verdict: blocked for full performance acceptance. Functional failure recovery is verified as above; CPU/RSS across the complete lifecycle, additional providers and physical-machine topology were not measured in this patch.

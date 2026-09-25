# Shared continuation failure recovery

## Producing boundaries and invariants

Two independent shared sessions reproduced distinct failures. One failed its first continuation because a versioned materialized Codex tool result encoded interruption as exit code 130, but the parser reconstructed `status: failed` without `interrupted`. The tool output body was byte-for-byte equal; semantic verification correctly rejected the changed status. The parser now preserves interruption. Verification is not weakened and divergent native history is not silently discarded.

The second accepted a prompt and returned a real provider usage-limit error. `runConversationTurn` published a terminal error, then the durable delivery settlement wrote `deliveryStatus: failed` onto the accepted user's optimistic row. Native projection excludes undelivered user rows. The next send therefore compared 10 native items with 9 canonical items, while the UI rendered both a failed-send card and the published agent error.

Accepted empty execution failures now keep `deliveryStatus: sent` and carry a separate optional `executionError` on the local projection and held queue owner. The published terminal event owns the error detail; the user row retains a shared Button retry action. The held owner never automatically resends or blocks a later independent message. Explicit retry mints a new intent and retains existing native retry-lineage proof. Pre-acceptance send failures retain their existing failed-send behavior.

The exact typed native terminal diagnostic is propagated through settled continuation results instead of being replaced by a generic error. Ordinary tool results and previous turns' diagnostic text are not interpreted as this turn's failure.

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

- Targeted Vitest run: 16 suites, 379 tests passed (exact file list in the PR).
- `pnpm run typecheck:fast`: passed.
- `pnpm exec eslint <changed TS/TSX files> --max-warnings 0`: passed.
- `cargo test -p orgtrack_core sources::codex::app::transcript --lib`: 30 passed, 3 existing opt-in image acceptance tests ignored (local artifacts/resource acceptance required).
- `git diff --check`: passed.
- Changed action-control source inspected: new Retry uses shared `Button` with `variant="ghost"` and `size="small"`; no native/button substitute bypass introduced.

Performance verdict: blocked for full performance acceptance. Functional failure recovery is verified as above; CPU/RSS across the complete lifecycle, additional providers and physical-machine topology were not measured in this patch.

# Compacted Agent history projection

## Authoritative source and root cause

`agent_messages` stores immutable history. The latest boundary's `compact_from_sequence` selects the retained tail, even when those retained rows precede the newly appended boundary in storage order. Rust `load_llm_history` sends the full stored boundary as a user message followed by that tail.

The authoritative frontend adapter previously converted every raw row into display-shaped events. Its boundary renderer stripped the continuation wrapper, and the native projector cleared all preceding items at that marker. That both lost the retained tail and changed the summary's semantic kind. A real manual compact therefore produced native=12 versus canonical=1 and blocked continuation before any provider call.

## Source-level invariant

The authoritative adapter now selects the same effective frame as Rust before converting rows: latest full boundary as a user message, then ordinary rows from its cutoff onward. Only a copy of the boundary changes projection metadata. The display reader still loads the complete original timeline and renders its collapsed boundary normally. The semantic-prefix guard stays strict.

No database rows, user arguments or credentials are rewritten. Historical remediation is a fresh authoritative read through the fixed adapter; recovery of the original failed session is required in packaged acceptance, not replacement by a new session.

## Lifecycle and performance

| Surface                    | Behavior                                                                    | Verification                                   |
| -------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------- |
| Authoritative history read | Two linear passes over rows already fetched; no extra RPC or database query | Adapter regression and call-chain inspection   |
| Repeated reads/display     | Original row array and full display history preserved                       | Repeated-read and display assertions           |
| Compaction/restart         | Latest sequence wins; zero cutoff and summary-only frames supported         | Owning adapter through native projection tests |
| Active/idle/hidden         | No timer, listener, cache, worker or background loop added                  | Static resource inventory                      |
| Abort                      | Existing signal check remains before projection                             | Existing authoritative-reader suite            |
| Provider/scope             | Rust Agent adapter only; imported CLI adapters unchanged                    | No cross-provider runtime claim                |

Architecture coverage: types/compilation, source ownership, effective-context versus display semantics, compaction initialization parity, and provider comparison contract. No wire, schema, configuration or UI layout change. No broad unrelated cleanup.

## Verification limits

Two new regressions fail on the old adapter and pass on the fix. Four targeted suites pass (88 tests); TypeScript checking passes. Exact commands and packaged original-session recovery are recorded in the PR. Runtime CPU or long-duration retention improvement is not inferred from this projection fix. Rollback is a code revert; no data migration or cleanup is needed.

Performance verdict: no new retained or recurring work; whole-app lifecycle acceptance remains separate.

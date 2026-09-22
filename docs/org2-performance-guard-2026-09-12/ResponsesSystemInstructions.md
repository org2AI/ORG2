# Responses system instruction preservation

The authoritative source is the ordered provider message frame. Stable prompt blocks and asynchronous workspace-memory recall are additive system messages. The shared Responses converter previously assigned `instructions` for every system message, leaving only the last block. Both Codex OAuth and public OpenAI Responses use this converter.

The fix preserves every system block in order, separated by a blank line, after the existing structured-text sanitizer. User, assistant, tool, and developer-message conversion remains unchanged. Historical database rows are untouched; no migration or data cleanup is required.

## Runtime evidence boundary

The investigation started from a device run where reported input grew from 40,168 to 46,063 tokens after restart. The pre-restart tool iteration had an additional system block, while the next turn did not. Section telemetry is proportionally normalized before provider conversion and cannot prove an exact 5,895-token attribution. The request-builder regression independently proves the prompt-loss defect. A paired real-account request capture and retest of the corrected binary remain unperformed; this patch must not be described as complete numeric attribution or a token-cost reduction.

| Area               | Verdict | Evidence                                                       | Change or reason kept                                                                                 | Verification                           |
| ------------------ | ------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Background work    | keep    | Converter is synchronous per request                           | No timer, retry, worker, or subscription added                                                        | Call-chain inspection                  |
| Memory             | fix     | Last system block replaced earlier text                        | Request-owned string appends each existing block once; linear in total system text, no retained cache | Multi-block and empty-block regression |
| Scope/isolation    | keep    | Uses only current request messages                             | No cross-session or account state                                                                     | Codex request-builder regression       |
| Rendering/hot path | fix     | Wire instructions omitted principal prompt after memory recall | Preserve existing text at shared provider conversion boundary                                         | Red-to-green request assertion         |

| Provider                | Raw transition                                                                | App/UI state                      | Topology/boundary       | Expected invariant                              | Observed evidence                                                   |
| ----------------------- | ----------------------------------------------------------------------------- | --------------------------------- | ----------------------- | ----------------------------------------------- | ------------------------------------------------------------------- |
| Codex OAuth             | Stable structured prompt, then late memory system block                       | Tool iteration, synthetic fixture | Real request builder    | Stable prompt survives; input history identical | Regression fails on old code and passes after the fix               |
| Public OpenAI Responses | Multiple structured/string system messages including nonadjacent/empty blocks | Synthetic fixture                 | Shared converter        | All system text retained in order               | Shared-boundary regression passes; independent live account not run |
| Codex OAuth             | Tool iteration to restarted turn                                              | Previous device run               | Provider-reported usage | Explain complete request-size delta             | Exact numerical attribution not run                                 |

Compatibility: requests now include instructions that were already present in the internal frame but omitted on the wire. This can increase tokens and affect behavior or context limits. No schema, API field, dependency, or persistence format changes. Reverting the code reintroduces prompt loss; no database rollback is necessary. UI screenshots do not validate this wire-only invariant.

Performance verdict: blocked for full device performance and restart-growth attribution. The code introduces no retained state; this is not evidence of long-term memory stability.

## Executed verification

- `cargo test -p agent_core --lib build_responses_request_preserves_system_prompt_after_memory_prefetch --manifest-path src-tauri/Cargo.toml`: failed on old converter, retaining only memory text.
- `cargo test -p agent_core --lib responses --manifest-path src-tauri/Cargo.toml`: 72 passed after the fix, including both new regressions.
- `cargo clippy -p agent_core --all-targets --manifest-path src-tauri/Cargo.toml -- -D warnings`: passed.

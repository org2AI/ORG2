# Native history fidelity — lifecycle and verification

## Ownership and lifecycle

All work remains owned by the existing on-demand history load / session-native maintenance path. No timer, subscription, worker, retry loop, global cache, or periodic migration is added. Read/validate → matching suffix → append remains the state path; mismatch and missing historical images fail before an append. Retry uses persisted row identity and compares the error bit as well as content. Existing cancellation, scheduler ownership and concurrent-transcript checks remain in place.

| Area               | Verdict | Evidence                                                                   | Change or reason kept                                                                                                              | Verification                                                                    |
| ------------------ | ------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Background work    | keep    | Existing requested history load owns reconstruction                        | No new idle/hidden work or cadence                                                                                                 | Source inspection; existing native/continuation regression suites               |
| Memory             | fix     | Native Agent reconstruction now embeds all effective-history images        | Required for exact history identity; request-scoped only, no retained cache; existing native item/serialized-byte validation stays | Two-image database regression; CPU/RSS and large-image peak memory not measured |
| Scope/isolation    | keep    | Existing session ID, database transaction and native maintenance ownership | No new identity or cache key; conflict fails without overwrite                                                                     | Isolated DB retry/conflict tests; existing transcript lock tests                |
| Rendering/hot path | keep    | Changes affect persisted-history projection and tool status mapping        | No React component, streaming loop, or subscription change                                                                         | TS adapter/projection tests and source review                                   |

| Provider                                   | Raw transition                                            | App/UI state | Topology/boundary                                       | Expected invariant                                                             | Observed evidence                                                   |
| ------------------------------------------ | --------------------------------------------------------- | ------------ | ------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| Codex                                      | Raw custom exec call/result → reread → append             | Fixture      | Local parser/ingestion/native storage                   | Script parameters and name agree, exact suffix, original bytes remain          | Permanent regression                                                |
| Codex                                      | Two raw MCP calls, object input and same business call_id | Fixture      | Local JSONL → real parser → ingestion/native comparison | Full args, independent protocol identities                                     | Permanent regression                                                |
| Claude Code                                | Two raw MCP tool_use/results with same business target    | Fixture      | Local JSONL → real parser → ingestion/native comparison | Full args, independent protocol identities                                     | Permanent regression                                                |
| Codex / Claude shared canonical projection | thinking/reasoning-named structured tool events           | Fixture      | SessionEvent → canonical items                          | Preserve both call and result                                                  | TS regression; raw adapters tested separately above                 |
| Agent                                      | Two image messages → SQLite → native/model reread         | Fixture      | Local typed seed/persistence                            | Native keeps every image; model request policy unchanged                       | Permanent database regression                                       |
| Agent                                      | Failed tool / summary → retry → append → reread           | Fixture      | Local typed seed/persistence/canonical loader           | Error bit and context boundary survive; conflict rejects                       | Rust and TS regressions                                             |
| Agent                                      | Old schema → additive migration → repeat                  | Fixture      | In-memory SQLite                                        | Old payload unchanged, false default, new true bit survives repeated migration | Migration regression                                                |
| Agent                                      | Missing historical image                                  | Fixture      | SQLite / local file resolution                          | No silently lossy projection or stored mutation                                | Negative regression                                                 |
| All                                        | Live send/retry, account switch, hidden/reopen            | Not run      | Running desktop/provider                                | Correct UI result, no idle retained resources                                  | Requires rebuilt desktop and live execution; no CPU/RSS measurement |
| All                                        | Cross-account / second instance / cloud transfer          | Not run      | Multi-instance/cloud                                    | No cross-scope stale writes                                                    | Not claimed by these local fixtures                                 |

## Verification

This report accompanies the isolated PR based on develop `58898f47d`. Prior mixed-worktree results are not treated as verification of this branch.

- Four frontend regression files (native materializer, persisted message adapter, authoritative Rust adapter, local continuation): **157 passed** using `node_modules/.bin/vitest run --config config/vitest.config.ts --maxWorkers=2`.
- Changed six TypeScript files: ordinary ESLint with `--max-warnings 0` passed.
- `node_modules/.bin/tsgo --noEmit --pretty false`: passed.
- Type-aware ESLint (`--no-eslintrc --no-inline-config --config config/eslint.typed.cjs`) on the six changed TypeScript files: **failed** on the unchanged `createRustAgentAdapter.ts:107` `no-floating-promises` violation; confirmed the same statement exists on the develop base and in `config/typed-lint-baseline.json`. Three test files are ignored by that configuration. This unrelated streaming statement is not modified by the PR.
- `cargo test --manifest-path src-tauri/Cargo.toml -p agent_core --lib persistence --locked`: **155 passed**.
- `cargo test --manifest-path src-tauri/Cargo.toml -p agent_core --lib core::session::turn::post_turn::tests:: --locked`: **4 passed**.
- Scoped baseline-aware typed lint using the repository `collectFindings` / `newFindings` checker on the three changed production TS files: **1 existing finding, 0 new or increased findings**.
- `cargo test --manifest-path src-tauri/Cargo.toml -p org2 --lib agent_sessions::event_pipeline::ingestion::normalizer --locked`: **31 passed**.
- `cargo test --manifest-path src-tauri/Cargo.toml -p org2 --lib agent_sessions::cli::native_ --locked`: **81 passed**, with two child-process helper tests marked ignored at the top level and exercised by their parent lock tests.
- Changed fifteen Rust files: `rustfmt --check --edition 2021 --config skip_children=true` passed.
- `node scripts/quality/check-test-placement.mjs`: passed across 618 directories.
- `git diff --check`: passed.

Full-history image hydration increases per-request memory versus the model's trimmed image view. It is limited to requested native identity/transfer reads and uses the existing native item/serialized-byte validation; that final validation is not a pre-allocation peak-memory bound. No background cache or polling is introduced.

Performance verdict: blocked for unmeasured live large-history/image CPU/RSS and provider/multi-instance behavior. Functional source-level verification is reported separately. The PR introduces no destructive cleanup; old records missing already-lost metadata cannot be reconstructed automatically.

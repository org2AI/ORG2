# Native conversation consistency: tool-result boundary fix and acceptance

## Problem and acceptance scope

The user reported that the same `read_file` result had different lengths in native history and the standard conversation (item 94 of 164, 11890 versus 11899). Read-only inspection of the known instance’s persisted messages, events, native records, and this task’s test instance has not yet located that call. The reproduction below must not automatically be treated as the root cause of that incident, and we cannot claim that the user’s old session has been restored. The error now includes the session ID to help locate the actual source later; the body is not logged.

This PR ensures that tool results written by ORG2 to Codex round-trip verbatim and explicit status is preserved; non-business identifiers added by the native program must not cause idempotent retries to fail. Acceptance includes:

- tool name, arguments, pairing, output, and error status match after round-tripping through the production writer and reader
- JSON, empty bodies, Unicode, CRLF, leading/trailing whitespace, and bodies that resemble executor messages do not trigger a second interpretation
- native Codex accepts the actual written format; content matches in real requests and remains consistent after closing and reopening
- genuine body divergence, incorrect pairing, duplicate results, and malformed formats are still rejected
- no overwriting old files and no new polling, retry loop, or persistent cache

Local history logs also confirm multiple similar interceptions, with differences in tool call/result ordering, arguments, and compressed history length. These logs do not prove that the current code still has the same production defect, nor can they be attributed to the two reproductions in this PR. The current ORG2 UI is on the new-session page and does not display this report; that instance’s data was not modified.

## Confirmed production-boundary issue

The authoritative input is `NativeConversationItem::ToolResult` passed into `codex_response_items` by the standard conversation. The old writer wrote successful output directly as a string and wrapped error output in executor JSON; the reader then applied JSON, script-failure, and background-task recognition to all such strings. As a result, file content could be treated as control information: `{"output":"literal","session_id":1}` was unpacked, and `Script failed` in the body could turn a successful result into a failure.

This is an asymmetry between the encoding and decoding contracts, not a reason to loosen semantic prefix validation. The new regression failed on the old read path because a successful status became a failure.

Another observed issue: Codex 0.154.0 adds an `fco_*` ID to injected tool results. The existing suffix check compared the entire JSON field by field, so a retry after successful injection but lost response could report a false conflict. The only allowed difference is the result ID, which the native side adds when the original request did not provide one; call ID, body, and all other fields are still compared strictly.

## Design

1. Use the explicit `fc_orgii_v1_` prefix in native function item IDs to mark the ORG2 output protocol version. This uses an ID field supported by the provider instead of putting private parameters in tool arguments.
2. Encode all results as the existing exec-style string JSON `{exit_code, output}`: 0 for success, 1 for failure, and 130 for interruption. Encoding and decoding are defined in the same Rust module.
3. The reader gets the version marker only from the native response-item ID and places it in the existing bounded pending-call record; a same-named field in business arguments cannot select the protocol. A spoofed-argument counterexample was added. Decoding occurs only once. The output body is an opaque string and is no longer interpreted using shell status, background-cell state, or tool-renaming heuristics. Corrupt versioned data produces an explicit error rather than silently falling back to guesswork.
4. Native/legacy data without a version marker continues to use the original read path. User history is not rewritten for an upgrade, and a length difference is not used to guess which content is correct.
5. Keep strict semantic-prefix comparison. Genuine divergence is still blocked, and the error includes the session ID.

## Historical data and compatibility

There was no database migration, history cleanup, or production data write. If an old session has already diverged in projection, first obtain the same call from the original file and standard events, compare exact text differences, source, version, and hash, and then determine whether only the derived view can be rebuilt. If a replacement execution session is needed, preserve the native file and standard body, verify full consistency, and only then switch the binding. This document does not authorize or perform such historical repair.

The new format adds fixed wrapper and string-escaping overhead. Tool bodies are unchanged, but older clients still infer meaning from the body, so all readers for the same session should be upgraded; correct handling of these special bodies after downgrade is not guaranteed. Rollback should only stop writing the new format while retaining already written records and the compatibility reader; do not roll back by overwriting native history.

## Ten-layer architecture review

| Layer | Verdict | Evidence / boundary                                                         |
| ------------- | ---------- | ----------------------------------------------------------------- |
| Compilation | See verification record | Modified the owning Rust crate and native-writer tests                               |
| Deduplication | Fixed | Encoding/decoding are centralized; the old writer status-wrapping function was removed                              |
| Naming | Clear | Tool output and transport envelope are separate                            |
| Semantics | Fixed | The body no longer produces status/background control information                           |
| Default branch | Conservative | v1 is decoded strictly; legacy formats are not migrated by guesswork                                   |
| Domain boundary | Preserved | The Codex protocol stays in the Codex module; standard conversation types are unchanged                         |
| Understandability | Clear | Version prefix, single-layer decoding, and rejection conditions have comments and counterexamples                          |
| Wire | Tested | Rust generates response items; injection and model requests were verified with installed Codex       |
| Entry-point symmetry | Reviewed | materialize/synchronize share a writer; full/streaming/paginated reads share a parser |
| Resolver symmetry | Not applicable | Account, working directory, and provider priority chain were not changed                          |

Related entry-point checks cover standard TS projection, Rust Agent persisted history, Claude native reads/writes, Codex native reads/writes, and suffix retries. This patch changes the Codex boundary; all Claude/Agent lifecycles, all providers, and all old sessions are outside the verified scope, so this does not establish global consistency.

## Performance and lifecycle

| Area               | Verdict | Evidence                                                         | Change or reason kept                | Verification            |
| ------------------ | ------- | ---------------------------------------------------------------- | ------------------------------------ | ----------------------- |
| Background work    | keep    | The existing on-demand read path is synchronous                                             | No timer/listener/worker/retry added    | Source call chain              |
| Memory             | keep    | Single-result decoding and existing history collector                                     | No global container added; extra JSON string wrapping | Encoding/decoding and read regressions        |
| Scope/isolation    | keep    | Native RPC tests use a temporary profile, HOME, loopback model, and macOS network sandbox | No real account or model service accessed             | Cold-start/reopen tests         |
| Rendering/hot path | keep    | No React changes; branch by ID only in the existing transcript parser           | New format bypasses repeated inference                   | Full read and visitor comparison |

| Provider | Raw transition | App/UI state | Topology / boundary | Expected invariant | Observed evidence |
| ------------- | ------------------------------------ | ----------------------- | ---------------------------------------------- | ---------------------------------- | -------------------- |
| Codex | Create and reread | Real offline JSONL | Local write → read → semantic check | Body/status unchanged; genuine divergence rejected | Production read/write regression |
| Claude Code | Create and reread | Real offline JSONL | Local write → read → semantic check | Same body/status consistency | Same-suite cross-provider regression |
| Codex 0.154.0 | Inject, append twice, restart | Real app-server; no GUI | Temporary profile → loopback request → native rollout → reader | Injected body matches, version ID retained, no duplicates | Native RPC integration regression |
| Codex/Claude | compact/rotate/delete, open/pin old row | GUI | Cloud upload / download on another device | Full lifecycle consistency | No new measurement in this PR |

This change adds no persistent background resources. Full desktop visible/hidden CPU/RSS and cloud lifecycle acceptance were not performed for the new version. **Performance verdict: blocked** (these real-device matrix cells are uncovered; this does not mean a persistent performance regression was found).

## Verification record

The following commands were run in an isolated workspace. The root-crate command reused this task’s existing Cargo target cache; the local PM sidecar symlink was added. Build artifacts were not committed.

- `cargo check --manifest-path src-tauri/Cargo.toml -p orgtrack_core --all-targets` — passed, no warnings
- `cargo test --manifest-path src-tauri/Cargo.toml -p orgtrack_core materialized_tool_results_preserve_opaque_body_and_explicit_status -- --nocapture` — failed before the read-path change and passed afterward; the old path inferred failure from `Script failed` in a successful body
- `cargo test --manifest-path src-tauri/Cargo.toml -p orgtrack_core sources::codex -- --test-threads=1` — 120 passed, 4 ignored (existing real image asset/resource acceptance tests)
- `cargo clippy --manifest-path src-tauri/Cargo.toml -p orgtrack_core --all-targets -- -D warnings` — passed
- `cargo clippy --manifest-path src-tauri/Cargo.toml --lib -- -D warnings` — passed
- `ORG2_TEST_CODEX_BIN=/opt/homebrew/bin/codex cargo test --manifest-path src-tauri/Cargo.toml --lib agent_sessions::cli::native_materializer::tests -- --include-ignored --test-threads=1` — 56 passed, including the explicitly enabled installed Codex 0.154.0 regression: two isolated processes, two loopback model requests, five injected tool results, and rereading the native file. The Claude lock-child test was verified when launched by its parent test; running it alone provides no independent coverage
- `cargo test --manifest-path src-tauri/Cargo.toml --lib agent_sessions::cli::parsers::codex_app_server::catalog::tests -- --test-threads=1` — 9 passed, 2 ignored (existing provider/project native configuration tests); new suffix-retry, body-change, extra-field, and duplicate-result counterexamples passed
- `pnpm exec vitest run --config config/vitest.config.ts src/engines/SessionCore/conversations/nativeConversationMaterializer.test.ts src/engines/SessionCore/conversations/localConversationContinuation.test.ts` — 2 files, 109 passed
- `python3 -m py_compile src-tauri/src/agent_sessions/cli/native_materializer/opaque_tool_native_probe.py` — passed
- `git diff --check` — passed

The first root-crate build stopped because the isolated workspace lacked the local sidecar; it passed after the sidecar was added. The new cross-provider fixture initially failed because the test did not use a real `orgii_evt_*` user ID; it passed after aligning with the production ID contract. The first strict native RPC comparison exposed the vendor-added `fco_*` ID; the body matched exactly, and only that field was ultimately excluded, with a counterexample test added at the production idempotency boundary.

This PR did not run paid model inference, production cloud writes, or GUI acceptance; UI layout was not changed, so screenshots would provide no additional evidence. No full compact/rotate/cloud-reconnect/desktop CPU/RSS measurements were added; restoration of the old session reported by the user has not been proven.

# Session history consistency fixes

This PR fixes six consistency issues in native history transfer and frontend projection. The authoritative read/write boundary, compatibility, and rollback details are described below; verification for the current independent branch is recorded separately.

## Data sources, root cause, and write boundary

The authoritative source is the original Codex / Claude JSONL, or the built-in Agent’s SQLite `agent_messages`. Before sending, reload the source, compare it through ingestion / canonical projection and native projection, then append subsequent content. Strict comparison continues to reject genuine history differences.

| Line | Element | Verdict | Reason | Suggested change |
| ---------------------------------- | ------------------------------------ | ------- | -------------------------------------------- | ----------------------------------------------------------------------------------- |
| nativeConversationProjection.ts:82 | Canonical private-event classification | fix | Tool names containing thinking/reasoning were mistaken for internal reasoning | Preserve structured tool events first; names no longer override event type |
| normalizer.rs:648 | Normalizer argument parsing | fix | Business input that had already been extracted was unpacked again | Unwrap only the generic tool_call wrapper with an explicit tool-name marker; preserve all arguments for named tools |
| normalizer.rs:707 | Normalizer call identity | fix | Business `args.call_id` overwrote the protocol ID | Prefer top-level and result protocol IDs; retain the legacy argument fallback only when protocol identity is missing |
| load_llm.rs:72 | Agent authoritative history read | fix | Legacy image cropping for model requests leaked into history identity | A separate `load_native_history` preserves all valid historical images; model requests continue using the existing cropping policy |
| native_materializer.rs:513 | Agent typed seed / SQLite / frontend read | fix | Tool error state was lost during writes | Add `tool_is_error` to preserve the failure flag on round trip; interruption counts as failure in the portable contract |
| messages.rs:800 | Agent summary seed / two-sided projection | fix | Summary was downgraded to an ordinary user message | Use the existing `compact_from_sequence` marker to preserve the full summary and valid tail; continue generating model requests under the existing rules |

Permanent coverage is in the existing test files for normalizer_tests, native_materializer tests, load_llm_tests, session_snapshots_tests, nativeConversationMaterializer, agentMessageAdapters, and createRustAgentAdapter. Source-level tests use the real provider parser, real ingestion, and real SQLite writes and read-back; rendered assertions are not used in place of production-boundary verification.

## State and boundary verification

| State / input | Expected behavior | Coverage |
| --------------------------------- | ------------------------------------------------ | --------------------------------------------- |
| Two Codex/Claude calls for the same business goal | The two protocol IDs remain independent; input/options/call_id arguments remain complete | Raw JSONL → parser → ingestion → native comparison |
| Valid thinking/reasoning tool      | Both call and result are preserved                                 | Canonical projection tests                     |
| Two Agent messages with images                | All images participate in history comparison; the model view keeps only the latest image     | Real seed → SQLite → both history projections             |
| Failed result and summary import                | Preserve the error flag, summary type, and full text                   | Real materialization → authoritative read-back    |
| Duplicate import and append new message              | Duplicate import does not write again; rereading after appending the suffix returns empty             | Round-trip test against the same database                            |
| Content or error-flag conflict                  | Reject overwrite; the original record remains readable and unchanged                       | Negative retry assertion                                  |
| Historical image file missing                  | Fail explicitly; do not silently remove the image or change the database             | `load_native_history` negative test                  |
| Old database / subsequent startup               | Added column defaults to false; old content is unchanged; a subsequent migration preserves the written state | In-memory migration test using an old table                              |
| Abort / session switch                  | Preserve existing signal and session-maintenance serialization                 | No async resources added; existing continuation/native suites |

## History compatibility and recovery

No existing user history was cleaned up or rewritten. The new SQLite column is `INTEGER NOT NULL DEFAULT 0`; old JSON continues to load through the serde default, and the frontend field is optional. Database initialization adds the column and can be repeated when it already exists. No dependencies or background migration tasks were added.

After updating, CLI sessions that still retain their complete original files will be reprojected under the corrected rules. Error flags or summary identity already lost in older versions after transfer to Agent cannot be recovered; this change does not guess or bulk-modify those records. Missing original image files are not fabricated as attachments.

When rolling back code, the added column can remain: old code uses explicit column names and ignores it, so there is no need to delete data or downgrade the table. A rollback restores the old projection defects, and older versions will not recognize the added state. A running desktop backend must be rebuilt and restarted to use the new logic.

## Ten-layer check

| Layer | Coverage and boundaries |
| ------------- | --------------------------------------------------------------------- |
| 1. Compilation | Rust targeted tests and TypeScript checks; see the verification record below                   |
| 2. Duplication / call chain | Native and ingestion share argument and name conversion; model and authoritative history each have a distinct entry point    |
| 3. Naming | The exec alias uses the existing resolver; tool names do not serve as private-event types                  |
| 4. Semantic overload | Distinguishes the input wrapper, business call_id, summary boundary, and model view                   |
| 5. Default branch | Legacy error flag defaults to false; missing images reject exact transfer                              |
| 6. Cross-layer boundary | Summary display parsing does not remove or change canonical text; model image cropping does not change history identity         |
| 7. Understandability | New entry points and fields have purpose comments; no additional state service                                |
| 8. Serialization | JSONL, typed seed, SQLite column addition, serde default, and TS field round trip               |
| 9. Entry-point consistency | Codex, Claude, and Agent each have real-source fixtures; no new compatibility claim was made for other providers |
| 10. Symmetry | Reads and writes preserve arguments, tool pairing, failure flags, images, and summaries, and test conflict rejection            |

No repository-wide refactor, UI component review, or real model API call was performed. There are no layout or action-control changes, so visual screenshots are unnecessary.

## Verification record

See the results and performance boundaries in [NativeHistoryFidelity performance and verification record](../org2-performance-guard-2026-09-21/NativeHistoryFidelity.md).

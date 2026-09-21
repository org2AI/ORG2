# Chat response previews and existing expand loading

## Problem and authoritative source

The reported Codex rollout contains the full assistant response: 3,713 UTF-8 bytes and six table rows. The former 512-byte catalog preview ended mid-cell at `指令写…`. The existing assistant fade/expand control only revealed already-loaded DOM content, so it could not recover rows missing from a source excerpt.

The producing boundary is `bounded_codex_turn_preview` in `sources/codex/app/transcript/cache.rs`, through catalog/collector placeholder generation. The original transcript is unchanged. Git records the limit's introduction in `08c61ad66` (Neonforge, July 28, 2026); `e43155e82` (Harry19081, August 9) applies it to unloaded assistant replies.

## Final behavior

- The source preview budget is now **5,120 UTF-8 bytes**, ten times the old budget, plus an ellipsis when truncated. UTF-8 boundaries remain intact. The shared budget applies to catalog user and assistant excerpts.
- The same existing fade and expand/collapse pill loads the full turn through the shared loader when source metadata reports `unloadedTurn.previewTruncated: true`. No new button, label, helper text, or UI shell is added. Loaded-message expansion and live streaming retain their established behavior.
- Complete messages at or below 5,120 bytes use the original 480px (20 × 24px) height rule, regardless of unloaded activities. Only explicitly truncated response text forces a load/expand overlay below that height. Missing metadata and natural ellipses do not imply truncation.
- Both ActivityRouter's assistant shortcut and the registered event renderer pass source metadata to AgentMessageBlock. Their response text is not filtered or rewritten.
- A bounded, per-Jotai-store set of session/turn expansion keys preserves one-click expansion when hydration replaces the preview event ID with the full response event ID. It retains at most 128 small UI keys and no response bodies.
- The original turn/activity expand bar still works independently. Existing translation strings are reused.

Historical remediation: no destructive cleanup or migration. Existing transcript data is intact. The native preview-budget change requires the updated Rust app binary; restarting it also clears old in-memory catalog entries.

## Lifecycle review

| Area               | Verdict | Evidence                                                                              | Change or reason kept                                                                                        | Verification                                                                                      |
| ------------------ | ------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Background work    | keep    | Requests originate only from existing overlay clicks                                  | No polling, automatic retry, mount fetch, or new observer                                                    | Short-preview no-fetch, duplicate-click and eviction tests                                        |
| Memory             | fix     | Preview budget explicitly increased tenfold; UI intent must survive event replacement | Existing catalog/body bounds remain; expansion intent capped at 128 keys per store                           | UTF-8 byte-bound test; expansion eviction and store-isolation tests; existing body registry tests |
| Scope/isolation    | keep    | Expansion keys include session and turn; atom values belong to their Jotai store      | Late failures target the captured reply; existing shared loader deduplicates concurrent consumers            | Late-failure, alternate-turn and alternate-store tests                                            |
| Rendering/hot path | fix     | Full-row replacement previously lost local expansion                                  | Record expansion intent before hydration; an evicted preview stays collapsed and fetches only on a new click | Preview-to-full remount test, collapse test, normal short/long-message tests                      |

The larger budget increases catalog payload retention by up to ten times for long excerpts. Existing caps are eight catalog sessions and 4,096 turns per session; two maximum-size excerpts per turn imply roughly 320 MiB of UTF-8 text at simultaneous saturation, excluding allocation overhead and other caches. This is a capacity calculation, not measured RSS. Reverting the constant restores the former preview budget; no stored-data rollback is required.

## Source verification matrix

| Provider | Raw transition                                           | App/UI state                    | Boundary                    | Expected invariant                                                  | Evidence                              |
| -------- | -------------------------------------------------------- | ------------------------------- | --------------------------- | ------------------------------------------------------------------- | ------------------------------------- |
| Codex    | Two-turn JSONL, old response between 512 and 5,120 bytes | Cold initial window             | Local catalog               | All response bytes retained                                         | Rust fixture test                     |
| Codex    | Two-turn JSONL, old response beyond 5,120 bytes          | Initial window then demand load | Catalog → full turn         | UTF-8-safe preview, complete final row after load, source unchanged | Rust fixture test and source readback |
| Codex    | Existing historical catalog and appended round           | Unit fixtures                   | Local reader                | Discovery and demand loading remain functional                      | Existing catalog/window regressions   |
| UI       | Preview event replaced by full event                     | Mounted response                | Shared overlay/turn context | First expand click loads and remains expanded                       | DOM regression                        |

No cloud transport, account handling, source identity, or ingestion schema changes were made. Two-instance topology and live app CPU/RSS were not exercised.

## Architecture review

Covered compilation, shared loader ownership, both assistant routing entry points, preview/full semantics, empty/error paths, stable session/turn identity, bounded state, and additive preview-truncation metadata computed from the original UTF-8 byte length. No new process initialization or resolver precedence is introduced. Request dispatch remains in the existing turn loader; the overlay supplies user intent.

## Verification

Commands were rerun on the isolated branch based on current develop; final outcomes are recorded in the PR description. Coverage includes raw Codex transcript fixtures, short complete and truncated responses, full-turn hydration, duplicate clicks, failed loads, row replacement, late failure isolation, and bounded expansion state. The existing loader owns body retention; the component creates no background work.

No cloud transport, account handling, source identity, or stored-data format changed. The additive `previewTruncated` JSON field is computed from the original UTF-8 byte length. Missing or false metadata preserves the normal height rule. Native rebuild/restart replaces old in-memory previews. Reverting the change needs no data migration.

The frontend uses `truncatedResponseTurn` and `readTruncatedResponseTurn` to distinguish missing response text from unloaded activity bodies. Reply-key construction stays inside the expansion hook; metadata is validated and destructured once. Both rendering entry points share this path.

Performance verdict: **blocked** for real-app measurements. Live CPU/RSS and desktop visual checks were not run because computer control was not authorized. Automated tests establish byte/state bounds and loading behavior, not measured performance gains. The user reported the final behavior working locally.

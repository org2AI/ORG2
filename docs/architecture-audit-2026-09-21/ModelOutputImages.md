# Model output images

## Root cause and authoritative boundary

The native Codex JSONL transcript for “Create a better ORG2 avatar” contains four image outputs. A read-only probe through the changed production parser recovered all four (4,429,476 data-URL bytes). No source records or generated assets were changed.

Codex replay stripped embedded output bytes before JSON parsing, then projected only text into activity results. Claude replay and live tool-result normalization likewise discarded structured image content. Chat rendered input attachments but had no shared output-image row; activity compaction also hid tool results by default.

The fix preserves explicit image content at these producing boundaries. Codex replay writes small, source-bound references into `result.images`; a thumbnail resolves one record by offset and validates its call ID and content index. Cloud turn export materializes those references into portable bytes. Claude live/replay copies typed image blocks into the existing `result.images` contract. Codex app-server native image-generation events and retained MCP content blocks reach the same shared image row. The turn projection collects output images before collapse and attaches one gallery to its final visible row. Tool activity can collapse normally while the gallery remains below all response text.

Historical remediation is re-projection when history is reloaded by the rebuilt app. There is no destructive cleanup or source-data migration. This does not recover files or transcript payloads already deleted outside the app.

## Architecture review

Covered layers 1–8: compilation and focused tests; production ingestion-to-render call chains; one output-image contract; input versus output semantics; unknown-content defaults; provider-specific offsets confined to Codex; documented lazy readers; IPC references versus portable export bytes. Layers 9–10 checked for applicability: no session initialization or settings resolver changes. Native live and external replay paths have separate fixtures. No database, public command, or persistence schema changes.

The UI uses an end-of-response gallery with a left thumbnail rail and an uncropped selected image in a 384px-wide, 320px-high gallery. It reuses shared Button and ChatImageThumbnail, including the existing image overlay, loading, failure, and teardown behavior. The follow-up UI audit records 0 fix, 4 keep with reason, 0 abstract in docs/frontend-ui-audit-2026-09-21/OutputImageGallery.md.

## Performance review

| Area               | Verdict | Evidence                                                   | Change or reason kept                                                                 | Verification                                       |
| ------------------ | ------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Background work    | keep    | No timers, watchers, subprocesses or subscriptions added   | Reads remain demand-driven and use the existing two-read backend semaphore            | Source inspection; existing image request tests    |
| Memory             | fix     | Codex replay carries references instead of image bytes     | One source record read, capped at 32 MiB; no new global cache                         | Lazy-reference regression and actual-session probe |
| Scope/isolation    | keep    | Reference includes session, offset, call ID and part index | Existing session path resolver owns access; stale identities fail                     | Wrong-call identity test                           |
| Rendering/hot path | fix     | Grouping checks metadata without constructing base64 URLs  | Reuse thumbnail ownership and disposal; turn gallery remains outside collapsed groups | Projection and server-render tests                 |

| Provider         | Raw transition                                        | App/UI state                                      | Topology/boundary                    | Expected invariant                                        | Observed evidence                         |
| ---------------- | ----------------------------------------------------- | ------------------------------------------------- | ------------------------------------ | --------------------------------------------------------- | ----------------------------------------- |
| Codex desktop    | Existing avatar transcript                            | Read-only parser probe                            | Local ingestion and image resolution | All generated images recoverable                          | 4 images resolved                         |
| Codex rollout    | Full replay twice                                     | Fixture                                           | Local ingestion                      | Stable single image per output, no inline bytes in replay | Regression test                           |
| Codex rollout    | Requested cloud turn                                  | Fixture                                           | Export boundary                      | Export contains portable bytes                            | Regression test; network transfer not run |
| Claude Code      | Tool result row                                       | Fixture                                           | External replay                      | Typed output image preserved                              | Regression test                           |
| Claude Code      | Tool result event                                     | Fixture                                           | Live parser                          | Typed output image preserved                              | Native Rust parser test                   |
| Codex app-server | Completed imageGeneration                             | Fixture derived from installed CLI protocol types | Live parser                          | Native image output preserved                             | Native Rust parser test                   |
| MCP              | Structured content                                    | Server render                                     | Shared renderer                      | Image visible with collapsed tool details                 | Vitest                                    |
| All above        | Rewrite, rotate, delete, restart, hidden/visible idle | Running desktop                                   | Local and secondary instances        | No stale media or resource growth                         | Not run                                   |

Performance verdict: blocked for desktop runtime measurements and multi-instance/network verification. Computer control was not authorized. Source and automated checks establish bounded reads and cleanup ownership; they do not establish measured idle CPU/RSS or end-to-end cloud rendering. Other harness-specific image envelopes (including ACP) are not claimed as verified.

## Verification

- `pnpm test src/engines/ChatPanel/rendering/outputImages.test.ts src/engines/ChatPanel/rendering/adapters/FallbackAdapter.test.ts src/api/tauri/externalHistory/sources/codexApp/images.test.ts` — 9 passed
- `pnpm test src/engines/ChatPanel/ChatHistory/projection/__tests__/compactToolActivity.test.ts src/engines/ChatPanel/ChatHistory/chatItemPipeline/__tests__/pipeline.grouping.test.ts src/engines/ChatPanel/rendering/outputImages.test.ts src/engines/ChatPanel/rendering/adapters/FallbackAdapter.test.ts` — 62 passed
- `pnpm typecheck:fast` — passed
- ESLint on changed TypeScript files — passed
- `cargo test --manifest-path src-tauri/Cargo.toml -p orgtrack_core --features source-codex,source-claude-code --lib image -- --nocapture` — 22 passed, 2 existing acceptance tests ignored
- `cargo test --manifest-path src-tauri/Cargo.toml --lib live_tool_result_preserves_structured_images -- --nocapture` — passed; macOS linker emitted a large unwind-table warning
- `cargo test --manifest-path src-tauri/Cargo.toml -p orgtrack_core --features source-codex,source-claude-code --lib` — 709 passed, 10 ignored
- `pnpm test src/engines/ChatPanel/rendering/outputImages.test.ts src/engines/ChatPanel/rendering/adapters/FallbackAdapter.test.ts src/engines/ChatPanel/ChatHistory/projection/__tests__/compactToolActivity.test.ts` — 22 passed after the final image/text separation change
- `pnpm check:circular` — failed with six cycles outside the changed modules (icons, HoverCard, MarketConnect, SessionCore/composer, and MobileRemote)
- `cargo test --manifest-path src-tauri/Cargo.toml --lib completed_image_generation_preserves_output -- --nocapture` — passed; macOS linker emitted a large unwind-table warning
- `git diff --check` — passed

## Limits and recovery

No app build was installed or running instance restarted. Visual desktop verification, other harness-specific protocols, full cross-harness continuation, and cloud upload/download are unverified. Revert the scoped source changes to restore previous projection behavior; native transcripts and generated files remain untouched. Existing unrelated working-tree changes were preserved.

## End-of-response gallery follow-up

User-requested layout: images after all response text, never inside the collapsed work section; thumbnail rail on the left. Gallery collection occurs before collapse, including grouped tool results. The final surviving row owns the gallery without adding virtual rows or changing search-index mapping. User input images are excluded; duplicate output references within a turn are consolidated. Selection retains only an index, and image hooks retain their existing unmount disposal and stale-completion guards. No new global cache, polling, or listener was added. Codex historical turn bodies remain lazy, but their generated-image references now travel with the initial collapsed preview.

- Targeted gallery/projection/worker static-graph tests: 70 passed
- Renderer placement, memo invalidation, collapsed image-only turn, and inline-duplicate suppression tests: 9 passed
- Final follow-up `pnpm typecheck:fast`, ESLint on changed frontend files, and `git diff --check`: passed
- Desktop visual and runtime performance measurements remain unverified; no computer control was used

## Collapsed initial-window correction

The authoritative source is the unchanged Codex rollout JSONL. Full replay preserved output images, but the reverse catalog writer (`observe_codex_catalog_line`) retained only the user header and final assistant text. `build_unloaded_turn_placeholder_chunk` consequently emitted no output image metadata until expanding the turn fetched its tool body.

The catalog now borrows image strings during deserialization and retains only source offsets plus call/part identities, bounded to 2 KiB per turn within the existing bounded session catalog. Initial placeholders, preceding-turn context placeholders, and fallback turn compaction carry output references. Image byte retrieval remains on demand; no new timers, watchers, or global caches. Reverse-scan line-size limits still apply, and oversized catalogs retain a bounded subset of references; full turn loading remains available. This initial-window correction is verified for Codex; historical Claude/MCP windows beyond loaded bodies are not covered by this correction.

Historical remediation: reopen/reload the session with the rebuilt backend to regenerate its preview; no transcript rewrite or migration is needed. Frontend hot reload alone cannot replace the native catalog implementation.

Verification added:

- `cargo test --manifest-path src-tauri/Cargo.toml -p orgtrack_core --features source-codex,source-claude-code --lib generated_output_images --quiet` — passed initial catalog/cache and lazy byte resolution regression
- `ORGII_CODEX_ROLLOUT_FIXTURE=<local rollout> cargo test --manifest-path src-tauri/Cargo.toml -p orgtrack_core --features source-codex,source-claude-code --lib real_generated_images_in_collapsed_preview -- --ignored --nocapture` — passed; all four actual avatar images resolve from the initial window without loading a turn body through expansion
- `pnpm test src/engines/ChatPanel/ChatHistory/hooks/__tests__/useChatGroupsProjection.test.ts` — 49 passed, including output references carried by an unloaded preview

Architecture coverage: source ingestion, catalog retention, replay projection, and UI ownership. No persistence schema, cloud wire format, or authentication changes in this follow-up. Performance verification remains source/test based: bounded retained descriptors and existing cache invalidation; desktop CPU/RSS and visual verification were not run.

- Executed the freshly compiled `orgtrack_core-bdabd96b2b1932a1 --quiet` test binary directly while another app build held Cargo's lock: 709 passed, 11 ignored. Cancelled the redundant Cargo test waiter; did not interrupt the app build
- Follow-up `pnpm typecheck:fast`, ESLint for the changed projection test (after formatting), and `git diff --check` passed

## Later-round images and EventStore cleanup

The earlier acceptance test stopped at the transcript loader. The next owning boundary, EventStore shell hydration, clears `result` after creating a bounded terminal replay preview. Generated images attached to shell-classified outputs can therefore be removed, while assistant-shaped collapsed placeholders keep their references. Subsequent inspection established that the actual avatar calls normalize to `image_gen__imagegen`, so this shared-shell defect was not the cause of this session’s remaining rendering failure. The authoritative rollout remains intact. The new acceptance test carries the actual initial window through normalization and EventStore storage.

The required invariant is that terminal text compaction removes terminal output fields while retaining the canonical `images` field. Both completed/replay-backed sanitation and the running, unbacked preview branch must use the same cleanup. Media ownership remains with the event; no extra image-byte copies, file reads, timers or caches are needed. Re-loading from the provider transcript repairs already compacted in-memory events without rewriting history.

Architecture checklist: compilation is checked by the targeted native test build; one cleanup helper owns the two equivalent result-clearing paths (layers 1–2); its name and comment distinguish output text from image metadata (3–4, 7); non-object/empty results retain their prior empty-object behavior (5); no Codex-specific logic enters the shared cleanup (6); the existing `result.images` wire field is preserved, without a schema change (8); hydration and live insertion use the same invariant (9); source/image resolution order is unchanged (10).

| Area               | Verdict | Evidence                                       | Change or reason kept                                                                          | Verification                                         |
| ------------------ | ------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Background work    | keep    | Cleanup runs only on event writes/hydration    | No timers, scans, or subscriptions added                                                       | Source trace                                         |
| Memory             | fix     | Whole-result clearing deleted image references | Retain existing media in place while releasing terminal text; existing event/window caps apply | Hydration/live regression with large terminal output |
| Scope/isolation    | keep    | Metadata remains on the owning session event   | No new cache or cross-session state                                                            | Source trace                                         |
| Rendering/hot path | keep    | Gallery reads canonical result.images          | No frontend workaround                                                                         | Existing gallery/projection tests                    |

Desktop rendering, hidden/visible CPU/RSS and cross-machine transport are not measured. This follow-up makes no runtime performance or cross-provider end-to-end claims.

Verification for the EventStore correction:

- `ORGII_CODEX_ROLLOUT_FIXTURE=<local rollout> cargo test --manifest-path src-tauri/Cargo.toml --lib real_generated_images_survive_initial_window_event_store -- --ignored --nocapture` — passed, four output images before and after EventStore hydration
- Freshly built native test binary `app_lib-a48a2d335572496c agent_sessions::event_pipeline::store::tests:: --nocapture` — 81 passed, one local-fixture acceptance test ignored (run separately above)
- Native build emitted the existing macOS large unwind-table linker warning
- `git diff --check` — passed
- Source review confirms image values are retained in place, terminal text is still removed, and no background resource is added. Performance verdict: source/test checks pass; desktop CPU/RSS not measured

| Provider               | Raw transition                                                 | App/UI state               | Topology/boundary           | Expected invariant                                          | Observed evidence              |
| ---------------------- | -------------------------------------------------------------- | -------------------------- | --------------------------- | ----------------------------------------------------------- | ------------------------------ |
| Codex app              | Actual avatar rollout → initial window → normalization → store | Test harness, no GUI       | Local hydration             | All four outputs survive, including the loaded latest round | Passed real-rollout acceptance |
| Canonical shell events | 100 KB output plus image references → hydrate/upsert           | Running/completed fixtures | Shared store write boundary | Release terminal text and preserve images                   | Passed regression              |

## Latest-round status footer correction

The actual stored avatar events and full chat projection retain two output images in each of two turns. `ChatHistoryList` appends `AgentStatusTrail` to the latest group and computes row metadata from the augmented counts. Consequently the latest response has `isLastItemInGroup=false`. `GroupItemRenderer` incorrectly required that flag as well as projected `outputImages`, hiding only the latest gallery.

Removed the redundant renderer flag condition. Gallery ownership remains exclusively assigned by `projectChatGroups` to the final surviving response row; status/footer semantics and virtual row counts are unchanged. This is a presentation defect, not malformed persisted data. No transcript cleanup, background resource, or schema change is required.

- Added a permanent regression using production `buildRowGroupMeta([1, 2])` to reproduce two response rounds plus the latest status footer. It failed before the fix (one gallery instead of two) and passes afterward, checking all four thumbnail sources
- `pnpm test src/engines/ChatPanel/ChatHistory/renderers/GroupItemRenderer.gallery.test.ts src/engines/ChatPanel/ChatHistory/components/__tests__/ChatHistoryListStatusTrail.test.ts src/engines/ChatPanel/ChatHistory/hooks/__tests__/useChatGroupsProjection.test.ts` — 58 passed
- Temporary local acceptance: exported actual avatar events from native ingestion/EventStore, passed them through `projectChatHistory`, then rendered both `GroupItemRenderer` rows with footer-adjusted row metadata; two galleries/four thumbnails passed. Removed the temporary fixture, test, and export hook after verification
- No desktop UI control was used; verification is production projection plus server-rendered React markup

## PR integration verification

Applied this change cleanly to the latest fetched `origin/develop` in an isolated worktree. Typecheck, ESLint across changed TypeScript files, and `git diff --check` passed. The focused frontend suite (gallery, output extraction, projection, renderer, status trail, and latest ChatHistory lazy boundary) passed 84 tests. The orgtrack core suite passed 709 tests with 11 optional/acceptance tests ignored. No unrelated working-tree edits, local fixture exports, generated media, or personal filesystem paths are included.

## Data privacy and memory isolation

See [Generated images: data privacy and isolation](../generated-image-data-privacy.md) for the reciprocal private-data access requirements, explicit sharing boundaries, personal-memory separation, verified gallery safeguards, and outstanding cross-user tests. Source identity validation and per-turn grouping are not substitutes for user authorization. The gallery adds no memory extraction, but the broader agent-scoped learning system has not been verified here to exclude another user's private data.

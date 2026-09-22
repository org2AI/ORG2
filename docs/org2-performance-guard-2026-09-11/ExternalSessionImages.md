# External-session screenshot replay

## Protected screenshot files

The thumbnail tried to open another application's macOS screenshot temporary file. The live frontend log captured `Operation not permitted (os error 1)` from the filesystem read, even though the file existed. This is the remaining failure behind the unavailable-image icon; passing a shell existence check did not prove the ORGII process could read it.

Older Codex headers now contain an internal `orgii-transcript-image:` reference with the session ID, byte-offset turn ID, and original attachment reference. The filename normalizer still resolves the original path for display. The thumbnail requests `session_history_image` only when mounted. The command resolves the source through the existing managed/imported session resolver, validates that the original reference still belongs to that user row, and reads its embedded image directly. It does not expand the conversation body or accept arbitrary transcript paths. If no embedded image exists, the existing original-file path remains the fallback.

Two backend reads can be active at once. Frontend coalescing retains at most 32 pending keys and deletes entries on both success and failure; completed image data belongs only to the mounted thumbnail, with late completions discarded after unmount. No completed-byte cache, new polling, or persistence change was added. Full canonical export remains unchanged; this internal reference is a local preview format and needs the matching new backend command. A native rebuild/restart is required.

The exact screenshot in the follow-up was recovered through the new source-image reader: 50,790-byte embedded PNG data URL. The filesystem-read mock is not called in the protected-file thumbnail regression. Checks: 651 Rust core tests; 33 targeted frontend tests; typecheck and ESLint passed. The final 256-screenshot resource rerun produced a 508,262-byte initial response and 16,187,392-byte peak parser RSS; this includes the new lightweight descriptors. `cargo check --manifest-path src-tauri/Cargo.toml -p org2 --lib -j 2` passed, including registration of the new native command. Live visual confirmation and decoded WebView memory remain unverified.

## Source and root cause

The authoritative artifacts are the providers' JSONL transcripts. The reported Codex message contains both a portable PNG data URL in a `response_item/message` and a local path in the following `item_completed/UserMessage`. The original local screenshot also existed during inspection.

Codex's fast catalog discarded `image_refs` when constructing older user headers. Bounded turn reads started at the later UI mirror, bypassing the embedded image record. The complete-history parser already paired these records, so complete-history tests did not cover the failing production window path.

Claude's index required nonempty text and omitted image-only user turns. Its full parser ignored URL image sources. The shared imported-window projection also recreated older headers without attachments. Finally, the managed CLI adapter and thumbnail resolver treated HTTP image references as filesystem paths.

## Change and source invariant

- Codex catalogs and shared older-header projection preserve bounded path/URL references. They never retain base64 image bodies. Image-only Codex headers retain the existing `(image)` placeholder when no lightweight reference is available.
- Codex bounded reads inspect the immediately preceding JSONL record for the user image data. This preserves byte-offset turn IDs and does not scan unrelated turns. A 64 KiB scan buffer locates the record; the prefix is capped at 16 MiB. Temporary parsing allocations are released when the read finishes.
- Claude indexes recognize image-only turns. URL references remain in older headers; embedded-only headers use the existing `(image)` placeholder until expansion. Full/expanded replay retains actual image data.
- A shared reference projection caps each header at 2,048 bytes including String entry overhead. Excess references and data URLs remain available in full turn reads.
- HTTP/blob/data references pass to the browser. Local and Tauri asset references retain the existing readFile/object-URL lifecycle.

No provider transcript or persisted database was modified. Existing history is repaired by re-reading it with the updated code. No destructive remediation, schema migration, or new disk cache is needed.

## Performance and lifecycle review

| Area               | Verdict | Evidence                                                                            | Change or reason kept                                                                              | Verification                                                                            |
| ------------------ | ------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Background work    | keep    | No new timer, watcher, subscription, worker or retry                                | Reads remain request-driven                                                                        | Call-chain inspection                                                                   |
| Memory             | fix     | Headers previously lost attachments; retaining base64 there would grow with history | 2 KiB/reference-list cap; existing Codex 4,096-turn and 8-session catalog caps; no new image cache | Reference-bound test, serialized-window assertion, screenshot-heavy resource acceptance |
| Scope/isolation    | keep    | Existing provider path/signature cache ownership                                    | Prefix reads use the same selected transcript; no new identity cache                               | Existing core tests; no cross-account runtime claim                                     |
| Rendering/hot path | fix     | HTTP refs entered filesystem loader                                                 | Browser-managed lazy image fetch without a JS byte copy                                            | Thumbnail and CLI adapter tests                                                         |
| Cleanup            | keep    | Local effect owns object URL; late completion checks cancellation                   | Unmount releases completed and late-created object URLs                                            | Thumbnail cleanup regression tests                                                      |

App startup, idle, hidden, focus return, offline and shutdown acquire no new background resources. Unopened sessions do not trigger the prefix reader. Source deletion propagates a read error; partial/oversized prefixes retain the UI record's existing references. Source-backed Codex thumbnails recover embedded data on mount; original-file fallback can remain unavailable when the source has no embedded copy. Browser remote URLs remain subject to network availability. Account/endpoint changes, revocation, secondary instances and remote transport are unchanged and were not exercised live.

## Provider evidence

| Provider       | Raw transition                                       | App/UI state                                       | Topology/boundary                                      | Expected invariant                                       | Observed evidence                                                                   |
| -------------- | ---------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Codex          | Saved reported screenshot                            | Cold replay and exact turn expansion               | Real local JSONL, parser entry points                  | Header reference and expanded PNG survive                | 1 header image; 6,410-byte embedded data URL recovered                              |
| Codex          | Three screenshot turns                               | Cold and repeated warm reads; older turn expansion | Synthetic raw JSONL, initial/turn/cloud-window readers | Older headers remain small; selected bytes survive       | Regression passes; initial wire payload limited to one embedded image plus metadata |
| Codex          | 16 vs 256 screenshots                                | Ten sequential loads                               | Synthetic raw JSONL, isolated test process             | No full-history image retention                          | Resource measurement below                                                          |
| Codex          | Oversized prefix and non-image intervening row       | Bounded read                                       | Raw prefix fixture                                     | Do not recover another turn's image or exceed scan cap   | Prefix regression test                                                              |
| Claude         | URL-only and base64-only user rows, followed by text | Initial window and older turn expansion            | Raw JSONL fixture                                      | All user turns remain reachable; old headers omit base64 | Window regression test                                                              |
| Claude         | URL-only user row                                    | Full read                                          | Raw JSONL fixture                                      | URL survives ingestion                                   | Source regression test                                                              |
| Codex / Claude | Live append, rewrite, rotation, fork and restart     | Active/pinned desktop row                          | Tauri UI / multiple machines / cloud transport         | End-to-end visible behavior                              | Not run; existing core suite is not live UI evidence                                |

## Resource measurement

The ignored `screenshot_history_resource_acceptance` test writes one 256 KiB embedded image per turn, then loads and serializes the initial window ten times. `/usr/bin/time -l` measures the test executable, excluding Cargo compilation. These are absolute measurements of the patched parser, not a before/after desktop benchmark.

| Turns | Source bytes | Maximum initial wire bytes |            Peak process RSS |
| ----- | -----------: | -------------------------: | --------------------------: |
| 256   |   67,173,924 |                    508,262 | 16,187,392 bytes (15.4 MiB) |

The additional memory is bounded metadata and one loaded turn, not all embedded screenshots. Actual decoded WebView image memory and visible/hidden desktop RSS remain unmeasured.

## Architecture review

All ten layers were considered within this attachment change: compilation; duplicate ownership (one bounded reference helper); naming (`image_refs` includes URLs); semantic distinction between portable bytes and lightweight references; URL-vs-file default branches; provider-specific parsing kept in provider modules; explicit prefix-reader limits; actual serialized wire sizes; parity across full/initial/expanded/cloud-window entry points; and symmetric attachment resolution. No unrelated architecture or UI consistency refactor was performed. The single thumbnail bug fix does not require a frontend UI audit.

## Verification commands

- `cargo test --manifest-path src-tauri/Cargo.toml -p orgtrack_core --lib --features source-codex,source-claude-code --quiet` — 651 passed, 10 opt-in tests ignored in the default run
- `cargo clippy --manifest-path src-tauri/Cargo.toml -p orgtrack_core --lib --features source-codex,source-claude-code -- -D warnings` — passed
- `pnpm test src/components/ChatImageThumbnail/index.test.ts src/util/file/__tests__/imageRefs.test.ts src/api/tauri/externalHistory/sources/codexApp/images.test.ts src/engines/SessionCore/sync/adapters/cli/__tests__/cliHistory.test.ts src/engines/SessionCore/turns/nativeCliTurnLoader.test.ts` — 33 passed
- `pnpm run typecheck:fast` — passed
- `pnpm exec eslint` on the eight changed TypeScript/TSX source/test files with `--max-warnings 0` — passed
- `git diff --check` — passed
- Test executable with `screenshot_history_resource_acceptance --ignored --nocapture`, `ORGII_IMAGE_TEST_TURNS=16` and `256`, under `/usr/bin/time -l` — passed
- Test executable with `real_screenshot_replay_acceptance --ignored --nocapture`, local fixture and expected prompt environment variables — passed; private paths and message contents are not embedded in the test or report

Performance verdict: blocked for live Tauri/WebView lifecycle certification. Bounded-parser memory and object-URL cleanup checks pass. Computer control was not authorized, so no desktop UI automation was used. Other providers, cross-machine image portability and arbitrary remote image server behavior are not claimed as verified.

- `cargo check --manifest-path src-tauri/Cargo.toml -p org2 --lib -j 2` — passed, including the new command registration
- `pnpm run check:test-placement` — passed

No app restart or computer-control action was performed. Parser/RPC compilation and test results do not establish that the running desktop process has loaded the new backend yet.

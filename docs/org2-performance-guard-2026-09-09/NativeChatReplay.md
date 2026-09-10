# Managed native Chat replay performance

## Verdict and scope

The measured managed Codex/Claude Chat opening, external append, and repeated Reload paths pass this regression acceptance. This is not a certification of every ORG2 workflow, every provider, or two physical machines.

The authoritative data remains the provider JSONL. No real history was edited or deleted. Historical in-memory projections are rebuilt by Reload or native refresh; there is no migration or destructive remediation.

## Producing paths and fixes

1. Chat previously transferred complete chunks Rust → JavaScript → Rust normalization → JavaScript → Rust store hydration. `cli_agent_history` now normalizes in Rust and supports separate full, preview, and single-turn reads. Chat and idle refresh use one recent body plus older turn previews; canonical continuation/export reads remain full.
2. Exact native-path lookup is followed by the existing provider discovery resolver. A moved/legacy Claude file must stay on the windowed reader too. The first candidate missed this path and still reached 7420.90 MiB; the final path resolves the file before reading its window. Neither project names nor repository paths are hardcoded.
3. `ConversationStreamProvider` now checks for execution children before loading a second complete canonical root. With children, the existing full prefix verification remains intact.
4. Idle CLI cold loading owns one store hydration. The later Jotai load does not merge the same replay again. This prevents the 8000-event cap's evicted prefix from being appended back at the tail. Synthetic pending inputs retain their separate rescue merge.
5. A replacement containing unloaded turns is marked as a round window at the Rust store boundary. Refresh clears loaded-body bookkeeping and advances the view epoch so older bodies can be fetched again.
6. Managed native turns use the shared loader/eviction registry. Codex window IDs resolve directly to byte offsets; a preceding full canonical read cannot redirect them through the legacy sequential-ID cache.
7. Concurrent equivalent reads share pending promises only, with a maximum of eight tracked keys including the observed native revision. Completed bodies are not cached there. An unavailable probe disables coalescing rather than disabling history loading.

| Area               | Verdict    | Evidence                                                                               | Change or reason kept                                                                                        | Verification                                                                                                  |
| ------------------ | ---------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Background work    | fix / keep | Active loaded idle session owns the scheduler                                          | Existing 30s focused / 60s unfocused / hidden-off scheduler, stable revision and focus catch-up retained     | Scheduler, cancellation, busy-state and generation tests; raw append shown without Reload                     |
| Memory             | fix        | Complete body transfers and duplicate root/hydration were the large allocation sources | Windowed UI reads, pending-only sharing, existing loaded-turn eviction; full canonical reads remain separate | Real Tauri 1/16/64 MiB fixture matrix, 20 Reload pipelines, cooldown and exit                                 |
| Scope/isolation    | keep / fix | Managed account UUID and provider path resolvers own source selection                  | Reuse exact and discovery paths; stale-result guards and versioned replacement retained                      | Exact and moved raw-file regressions for both providers; different-revision coalescing and cancellation tests |
| Rendering/hot path | fix        | Empty child tails previously required a complete root read                             | Query child directory first; skip body hydration when empty                                                  | Producer guard test, actual mounted Chat and old-turn expansion                                               |

Architecture coverage: history ownership, canonical versus display data, resolver parity, IPC contracts, and asynchronous replacement/lifecycle boundaries. Unrelated FSM, plugin, and database-schema redesigns were not undertaken. React performance evidence concerns actual history allocations and duplicate work; it is not inferred from typecheck results.

## Measurement method

macOS optimized `dev-build` Tauri package, normal Instance 3 identity, isolated ORGII home and native/external provider roots, signed out. Six raw provider fixtures contain 64, 1024, or 4096 user/assistant turns, with approximately 16 KiB assistant bodies. Only session bindings/source-path metadata were seeded; no normalized history bodies were seeded. No model/API requests or credentials were used.

A calibrated per-second libproc sampler measured the main, GPU, Networking, and WebContent processes (one core = 100%, Mach timebase 125/3). Summed physical footprints can count shared pages more than once; they are not unique host RAM. Other user applications remained running. These are local regression measurements, not a controlled develop-versus-PR A/B. Observation durations include interaction/cooldown and are not first-paint latency.

The earlier failing package included the independent SQLite fingerprint fix (#1475). The new isolated run has no Cursor workload, so it does not re-certify that separate fix.

### Large-history comparison

| Observation                                                                 |    Previous failing peak | Windowed peak | End of observation |
| --------------------------------------------------------------------------- | -----------------------: | ------------: | -----------------: |
| Codex cold open, 70,436,948-byte JSONL                                      |            10,955.76 MiB |  1,420.05 MiB |         666.71 MiB |
| Codex two short raw records appended, focus catch-up                        |            12,114.78 MiB |  1,482.50 MiB |         805.46 MiB |
| Claude cold open, 72,947,506-byte JSONL in legacy project directory         |            10,100.87 MiB |  1,431.86 MiB |         870.15 MiB |
| Claude 1,145,506-byte append (128 bounded records), plus old-turn expansion | Not previously certified |  1,999.40 MiB |         778.74 MiB |

Both appended user and assistant markers were seen in Chat without Reload. Native-window focus was intermittent under automation, so append observation duration is not a certified refresh-latency measurement. The first Codex fixture uses equal user/assistant timestamps and is not counted as ordering evidence; subsequent fixture ordering checks use distinct timestamps. Equal-timestamp UI grouping remains unverified.

### Mounted matrix and repetition

These rows share an app process and include retained state from earlier opened tabs; the small fixtures are not independent clean-process baselines.

| Observation                                            | Duration | Mean CPU | Peak footprint | Final footprint |
| ------------------------------------------------------ | -------: | -------: | -------------: | --------------: |
| Codex 16 MiB class, including old-turn load            |   71.39s |    9.67% |   1,160.57 MiB |      864.90 MiB |
| Claude 16 MiB class                                    |   61.26s |    4.01% |   1,107.74 MiB |      855.77 MiB |
| Codex 1 MiB class                                      |   52.21s |    3.91% |   1,120.57 MiB |      911.46 MiB |
| Claude 1 MiB class                                     |   58.21s |    3.39% |   1,151.38 MiB |      966.94 MiB |
| Claude loaded idle                                     |   50.19s |    1.45% |     778.83 MiB |      778.83 MiB |
| Claude large-session reopen                            |   46.18s |    9.59% |   1,977.44 MiB |    1,168.26 MiB |
| Reload 1                                               |   66.27s |    9.64% |   2,171.02 MiB |    1,031.16 MiB |
| Reload 2                                               |  108.45s |    7.30% |   2,228.07 MiB |    1,048.91 MiB |
| Reloads 3–20                                           |  632.48s |   16.61% |   2,241.02 MiB |      948.15 MiB |
| Cooldown, minimize/restore and quit-dialog interaction |  140.52s |    2.36% |   1,159.07 MiB |      768.16 MiB |

The frontend log independently records all 20 Reload pipelines. Latest user/assistant markers remained visible after each cycle. Peak footprint plateaued rather than increasing with every reload; this finite run is not a proof against every leak. All four attributed processes disappeared after normal UI quit; the existing independent Instance 2 remained alive. The samplers were stopped.

| Provider                   | Raw transition                                               | App/UI state                       | Topology/boundary                            | Expected invariant                                                 | Observed evidence                                                                     |
| -------------------------- | ------------------------------------------------------------ | ---------------------------------- | -------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| Codex                      | 1/16/64 MiB raw histories                                    | First open                         | Local JSONL → actual Chat                    | Newest turn retained, no re-appended capped prefix                 | Passed                                                                                |
| Codex                      | Two short appended records                                   | Existing Chat open, focus return   | Local JSONL → Chat                           | New user and answer without Reload                                 | Passed                                                                                |
| Claude                     | 1/16/64 MiB raw histories in a legacy directory              | First open                         | Discovery path → windowed RPC → Chat         | Discovery must not restore full replay cost                        | Passed after fixing the fallback                                                      |
| Claude                     | 128 appended records, about 1.1 MiB                          | Existing Chat open                 | Local JSONL → Chat                           | Latest new user/answer appear automatically                        | Passed                                                                                |
| Both                       | Older body selected                                          | Existing Chat                      | Raw turn reader → store merge → expansion UI | Fetch matching turn; retain real body                              | Rust producer/store regressions passed; actual loading and Expand affordance observed |
| Both                       | Raw file relocated                                           | Unit sandbox                       | Exact resolver → discovered source path      | Same preview and old body, without full fallback                   | Passed; Codex alternate path uses source-path index metadata                          |
| Claude                     | Unchanged source, 20 Reloads                                 | Same large session                 | Mounted subscriber and store lifecycle       | No missing newest turn, overlapping accumulation or process growth | Passed in this finite local run                                                       |
| Both                       | Vendor compaction/rotation/delete/fork, real account changes | Not exercised in this pressure run | Provider-specific lifecycle                  | Requires independent evidence                                      | Not run; do not infer from append or relocation tests                                 |
| Team Chat / remote machine | Transport / receiving replay                                 | Not exercised in this pressure run | Cloud and second physical machine            | Separate from local native hydration                               | Not re-certified here                                                                 |

## Limits and rollback

- The original pressure run did not certify full-history continuation/export resources. The streaming follow-up below supersedes this limitation for the managed native reader, file export and native item projection; complete-output compatibility APIs still retain their final result.
- Windows retain a recent complete turn, so this is not a hard byte limit for an arbitrarily huge single turn. The existing 8000-event UI cap remains; native history is not deleted by it.
- Initial discovery/indexing can scan provider files. Polling is eventual, not a push bridge from the native App.
- macOS rendered verification does not establish Windows/Linux rendered behavior or physical dual-machine behavior. Authenticated native App generation was not repeated with these synthetic, signed-out performance fixtures.
- Frontend/backend must ship together for the new `cli_agent_history` command and the existing optional versioned-set input. No dependency, database migration, persisted format change, or historical cleanup is required. Rollback is reverting the bundled app.
- UI layout/styling did not change. Existing Chat/expand/Reload controls were inspected in the actual app; no screenshot containing unrelated user material is required for the implementation diff.

## Commands and results

- `pnpm test src/engines/SessionCore/sync/__tests__ src/engines/SessionCore/core/store/__tests__ src/engines/ChatPanel/ChatHistory/hooks/__tests__/useReloadSession.test.ts src/api/tauri/rpc/__tests__/sessionCoreSchemas.test.ts src/engines/SessionCore/core/atoms/__tests__/actions.test.ts src/engines/SessionCore/sync/adapters/cli/__tests__/cliHistory.test.ts src/engines/SessionCore/turns/nativeCliTurnLoader.test.ts src/engines/SessionCore/turns/loadedTurnRegistry.test.ts src/engines/ChatPanel/ConversationStreamProvider.test.ts` — 248 passed in 29 files.
- `CARGO_TARGET_DIR=<shared-target> cargo test --manifest-path src-tauri/Cargo.toml --lib agent_sessions::` — 851 passed, 4 ignored after discovery fallback integration. The native-window test was then strengthened to assert requested body identity and real EventStore merging; its targeted rerun passed.
- `CARGO_TARGET_DIR=<shared-target> cargo clippy --manifest-path src-tauri/Cargo.toml --lib -- -D warnings` — passed after discovery fallback integration.
- `pnpm typecheck:fast`, ESLint on changed frontend paths, `pnpm run check:test-placement`, and `git diff --check` — checked during delivery.
- `pnpm run build` and `TAURI_CONFIG='{"identifier":"org2ai.org2.instance3","productName":"ORG2 Performance"}' CARGO_TARGET_DIR=<shared-target> cargo rustc --manifest-path src-tauri/Cargo.toml --bin org2 --profile dev-build --features tauri/custom-protocol -- -C strip=none` — actual isolated packages built and signed/verified before testing.

The bulk measurement package preceded only the final optional-probe error fallback in TypeScript; that fallback has a targeted regression. Final package smoke verification is recorded in the PR. No claim of improved failed-probe performance is made from the normal-path measurements.

## Additional canonical export and source-transition acceptance

Further acceptance found two concrete defects after the original Chat-only verdict:

- The Sidebar Markdown action actually exported the mounted EventStore, not canonical history. That could omit unloaded bodies or an entirely unopened session. The earlier broad statement that export already loaded full canonical history was inaccurate. Managed CLI exports now resolve full account-bound history in Rust. The production action supplies the selected `outputPath`, writes through a buffered temporary file and atomically replaces the destination only after success. The full Markdown no longer travels through the WebView. Existing callers omitting `outputPath` retain the string response; non-CLI source selection is unchanged.
- Codex treated any larger file as append and merged its previous catalog. A larger atomic replacement reproduced stale old user rows. Changed revisions now rebuild the bounded reverse-scanned catalog; unchanged revisions retain the cache. This trades changed-file scan I/O for correctness and does not add a timer. In-place larger rewrites are handled by the same boundary.

Both changes directly protect the native window hydration introduced by this PR. Provider JSONL remains authoritative; no real history or cloud rows were modified.

### Additional automated evidence

- The new Codex atomic-replacement regression failed before the fix and passed afterwards; `cargo test --manifest-path src-tauri/Cargo.toml -p orgtrack_core sources::codex::` passed 83 tests, with 1 explicit fixture-dependent test ignored.
- The managed provider regression exercises Codex and Claude raw compaction records after warm window/discovery reads, then truncation, larger in-place rewrite and larger atomic replacement. Full export must exclude compact summaries as user messages, contain the actual latest assistant body and not resurrect old users. Both providers passed through the production reader and real EventStore replacement.
- Explicit ignored resource test `managed_native_full_export_large_history_acceptance` ran with 4096 turns of approximately 16 KiB assistant bodies per provider. File and string export modes retained every user/assistant pair, including history beyond the UI event cap, and oldest body tails. This test also exercises preview/full/old-turn reads and source transitions; its runtime is not a single export latency.
- Direct execution under `/usr/bin/time -l` of the compiled debug test binary: passed in 40.44 seconds wall, 38.10 user / 1.98 system seconds, maximum RSS 1,661,550,592 bytes and peak process footprint 1,474,496,240 bytes. This is one test process with assertions/fixtures and retained comparison buffers, not the full GUI or a production build benchmark.

### Actual Sidebar export read-back

The rebuilt signed isolated package exported unopened large sessions through the real Sidebar menu and native Save panel. Claude produced 70,792,246 bytes with 4160 user and 4160 assistant turns; Codex produced 69,679,021 bytes with 4097 user and 4097 assistant turns. Each complete Markdown file matched the expected formatting of **every** source user/assistant text, in order, byte for byte. This verifies full bodies rather than only first/last markers. The initial old-package Save-panel attempts did not produce files and are not counted as successful exports; the rebuilt-package native actions succeeded.

The new optional export destination is an IPC addition, not a persistence migration. Frontend/backend must ship together to avoid an older backend ignoring the destination. Rollback remains a paired bundle revert. At that earlier acceptance point canonical decoding still allocated the complete Rust history. The streaming follow-up below replaces that intermediate retention; this remains distinct from a hard byte ceiling.

The requested topology is the normal primary plus Instance 2 on one Mac, with distinct homes, provider roots, accounts and ports. It does not require another physical computer. Same-path fixtures do not by themselves certify vendor-generated new UUID continuation or remote rendering; the streaming follow-up records those boundaries separately.

### Rendered raw-transition matrix and changed-catalog cost

The same rebuilt package stayed open while isolated raw files changed. Codex and Claude each passed native compaction append (latest new user/assistant), larger atomic replacement (new last turn 99, old rows absent), and truncation (only the two replacement turns). No Reload was used. Codex replacement export contained exactly 100 user/assistant pairs and its last full body; Claude compact export contained 66 pairs and no compact-summary user, and truncated export contained exactly two pairs with no rotated text. Same-process in-place larger rewrite is additionally covered at the managed reader/store boundary by the automated test.

These are local faithful native-record fixtures, not real paid provider `/compact` runs or cloud lifecycle certification. Window focus/visibility return was used. CUA intermittently reported `noWindowsAvailable` or stale window observations; the app was reacquired by bundle identifier and actual latest content checked. Observation durations must not be interpreted as refresh latency. Exact hidden/focused timing was not instrumented again.

| Actual new-package phase                        | Observation seconds | Mean CPU, one core = 100% | Sampled peak summed footprint | Final footprint |
| ----------------------------------------------- | ------------------: | ------------------------: | ----------------------------: | --------------: |
| Codex 67.2 MiB open, rebuilt catalog            |               61.29 |                     6.68% |                   1448.04 MiB |      786.76 MiB |
| Same large file, two short raw records appended |              112.45 |                     3.30% |                   1973.65 MiB |     1046.38 MiB |

The complete export observation phases sampled at most 1109.63 MiB across the four app processes. Sampling is once per second and can miss shorter spikes. Three Chat tabs had been opened by the later append phase; this is not a controlled A/B against the earlier single-view run. Rebuilding changed Codex catalogs intentionally reads more file bytes than the former append-only shortcut. The sample demonstrates no return to the previous 10–12 GiB replay amplification in this workload; it does not prove zero overhead for arbitrarily large files.

| Area               | Verdict | Evidence                                                                | Change or reason kept                                                      | Verification                                                                |
| ------------------ | ------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Background work    | keep    | Existing 30/60-second visible scheduler; export only on explicit action | No new timer; decode/write stays on blocking worker                        | Scheduler regressions plus actual focus-return source changes               |
| Memory             | fix     | Full Markdown formerly required another WebView round trip              | Direct buffered file output; canonical Rust decoding remains O(history)    | Exact 70 MB file read-back, explicit 4096-turn test, four-process samples   |
| Scope/isolation    | keep    | Existing account-bound native resolver and isolated data/provider roots | Export does not hydrate or replace Chat; no cloud writes or credential use | Both-provider producing-boundary tests; dedicated Instance 3 only           |
| Rendering/hot path | fix     | Previous changed-file catalog retained stale offsets                    | Rebuild on revision change; unchanged catalog cache retained and bounded   | Failing-then-passing atomic replacement regression and actual Chat rotation |

Additional source ownership review covered the authoritative reader, EventStore boundary, background execution and IPC payload. No UI layout, domain schema, account identity format or cloud transport changes were made. Frontend targeted suite now passes 249 tests; the latest backend session suite passes 851 with 5 explicitly ignored tests, including the resource test run separately. The destination-preservation assertion was added after the first timed large-test sample and passed its targeted rerun; production code was unchanged by that test-only addition.

The final cooldown plus quit-interaction phase lasted 134.58 seconds, averaged 1.59% CPU, and ended at 1077.90 MiB summed footprint (sampled peak 1234.30 MiB) across three opened Chat tabs. Normal UI quit released all four attributed processes. The independent user instance stayed running. Only the isolated 1 MiB raw fixtures were restored from their local backups after exit; real provider history and cloud data were untouched.

## Streaming canonical-history follow-up

The provider JSONL is authoritative. The remaining amplification originated in the full reader: complete raw chunks, normalized events and final output coexisted. Both canonical parsers now expose turn visitors. Managed file export normalizes and writes each emitted batch to the existing atomic temporary destination. Managed full-history RPC collects only the required final event array. Native context materialization and Claude catalog fallback also project batches into their required final item array, preserving accumulated compaction state. The existence-only synchronization precheck no longer parses the entire file before parsing it again for validation.

No timer, subscription, cache, migration or credential format was added. Account-bound path resolution and legacy fallback errors remain unchanged. Sink errors abort immediately; a before/after source revision guard rejects a changing transcript before a partial export can replace the destination. Complete-result APIs necessarily retain their final array/string; legacy chunk-backed readers still use their established fallback. The parser retains the current turn and pending tool calls, so a giant single turn or arbitrarily many unresolved tools has no new hard byte limit.

### Resource evidence

The explicit test writes both providers' raw fixtures incrementally, exports through the production file-export boundary, and reads every exported user/assistant body back in order. Each assistant body is approximately 16 KiB. Measurements are a standalone debug test process, not GUI latency or the complete app footprint.

|     Turns per provider |      Maximum RSS | Wall time | Evidence                                  |
| ---------------------: | ---------------: | --------: | ----------------------------------------- |
|                    128 | 35,618,816 bytes |    0.34 s | Streaming export and exact body read-back |
|                   1024 | 35,848,192 bytes |    1.20 s | Same workload shape                       |
|                   4096 | 35,979,264 bytes |    4.45 s | Same workload shape                       |
| 4096, final code rerun | 36,225,024 bytes |    4.80 s | Both providers; exact full output passed  |

The first scaling series preceded the source-revision guard and native-context peer changes; the final rerun includes them. A separate explicit 4096-turn comparison printed the selected mode for both providers: original full chunks plus normalization used 708,870,144 bytes maximum RSS (4.97 s); streamed full-result collection used 334,757,888 bytes (4.49 s). This comparison still returns the entire event array and is not the file-export ceiling. Two earlier files without mode markers were invalid A/B attempts and are excluded.

Commands actually run:

- `cargo test --manifest-path src-tauri/Cargo.toml --lib agent_sessions::` with the shared Cargo target — final rerun: 851 passed, 6 ignored, 0 failed.
- `cargo test --manifest-path src-tauri/Cargo.toml -p orgtrack_core sources::claude_code::` — 41 passed, 1 ignored, including raw new-UUID ancestry/election coverage.
- `cargo test --manifest-path src-tauri/Cargo.toml -p orgtrack_core sources::codex::` — 83 passed, 1 ignored.
- `cargo clippy --manifest-path src-tauri/Cargo.toml --lib -p org2 -p orgtrack_core -- -D warnings` — passed after replacing the duplicated complex return tuple with its existing type alias.
- `/usr/bin/time -l env ORG2_EXPORT_TEST_TURNS=4096 <compiled-test-binary> managed_native_streaming_export_resource_acceptance --ignored --nocapture` — final code: passed, both providers, 4096 pairs each.
- `pnpm run check:test-placement` and `git diff --check` — passed.

### New UUID and two-instance boundaries

Both actual signed bundles were rebuilt from the production changes above. The primary and Instance 2 use their established independent homes, rather than two processes sharing a test database. Claude credentials were imported through the authorized Auto Detect/account wizard. Opus successfully answered a minimal tool-free request on Instance 2; its native file and UI identify the ORGII repository. The cloud row contains the two actual events, `full_replay`, epoch 1 and no deletion.

Claude Code's actual `--resume <original-jsonl> --fork-session --print --model opus --tools '' --strict-mcp-config` then created a new UUID, copied the original context and returned the previous assistant marker followed by the requested new marker. The original managed native ID and new provider-generated ID differ; the new raw JSONL retains the ORGII cwd and all four user/assistant records. This is a real provider request, not a normalized fixture. It establishes native context continuation, not remote rendered acceptance.

| Provider    | Raw transition                                                           | App/UI state                                   | Topology/boundary                         | Expected invariant                                      | Observed evidence                                                                                           |
| ----------- | ------------------------------------------------------------------------ | ---------------------------------------------- | ----------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Claude Code | Actual Opus request                                                      | Instance 2 Chat                                | Native source → local Chat → cloud        | Full reply, correct repository, full replay upload      | Passed; 2 events, epoch 1                                                                                   |
| Claude Code | Actual fork-session, new UUID                                            | Original B row remains open                    | B raw source → native CLI default profile | New UUID retains old context and cwd                    | Passed; previous marker quoted, 4 raw message records                                                       |
| Claude Code | Changed first-user UUID with preserved compact ancestry                  | Isolated raw-file test; two repeated elections | Raw parser → cache/listability            | New sibling listable, both histories retained           | Passed; ancestry derived from raw records                                                                   |
| Both        | Append during streaming read; sink failure                               | Unit sandbox                                   | Canonical reader → destination            | Abort; never publish partial result                     | Passed; revision failure and first-callback abort                                                           |
| Claude Code | New cloud row                                                            | Primary and B open                             | Cloud → receiver Chat                     | Receiver can open latest exact reply and continue       | Not passed: Team Sessions remains Loading; foreground controls return noWindowsAvailable and Dock times out |
| Both        | Two-boot determinism / receiver reconnect / old pinned sibling lifecycle | Real dual homes                                | Local ingest and cloud receiver           | Stable election and cursor plus latest rendered content | Not completed in this follow-up; do not infer from unit or CLI success                                      |

The same-head earlier receiver defect #1467 remains separate: an already-open imported replay can require reopening before it sees newly uploaded native events. The current Loading condition is not attributed to that issue without further evidence. Valid shared-auth records and the actual successful upload prove that the provider login problem is resolved; they do not prove frontend roster hydration. No cloud or historical cleanup was performed.

| Area               | Verdict | Evidence                                                                 | Change or reason kept                                        | Verification                                                            |
| ------------------ | ------- | ------------------------------------------------------------------------ | ------------------------------------------------------------ | ----------------------------------------------------------------------- |
| Background work    | keep    | No new timers or scans; canonical operations remain blocking-worker work | Existing lifecycle ownership preserved                       | Unit suites; final bundled apps launched                                |
| Memory             | fix     | Full-history intermediates amplified retained memory                     | Stream completed turns through export and context projection | Exact export read-back; final 34.5 MiB RSS export test; full-result A/B |
| Scope/isolation    | keep    | Account-bound resolver and separate B history root                       | No credential copying or identity schema changes             | Actual B Opus request, raw cwd and cloud row read-back                  |
| Rendering/hot path | keep    | This follow-up changes Rust full consumers only                          | Existing lazy Chat contract preserved                        | Local B reply rendered; receiver remains uncovered                      |

Architecture review covered canonical source ownership, types, state/compaction continuity, IPC compatibility, failure propagation and init/account-path parity (layers 1, 2, 5, 6, 8, 9 and 10). UI design and unrelated provider adapters were intentionally outside this Rust change.

Performance verdict: blocked for complete two-instance rendered lifecycle certification. The standalone streaming-memory and canonical-output checks pass; foreground control and receiver-list hydration still prevent a full green verdict. Rollback is a paired bundle revert, with no source-history or schema migration to undo.

## Subsequent real two-instance continuation acceptance

This supersedes the receiver-list blocker in the preceding follow-up. The underlying queue prerequisite was fixed independently in #1485. Acceptance packages combined this PR's Rust head with that frontend fix; a later package also included the independent checkout-selection fix. These additional fixes are not silently included in #1465.

- Secondary Opus resumed the existing native session successfully. Main Fable 5.1 completed initial and continued requests, including another continuation after normal restart.
- Main opened secondary history and rendered its exact full answer. Main then continued through the actual Chat composer, generating a different native UUID with the complete original history and the answer “十一”.
- Secondary continued the same shared conversation. Its Chat and raw native JSONL both acquired the main user/assistant pair, then added its own answer “十二”. Main reopened the shared view and rendered that exact answer. This is real bidirectional reception and continuation, not just cloud row presence.
- Multiple local clones exposed a separate workspace ordering bug: the first main child used the sibling clone. The independent resolver fix prefers the known, existing source checkout while retaining repository-scope checking. With that fix packaged, main skipped the mismatching old child, created another new UUID under the correct source checkout, retained all 13 native user/assistant records, and rendered “十三” with terminal idle state. No existing history was moved or deleted.
- The original blocked B2 prompt reached the provider after #1485, but Opus safeguards rejected that prompt. It is recorded as a failed attempt, not successful continuation; ordinary follow-ups succeeded.
- Both old acceptance instances were normally quit; all four attributed GUI processes per instance exited. The sampling process was stopped. Replacement acceptance apps use the same established isolated homes.

| Provider         | Raw transition                               | App/UI state                            | Topology/boundary                       | Expected invariant                           | Observed evidence                                    |
| ---------------- | -------------------------------------------- | --------------------------------------- | --------------------------------------- | -------------------------------------------- | ---------------------------------------------------- |
| Claude Opus      | Actual cross-instance continuation/new UUID  | Main opens B history and sends          | B → cloud → A → native child            | Previous context retained; completed answer  | Passed; raw records and Chat answer                  |
| Claude Opus      | Incoming remote turn then local continuation | B source remains selected               | A → cloud → B → original native history | Remote pair and new local pair preserved     | Passed; raw JSONL and Chat show eleven then twelve   |
| Claude Opus      | Workspace-correct new UUID                   | Main normal restart, old child retained | Shared history → local source checkout  | Correct cwd, full prior context, terminal UI | Passed with separate checkout fix; 13 native records |
| Claude Fable 5.1 | Initial, append, restart and append          | Main Chat                               | Provider → native source → local UI     | Successful authenticated continuation        | Passed, including restart                            |

The requested real continuation/new-UUID boundary now has evidence. This does not certify every matrix cell: passive idle roster/replay refresh (#1467), controlled visible/hidden timing, and comprehensive two-boot pinned-sibling/revocation scenarios remain outside this completed acceptance. Complete-result APIs still retain their required final output, legacy readers retain their fallback, and a single oversized current turn has no new hard byte cap. The streaming export measurement is not a whole-app memory ceiling.

## Converted native child refresh follow-up

Real Codex/Claude conversion exposed an additional owning-boundary gap: a Claude root stays unchanged when Codex App appends to its execution child. The managed scheduler compared only the root revision. The Chat stream also disabled local execution hydration when cloud comments were enabled, and adding the native suffix after the cloud plane created duplicate copies of an already published turn.

The refresh revision now includes the existing native child revision probe. The same stamp brackets cold load and subsequent refresh. Settled transcript replacement invalidates the existing single-flight child hydration coordinator. Local native ownership is independent of cloud comment availability; imported remote roots and explicit overrides keep their existing authority. Verified child suffixes enter the canonical assembler before plane identity matching, so the shared source/intent boundary owns deduplication. There is no content-string filter and no historical mutation.

- `pnpm test src/engines/SessionCore/sync/__tests__ src/engines/SessionCore/core/store/__tests__ src/engines/ChatPanel/ChatHistory/hooks/__tests__/useReloadSession.test.ts src/api/tauri/rpc/__tests__/sessionCoreSchemas.test.ts src/engines/SessionCore/core/atoms/__tests__/actions.test.ts src/engines/SessionCore/sync/adapters/cli/__tests__/cliHistory.test.ts src/engines/SessionCore/turns/nativeCliTurnLoader.test.ts src/engines/SessionCore/turns/loadedTurnRegistry.test.ts src/engines/ChatPanel/ConversationStreamProvider.test.ts`: 257 passed, 30 files. Regression preserves intentionally repeated text with different identities while merging the same native/plane turn once.
- `pnpm run typecheck`, changed-file ESLint, `pnpm run check:test-placement`, production frontend build: passed.
- Integrated packages included the separate #1485/#1486/#1487/#1488/#1489 fixes. Real Astra cross-instance continuation retained repository/package context through 31 → 33 → 36. Fable 5.1 continued to 37 and Astra returned 38. The earlier Opus conversion succeeded; one later Opus request was refused, and is not counted as success.
- Claude Fable 5.1 → Codex Astra retained the project code and 41 → 42. Codex App listed the new native thread under the existing ORGII project and continued to 43, then 44. ORG2 received 44 while its original Chat stayed mounted, without Reload, reopening or switching Chat. Raw canonical and account-profile files were the same inode. App continuation used its first-class task API: its prompt is persisted as a delegation/function output, not an ordinary composer user row. This verifies App execution and native return, not manual App composer rendering. Native CUA control of Codex was unavailable; no bypass was used.

| Resource                | Owner and bound                                                                         | Verification / limit                                                                                                                                                                                                    |
| ----------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Revision probe          | Existing active, idle native-session scheduler; 30s focused / 60s unfocused, hidden off | Root plus child metadata only; unchanged stamp avoids history reads; no new timer/cache                                                                                                                                 |
| Child hydration         | Existing per-mounted-stream single-flight coordinator                                   | Latest request wins; no child means no duplicate full root; in-flight delivery defers rehydration                                                                                                                       |
| Timeline                | Canonical source and plane identity merge                                               | External child turns retained; published copies reconciled before Chat rendering                                                                                                                                        |
| Whole App footprint/CPU | Four attributed GUI processes, live user data and other apps present                    | Intermediate return package last 60 samples averaged 2.89% of one core; summed footprint 832.1 → 849.7 MiB. Includes actual refresh/UI activity; not a controlled idle regression comparison or a memory-growth verdict |

No new global retained collection, polling cadence, schema or source-history migration was added. A large child suffix still requires its canonical snapshot when changed. Full whole-App idle/hidden CPU certification remains blocked by the observed baseline activity; no claim of zero overhead. Cloud receiver passive freshness (#1467), full physical second-machine topology and manual native App composer behavior remain unverified in this follow-up.

Final canonical-merge package: the duplicate converted user row disappeared (two actual composer turns plus delegated App outputs). A real ORG2 composer follow-up then retained the App result and answered 45. Codex App read-back showed this exact ordinary user message and answer on the same native UUID, completed without error. The cloud inventory grew from 2901 to 2904 only through three test roots; no pre-existing row disappeared, lost events, changed sharing access or became deleted.

### Remaining loaded Codex App execution-context boundary

The final round-trip exposed an unresolved App-side hot-context case. After App had loaded the converted thread, ORG2's ordinary composer appended a real user/assistant turn ending in 45. App `read_thread` saw that durable turn, but `send_message_to_thread` asking for the next value answered 45 again rather than 46. Two no-tool context probes (including navigation away and back) quoted the old conversion user prompt rather than the new ORG2 prompt. This distinguishes correct disk/catalog/history read-back from the loaded App execution context. The final ORG2 bundle automatically displayed the App diagnostic output without Reload/reopening, and no duplicate converted user row remained.

The App task API is a delegation-input path. This evidence does not prove that its manual composer behaves identically; that path was unavailable through native CUA. No supported mechanism was exercised to invalidate another running App server's loaded thread. This PR fixes ORG2's read/refresh ownership, not the external App's loaded execution context. Therefore unrestricted hot alternation between both running writers is **not certified**. Conversion and isolated two-instance continuation passed; do not describe the complete App loop as fully solved. No native history was deleted or rewritten to disguise the stale context.

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

- Full canonical continuation, export and execution-child prefix validation still read complete history; this acceptance does not certify their resource ceiling.
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

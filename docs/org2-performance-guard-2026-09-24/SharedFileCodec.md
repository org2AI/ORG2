# Shared-file WebKit allocation profile

## Scope and method

This change targets the desktop shared-file Base64 boundary. Upload previously built a full binary string before Base64 encoding. Download used `Uint8Array.from(atob(content), mapper)`, which materializes the string iterator before mapping. The new upload path uses the browser's native encoder when available, with a three-byte-aligned bounded-chunk fallback. Download allocates one exact-size byte array and copies by index. File identity, size and SHA-256 checks, the 32 MiB limit, authentication and the JSON wire contract remain unchanged.

Before and after used separate isolated data homes and WebKit data stores, the same macOS Tauri debug executable, and an integrated Share Sessions frontend. The only frontend difference between the valid comparison runs was this codec patch. Actual database and WebKit store ownership were verified through open-file inspection. An earlier run with an incorrectly inherited data home was excluded. Measurements are development-build evidence, not packaged-release performance certification.

A process sampler read `proc_pid_rusage` approximately every 200 ms. Physical footprint and RSS are separate metrics. CPU counters were converted from Mach ticks using the host timebase (125/3 ns per tick). No forced garbage collection ran. Each transfer was followed by 15–20 seconds of natural settling; compilation was excluded from measured phases. Sub-200-ms peaks may be undersampled.

The production shared-file client transferred patterned binary payloads against a loopback HTTP fixture. Downloads checked every byte and the production digest; uploads were decoded and checked on the fixture server and the returned digest was checked by the client. These timings isolate local serialization/decoding and are not Internet transfer latency.

## Before/after results

| Operation                                          | Before                    | After                     | Interpretation                                                                |
| -------------------------------------------------- | ------------------------- | ------------------------- | ----------------------------------------------------------------------------- |
| 32 MiB encode + JSON, three iterations             | 1046 / 937 / 948 ms       | 13 / 12 / 24 ms           | Native WebKit encoder removes the JavaScript whole-file conversion loop       |
| Encode phase maximum physical footprint            | 760.3 MiB                 | 717.3 MiB                 | Deferred collection remains; this is not a 75% reduction in total peak memory |
| First encode footprint: start / peak / settled     | 284.0 / 760.3 / 356.5 MiB | 388.7 / 506.0 / 481.1 MiB | Initial allocation increment decreases; baselines differ                      |
| 32 MiB download, three iterations                  | 2231 / 2239 / 2016 ms     | 289 / 271 / 512 ms        | Same production client, payload and integrity checks                          |
| Download maximum delay of a 20 ms event-loop timer | 1870 / 1909 / 1721 ms     | 83 / 70 / 213 ms          | Large stalls decrease; the remaining 213 ms stall is still material           |
| Download phase maximum physical footprint          | 1002.7 MiB                | 614.2 MiB                 | Approximately 39% lower across all three iterations                           |
| Download phase maximum RSS                         | 1560.9 MiB                | 695.5 MiB                 | Reported separately; RSS alone is not a leak verdict                          |
| 8 MiB download / maximum timer delay               | 415 / 351 ms              | 73 / 20 ms                | Improvement also observed below the transfer ceiling                          |
| 32 MiB loopback upload, two iterations             | 552 / 532 ms              | 212 / 344 ms              | Faster serialization; total upload memory is not certified lower              |

WebKit in the measured runtime exposes native `toBase64`. Unit tests exercise dispatch/binding using a stub and independently test the portable fallback with zero length, padding boundaries, chunk boundaries, all byte values, and subarray bounds. Native browser transfers additionally exercise the real builtin.

## Rendered lifecycle follow-up

A synthetic persisted 128-round conversation was reopened through the sidebar 24 times. Every latest assistant marker rendered; each open took 471–521 ms. DOM count stayed at 1,253 during the open view and dropped to 768 after leaving it. This fixture verifies rendering, not provider ingestion.

The initial fixture attempt failed: it saved projection-cache events but no durable agent-session directory row, so a subsequent directory refresh removed its atom-only sidebar entry. The corrected setup persists both the directory row and events and explicitly asserts document visibility. The initial cold body timeout also ran without an asserted visible document; it is retained as inconclusive, not converted into a passing cold-load measurement. An extra imported row was traced to the WDIO harness's isolated Claude JSONL fixture, not a user's history.

The successful rendering assertion exposed a separate resource defect: rapid reopening reached approximately 1.5 GiB physical footprint. A stable DOM count does not clear this allocation concern. After leaving the view, a 90-second observation (visible first, then hidden; not a purely visible-idle cell) fell from 1,513 MiB to 851 MiB, with a late peak of 1,560 MiB. A separate 60-second hidden interval used 0.14% of one core on average and ended at 831 MiB. A 60-second visible-return interval used 0.87% and ended at 838 MiB.

A second 24-cycle batch passed and peaked at 1,297 MiB, settling to 647 MiB after 30 seconds. This does not demonstrate monotonic per-cycle retention, but neither does it certify acceptable peaks. Registered application caches reported only about 5 MiB (383 projected events); other registered caches were empty. An OS VM summary found roughly 570 MiB allocated in the WebKit malloc zone. Native stack sampling showed WebKit rendering and JavaScriptCore allocation/collection activity but did not attribute the large allocation to a specific JavaScript owner. The remaining render peak is an **open performance defect/investigation**, not an explained harmless cache. A production-bundle comparison and heap-retainer attribution remain required.

## Resource ownership review

| Area               | Verdict | Evidence                                                                                  | Change or reason kept                                                          | Verification                                                    |
| ------------------ | ------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| Background work    | fix     | Reuse the shared deadline owner, which disposes its timer and abort listener in `finally` | Replace abort-only timeout with a settling deadline; no new background service | Hung-fetch, hung-body and ignored-cancellation regression tests |
| Memory             | fix     | Whole binary upload string and download iterator materialization                          | Native/chunked encoding and exact-size decoding                                | Actual WebKit before/after above; byte-exact boundary tests     |
| Scope/isolation    | keep    | Requests receive explicit endpoint and token; codec adds no shared cache                  | Existing authorization and identity checks preserved                           | Separate homes/stores and member reads described below          |
| Rendering/hot path | fix     | Multi-second download stalls at 32 MiB                                                    | Remove file-sized temporary iterator list                                      | 20 ms timer probe; residual stalls explicitly retained          |

## Verification commands

- `pnpm exec vitest run src/features/Org2Cloud/sharedSessionFilesClient.test.ts src/features/Org2Cloud/conversationFileSnapshot.test.ts`: 46 tests passed across two files.
- `pnpm typecheck:fast`: passed.
- `pnpm exec eslint src/features/Org2Cloud/sharedSessionFilesClient.ts src/features/Org2Cloud/sharedSessionFilesClient.test.ts`: passed.
- `git diff --check`: passed.

No Rust, schema, dependency, IPC or persisted-format change is introduced. Reverting this commit restores the prior codec without data migration. No UI controls or visual layout change, so screenshot comparisons would not substantiate the allocation claim.

## Request deadline follow-up

The existing attachment RPC used only `AbortController.abort()` at 30 seconds. That does not independently settle a fetch/body promise on WebKit versions that fail to reject after abort. The RPC now reuses `runCloudRequestWithTimeout`, including JSON body parsing within the deadline and honoring caller cancellation. Error status/domain-code parsing remains unchanged. Regression tests inject an indefinitely pending fetch and JSON body that ignore abort, and assert a single request, a rejected `TimeoutError`, and disposed timers. An ignored caller cancellation must still reject `AbortError`.

A first attempted 32 MiB cloud upload did not return through the automation bridge. The later callback hit `tauri-plugin-webdriver-automation` 0.1.3's `expect("no pending script with that id")`, followed by a poisoned mutex. This is a debug automation plugin defect; the package source and native panic log establish the mechanism. It is not evidence of the original provider transcript mismatch. The isolated primary was restarted over the same data home. Subsequent long operations use short start/poll commands so a late bridge callback cannot invalidate the measurement. An authorized member lookup of the attempted file identity returned null before any retry. Direct table diagnostics were denied (403); transient 521 responses were also retained. No quota or server configuration was changed.

## Same-host isolated-instance acceptance

Two real Tauri processes used separate native identities, data homes, external-history roots, WebKit store UUIDs, ports and synthetic organization members. Open database/storage paths were checked, rather than relying on configured values alone. This is the project's same-host dual-instance topology; a second physical computer is not a prerequisite for this acceptance target.

| Boundary                                 | Observed result                                                                                                               | Limit                                                                                                                                   |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Existing real Claude shared conversation | Both instances rendered the latest post-compaction response containing both expected markers                                  | The provider run was from the previous acceptance; no new provider call was made in this codec run                                      |
| Original immutable attachment            | Both instances rendered the original 27-byte text after the source had been overwritten                                       | The secondary's first click timed out; a later click succeeded. Cold first-click behavior is not certified by this run                  |
| 1 MiB patterned file                     | A production WebView upload completed in 4,311 ms; B production download completed in 437 ms, matching every byte and SHA-256 | One owned test artifact remains in the disposable organization                                                                          |
| 32 MiB real cloud upload                 | Final client returned `TimeoutError` in 30,013 ms and remained controllable                                                   | Transfer did not pass; authorized lookup returned no file after the deadline. Loopback 32 MiB success does not substitute for this cell |
| Fleet ledger                             | 3,518 session rows unchanged: no additions, deletions, access changes, count drops or epoch changes                           | This is a read/attachment scenario, not proof of every sync producer running. The 768 pre-existing high-epoch rows remain unchanged     |
| Destructive effects                      | Both logs contained only watchdog service-start messages and a housekeeping pass with zero deletions/evictions                | No watchdog recovery/fallback firing or destructive cloud mutation was observed                                                         |

The initial secondary cold click may have met the inherited-event origin gate, which intentionally shows a retry notice rather than reading a receiver-local path. That mechanism exists in the source, but this run did not capture the initial transient notice, so it is not asserted as the proven disposition. A subsequent cold-click diagnostic also raced a page reload and found a missing anchor; that failed diagnostic is retained, not counted as a pass.

Other log findings were classified: temporary executable paths caused updater checks to reject symlinks; the synthetic fixture remote has no real GitHub repository and produced fetch/default-branch errors; the debug build reported atom-family deprecation and an unverified external Codex version. Rapid reopening also triggered high-frequency warnings for session edit-artifact/final-diff queries (about three reads per open); multiple `useCompactFileData` consumers and remount effects require a separate deduplication investigation. The test-injected JavaScript syntax error and automation-plugin panic are described above; neither is omitted from the verification record.

## Remaining gates

- Packaged/release-bundle profiling and attribution of the 1.3–1.5 GiB reopen peaks are not complete.
- The 32 MiB cloud upload remains unsuccessful under the existing 30-second deadline; throughput, server/request limits and a size-aware transfer strategy need investigation. Increasing the deadline alone is not demonstrated to solve it.
- Offline/reconnect, revocation, endpoint/account switching, crash-mid-transfer and version-upgrade cells were not rerun for the broader Share Sessions stack.
- The original 164-item provider transcript discrepancy remains unreproduced; the debug WebDriver panic is a different failure.
- Luna reserve acceptance remains constrained by the previously observed provider quota; this run made no further Luna calls.

**Performance verdict: blocked for full Share Sessions acceptance.** The isolated shared-file codec improvement and explicit request deadline have direct evidence, but the open render allocation concern and failed large cloud transfer prevent an overall pass. No cloud resources, quotas or runner configuration were changed.

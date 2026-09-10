# Cloud retention parking recovery

Scope: PR #1419, client-side suppression of repeated immutable-object uploads and retention-expired pushes. This review covers the shared cloud push boundary, not native provider ingestion or native App context refresh.

The authoritative park is `org2CloudRetentionParkedAtom`, written only after a retention rejection in `Org2CloudSyncEngine`. The redundant in-memory Set ignored the rejected version, preventing new activity from retrying; lifecycle reset cleared only that Set, leaving the durable rejection effective after login. The fix removes the Set and keys the durable record by org, normalized endpoint/account identity, session, and the rejected `updated_at` value. Identity and generation checks reject obsolete completions.

| Area               | Verdict | Evidence                                                                                                                  | Change or reason kept                                                                                                          | Verification                                                                                         |
| ------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Background work    | keep    | Existing main-window engine owns startup/activity/focus triggers and serializes passes                                    | No timer, listener or polling added; unchanged versions skip upload                                                            | Retention suite asserts one call across repeated passes; lifecycle suites included in full cloud run |
| Memory             | fix     | One durable record capped at 512 entries replaces an unbounded Set plus durable record                                    | Renewed entries move to the newest insertion position; identity reset and authoritative org removal evict parks                | Capacity, restart and roster tests                                                                   |
| Scope/isolation    | fix     | Key contains endpoint/account, org and session; error completion checks current identity/endpoint and existing generation | A stop after an actual identity transition clears parks; token refresh preserves them; fresh process preserves cold-boot parks | Account/endpoint isolation, late rejection, restart and token-refresh tests                          |
| Rendering/hot path | keep    | No React component or subscription added; cache writes occur on rejection/reset/roster pruning                            | No transcript allocation or UI projection change                                                                               | Typecheck, changed-file lint, cloud suite                                                            |

| Provider            | Raw transition                                                            | App/UI state         | Topology/boundary                      | Expected invariant                                                          | Observed evidence                       |
| ------------------- | ------------------------------------------------------------------------- | -------------------- | -------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------- |
| Shared cloud client | Mock RPC retention rejection followed by unchanged/new local `updated_at` | Live engine          | Client-to-cloud push                   | Unchanged version skips; newer version retries once                         | 14 retention tests pass                 |
| Shared cloud client | Persisted cache restored into a fresh engine                              | Cold boot simulation | Local persisted state                  | Same identity/version stays parked                                          | Retention test passes                   |
| Shared cloud client | Auth reset, token refresh, account/endpoint change                        | Live engine          | Auth lifecycle/cache writer            | Reset revalidates; refresh keeps park; old identity cannot write a new park | Retention and endpoint tests pass       |
| Codex / Claude Code | Append raw user/assistant records, then explicitly rescan both sources    | Packaged Tauri       | Local Rust ingestion to controlled RPC | Each changed version retries once                                           | Both passed; physical A-to-B not tested |

Lifecycle limits: a deleted session's unused cache entry remains bounded until org/auth reset or capacity eviction; it cannot schedule work or resurrect a session. A server entitlement change without local activity needs an explicit sign-out/sign-in to revalidate. More than 512 expired sessions can churn the bounded cache on later passes. The storage HEAD adds a network round trip for a missing segment; failed probes retain the existing POST/409 fallback. No production error-rate reduction is claimed.

Verification: `pnpm test src/features/Org2Cloud`, `pnpm exec tsgo --noEmit`, ESLint on the seven modified TypeScript files, and `git diff --check`. See the PR for final suite counts. No history/database format or server schema is changed. Legacy unscoped park keys cannot match the new key and are eventually pruned; this may cause a one-time retry. Rolling back loses this cache isolation/recovery improvement but does not remove user history.

Performance verdict: pass for the bounded cache and request lifecycle covered above. Packaged Tauri measurements below cover short local runs; production error volumes, physical two-machine behavior, and long-duration memory stability remain unverified.

## Live acceptance follow-up

A packaged Tauri run exposed a startup case missing from the first tests: the
same-identity React service startup invokes stop/start again. An early WebDriver
trace recorded the persisted parks being read intact, then `resetSyncState`
writing `{}` before both unchanged native-history sessions were rejected again.
The reset now compares the current identity with the identity captured at engine
start. Same-identity service restarts preserve parks; sign-out and account changes
still clear them. The regression fails against the prior implementation and passes
with this fix.

The fixed macOS package was built using `WEBDRIVER=1 pnpm run tauri:build:fast -- --instance 4` from the source tree committed as `de4c88d31`, with separate application/history directories and background LLM calls disabled. A localhost RPC fault server returned `ORG2_RETENTION_EXPIRED`; existing E2E seams supplied fixture auth. No production account, user history, or server data was changed. No historical cleanup was needed.

Functional acceptance:

- Two full process starts preserved the pre-quit parks and upload counts (6 to 6, then 12 to 12 per provider), including ten explicit passes after each start.
- Sign-out cleared parks; sign-in allowed one attempt per provider. Replacing auth with the same identity preserved parks. Switching accounts used only the new identity's parks.
- Switching the controlled server to success and signing in recovered uploads, with no further calls in five repeated passes.
- Appending raw Codex and Claude Code history, invoking `external_history_rescan_sources`, then reloading and syncing produced exactly one attempt per updated version; five further passes produced none. Reload alone did not reliably rescan Claude, so this does not establish automatic background ingestion.
- Hidden idle produced no further metadata attempts. Normal quit removed the backend and all three attributed WebKit processes on both tested exits.

Resource collection uses one-second `proc_pid_rusage` deltas with the host Mach timebase conversion, including backend, renderer, GPU and networking. CPU is percent of one logical core. Actual document visibility classifies samples; the first ten seconds of each phase and visibility transitions are excluded. Summed RSS may double-count shared pages and is not private memory. These short, sequential observations are not a statistically controlled overhead benchmark or a long-running leak test.

| Phase / actual visibility | Samples | Mean / p95 CPU (% core) | RSS median / range (MiB) | Footprint median (MiB) |
| ------------------------- | ------: | ----------------------: | -----------------------: | ---------------------: |
| parked_idle/visible       |      56 |            5.595 / 8.86 |   434.04 / 196.55–440.19 |                 470.26 |
| post_auth_idle/visible    |      35 |            5.292 / 6.21 |    382.66 / 378.8–386.33 |                 547.93 |
| signedout_control/visible |     123 |           5.207 / 6.438 |   250.91 / 143.91–354.41 |                 590.93 |
| hidden_idle/hidden        |     208 |           0.398 / 0.411 |     107.67 / 85.86–294.5 |                 518.35 |
| restart_idle/visible      |      74 |           4.944 / 7.866 |     439.89 / 136.3–449.7 |                 474.14 |

The cache/request lifecycle passes this local acceptance: no idle retry loop, bounded cache ownership, four attributed processes, and no surviving owned processes after quit. Visible whole-app CPU remains around five percent of a core, including the signed-out reference; this patch does not establish zero idle CPU or prove a whole-app performance improvement. RSS and footprint fluctuate substantially with WebKit memory management; short runs cannot rule out long-term retention.

Storage HEAD/POST behavior was covered by the cloud tests, not this metadata-only live run. Production Supabase, real GoTrue token refresh, physical two-machine transport, and real LLM continuation were not exercised. Local evidence includes `actions.jsonl`, `requests.jsonl`, `boot-trace.json`, `samples.jsonl`, visibility/process snapshots, and `metrics.json`; fixture payloads and machine-specific paths are intentionally excluded from the repository.

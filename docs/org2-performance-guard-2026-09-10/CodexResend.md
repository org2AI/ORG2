# Codex resend rollout identity

## Finding and owning boundary

Read-only inspection of native Codex data found 12 rollout files for one thread. Their filenames include both `rollout-<timestamp>-<thread UUID>` and `rollout-<timestamp>-<thread UUID>_<rollout UUID>`. Every inspected `session_meta.payload.id` retained the original thread UUID; the native threads table points to the latest rotated file. These are physical generations of one thread, not independent forks. No personal transcript content, identifiers, or absolute user paths are included here.

ORGII discovery used each file stem as a separate imported cache key. The metadata parser did not persist top-level continuation identity, the Codex sync omitted continuation election, and filename extraction confused the final rollout UUID with the thread UUID. The producing path is `discover_codex_app_records` → metadata parsing → `sync_source_cache_from_conn` → imported session listing/exact lookup.

The source invariant is now one listable representative per native Codex thread. Fresh parses derive identity from `session_meta.id`; existing cached rows and older resumed watermarks recover it from the native filename contract. The existing continuation election and exact-ID lookup enforce the same verdict. True forks retain their own `session_meta.id`, regardless of shared prompt content or `forked_from_id`.

The same thread decoder now serves title-index lookup and CLI resume planning. Managed ledger UUIDs recognize rotated file keys, and native cache-path lookup recognizes the persisted thread identity.

## Historical remediation and compatibility

Repair updates only derived cache metadata/listability during ordinary sync. It preserves all native files, historical cache rows, session IDs, and incremental watermarks. The parser version is unchanged: large rollouts are not forced through a cold parse just to add identity. A local inspected rollout was about 3.5 GiB, making that constraint material. Warm rescans are tested to perform zero additional SQLite row changes.

No schema, dependency, network protocol, or user configuration changes. Reverting the code and rebuilding the derived cache restores the previous projection; raw history needs no recovery. Existing active/revealed-row handling consumes the established continuation lineage field.

Rebuilt-desktop verification exposed a second consequence of the same physical identity: a pinned rollout lost its visible pin when the elected representative changed. Pin membership now uses the native thread UUID at the authoritative sidebar projection. Existing physical pin keys remain unchanged on disk and normalize on read; pin/unpin writes collapse same-thread generations transactionally. No historical transcript or unrelated provider pin is removed. The read costs one existing pin-table query plus bounded per-page identity decoding, with no scan of the session cache or provider files. The regression exercises raw rotation, pin projection, unpin through the new generation, restart, and cache pruning.

## Claude Code check

Inspected 189 local top-level Claude JSONL files. Some copied/continued files preserve earlier session metadata and first-message UUIDs. The existing Claude parser already records first-user and compact-boundary UUIDs and invokes continuation election. A regression fixture replaces the first user message UUID in the same source file and verifies repeated authoritative cache upserts retain one visible session with the replacement content. No Claude production change was needed. This does not claim every Claude rewrite or explicit fork mode was exercised live.

## Verification

Rebased only this fix onto the latest `develop`; resolved the appended Claude-test conflict by retaining both tests. Reran the Rust suite, scoped Clippy and all three sidebar/cloud test files after integration.

- `cargo test --manifest-path src-tauri/Cargo.toml -p orgtrack_core --lib --quiet`: 645 passed, 8 ignored, 0 failed after rebasing onto the latest develop.
- `cargo test --manifest-path src-tauri/Cargo.toml -p orgtrack_core resend --lib --quiet`: 3 passed after adding the zero-write warm-scan assertion.
- `cargo clippy --manifest-path src-tauri/Cargo.toml -p orgtrack_core --lib --tests -- -D warnings`: passed.
- `./node_modules/.bin/vitest run --config config/vitest.config.ts src/store/session/sessionAtom/__tests__/sidebarLoaders.test.ts src/scaffold/NavigationSidebar/connectors/useSessionMenuItems/__tests__/continuationVisibility.test.ts src/features/Org2Cloud/org2CloudSyncEngine.vanishedSweep.test.ts`: 32 passed. Existing Vite/Jotai deprecation warnings remain.
- `git diff --check`: passed.
- Changed Rust files formatted directly with `rustfmt --edition 2021 --config skip_children=true`; crate-wide format check reports pre-existing formatting in untouched modules, which was not swept into this fix.
- Initial test attempts caught a test-fixture NOT NULL violation and a Clippy test assertion warning; corrected and rerun. An initial Vitest invocation omitted the repository config and failed alias resolution; the command above uses the required config and passes.
- No frontend source changed; no TypeScript typecheck was required. Newly built Tauri verification and CPU/RSS results are recorded below. Actual provider resend clicks, live cloud topology, other platforms, and multi-GiB runtime loads are not covered by the raw fixture run.

## Rebuilt macOS desktop verification

Built and launched instance 7 from source commit `077195543` using:

```sh
node scripts/tauri/build-fast-parallel.cjs --instance 7 /tmp/orgii-resend-desktop-1576/ORG2-Resend.app
node scripts/tauri/open-instance.cjs --instance 7 --app /tmp/orgii-resend-desktop-1576/ORG2-Resend.app --data-home /tmp/orgii-resend-desktop-1576/data
```

Final build passed in 622.3 s. Executable SHA-256: `2f29ce3506915b308471a96b7d6d874e2a0c22fe42e1b8d011f9ed7c389ee11d`. The webpack build retained an unrelated `jsqr` resolution warning. Commit hooks also passed scoped desktop/core Clippy (`org2`, `orgtrack_core`); no TypeScript source changed.

This is a real rendered Tauri test with faithful **raw JSONL transitions**, not a click on the native Codex/Claude resend controls. The launcher isolated data, external history, native transcript home, bundle identity (`org2ai.org2.instance7`), IDE/proxy ports (13853/17894), and signed-out auth. The primary user's raw histories were not modified. Normal Runtime → Scanning → Codex/Claude Rescan actions drove ingestion; no normalized cache seeding or debug RPC replaced those UI actions.

The first built binary reproduced loss of pin membership across a second physical rotation. That finding caused the pin fix above. The final binary recovered those existing physical pin records without data cleanup. With the previous conversation open and pinned, another raw rotation and normal UI rescan left exactly one pinned root row; opening it rendered `CODEX_FINAL_ROTATION_3_VISIBLE`. The independent fork retained its own row and `CODEX_FORK_VISIBLE` content. The initial Codex append added 600 user/assistant pairs (about 1.79 MB raw), and the rendered navigator showed 601 turns with `ACTIVITY_599_VISIBLE` at the tail. Claude's same-file first-UUID replacement rendered `CLAUDE_RESENT_VISIBLE` with one row.

The final local cache contained six physical rows: one Claude, four generations of the root Codex thread, and one independent fork. Exactly three were listable (one Claude, one root Codex, one fork). Screenshots and accessibility observations were captured in the task, including the pin failure before the follow-up and pin retention after it. They are not attached to GitHub; no layout/theme changes are claimed. Computer Use had intermittent hidden-window `noWindowsAvailable` failures; restoring with the native Window → Show All menu recovered coordinate interaction. Failed clicks were not counted as successful assertions.

Unpinning through the latest row cleared both legacy generation pin records. A subsequent normal UI rescan did not restore the pin. After quit/relaunch, the same three visible rows remained, the latest marker still rendered, and the complete cache-row and watermark snapshots compared equal. The durable pin table remained empty. No primary data was cleaned up.

## CPU and RSS measurement

Sampled the backend plus the three WebKit XPC processes created at isolated-app launch. PID attribution used the launch process delta; quitting the app removed all four PIDs, confirming their ownership. Final-build PIDs were backend 67463, GPU 67966, networking 67968, and WebContent 67969. CPU is cumulative `ps time` delta divided by monotonic wall time, with 100% representing one core. RSS is `ps rss` in KiB converted to MiB; aggregate peak is the maximum simultaneous sum, not the sum of independent peaks. Each 30-second stage contains 31 samples at approximately one-second intervals.

```sh
python3 /tmp/orgii-resend-desktop-1576/measure.py final_active_rotation 30 67463 67966 67968 67969
python3 /tmp/orgii-resend-desktop-1576/measure.py final_visible_idle 30 67463 67966 67968 67969
python3 /tmp/orgii-resend-desktop-1576/measure.py final_minimized_repeat 30 67463 67966 67968 67969
python3 /tmp/orgii-resend-desktop-1576/measure.py final_post_quit 5 67463 67966 67968 67969
```

| Final-build stage               | Wall seconds | Backend CPU | All four CPU | Aggregate RSS start → end / peak (MiB) |
| ------------------------------- | -----------: | ----------: | -----------: | -------------------------------------: |
| Raw rotation + actual UI rescan |        30.72 |      0.684% |       7.260% |               139.88 → 324.00 / 324.38 |
| Visible idle, transcript open   |        30.64 |      0.228% |       1.338% |                119.30 → 43.28 / 119.30 |
| Minimized idle repeat           |        30.95 |      0.517% |       3.587% |                36.86 → 416.67 / 430.77 |
| After Quit                      |         5.10 |  No process | No processes |        All four PIDs absent throughout |

A further visible-idle sample after the final restart used PIDs 84441/84838/84839/84840 (`python3 /tmp/orgii-resend-desktop-1576/measure.py final_restart_idle 30 84441 84838 84839 84840`). Over 30.60 s, backend CPU was 0.196%, aggregate CPU 2.026%, and aggregate RSS 181.17 → 191.72 MiB (peak 191.72). WebContent RSS was 119.69 → 123.08 MiB in that sample. This more stable short sample still does not prove long-term bounds.

An earlier minimized sample measured 1.753% aggregate CPU and 154.19 → 49.53 MiB RSS, but a `vmmap` diagnostic overlapped it; the undisturbed repeat above is the primary minimized result. The diagnostic reported backend physical footprint 91.2 MiB, peak 268.6 MiB, illustrating why low resident RSS cannot be read as low total memory use. The initial build's 600-turn append sample measured 9.082% aggregate CPU with RSS 303.13 → 748.70 MiB; that sample predates the pin follow-up and is not substituted for final-build data.

RSS varied strongly with OS page residency/compression, including large drops while idle and a subsequent increase while minimized. This is a shared macOS host, not a controlled benchmark. These short observations establish measured resource use and process cleanup; they do **not** establish a steady memory plateau, absence of a long-term leak, or improvement versus the base branch. Minimize was exercised through the native window control; `document.visibilityState` was not separately instrumented. Local evidence scripts, raw samples, build logs, and read-only cache snapshots are retained in the isolated temporary evidence directory. No raw user history or process dumps are committed.

## Lifecycle review

| Area               | Verdict | Evidence                                                                 | Change or reason kept                                                                                        | Verification                                                               |
| ------------------ | ------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| Background work    | keep    | Existing source sync owns discovery, metadata parsing, and cache updates | No timer, worker, retry loop, subscription, or extra filesystem scan; add source-local cache repair/election | Repeated sync and reopen tests; zero-write warm scan                       |
| Memory             | keep    | Repair streams cached rows; managed IDs remain scoped to one sync        | Adds only discovered rotated aliases to the transient ID set; uses existing election structures              | Code trace and measured RSS, with OS paging caveat                         |
| Scope/isolation    | keep    | Every query is scoped to `codex_app` in the supplied connection          | No global cache or change to provider roots                                                                  | Isolated on-disk cache fixture; independent fork and managed-binding tests |
| Rendering/hot path | keep    | No rendering or streaming-delta code changed                             | Reuse established lineage projection and revealed-row handling                                               | 32 sidebar/cloud unit tests                                                |

| Provider    | Raw transition                                               | App/UI state                                                | Topology/boundary                                      | Expected invariant                                                          | Observed evidence                                              |
| ----------- | ------------------------------------------------------------ | ----------------------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Codex       | Create → rotated same-thread rollout                         | Old ID queried before and after live sync                   | Isolated raw files → production discovery/parser/cache | One visible thread; old exact lookup suppressed; historical lookup retained | Passed regression fixture                                      |
| Codex       | Independent fork with same prompt                            | Both source files present                                   | Same local ingest boundary                             | Fork remains independent                                                    | Passed regression fixture                                      |
| Codex       | Legacy metadata repair → repeated scan → connection reopen   | Existing cached identity retained                           | On-disk cache                                          | Stable lineage, row count and watermark; zero warm-scan writes              | Passed regression fixture                                      |
| Codex       | Managed binding added after discovery                        | Cached rotated file                                         | Native ownership and resume/path/title resolution      | Managed mirror hidden; real thread UUID used                                | Passed regression fixture                                      |
| Claude Code | First user UUID replaced in same file → repeated upsert      | Same canonical cache ID                                     | Raw parser → authoritative cache writer                | One session with replacement content                                        | Passed new fixture                                             |
| Codex       | Rotation with the prior generation open and pinned           | Final rebuilt desktop, normal UI rescan                     | Isolated local native JSONL → sidebar                  | One pinned representative; latest content opens                             | Passed: `CODEX_FINAL_ROTATION_3_VISIBLE`                       |
| Codex       | Unpin latest generation → repeat rescan → restart            | Final rebuilt desktop                                       | Pin writer + SQLite + rendered sidebar                 | Old pin records do not resurrect                                            | Passed: zero durable pins; unchanged cache/watermark snapshots |
| Codex       | 600-turn append and independent fork                         | Initial rebuilt desktop; final binary reopens same raw data | Local parser + rendered transcript                     | Tail accessible; fork stays separate                                        | Passed: 601 turns, final activity marker, separate fork marker |
| Claude Code | Same-file first-message UUID replacement                     | Running rebuilt desktop                                     | Raw JSONL → parser/cache → rendered transcript         | One row, replacement text                                                   | Passed: `CLAUDE_RESENT_VISIBLE`                                |
| Both        | Provider-native resend clicks and live cloud upload/download | Live provider/cloud                                         | Provider UI and cloud topology                         | Native action and transport lifecycle                                       | Not run; local raw fixtures are distinct evidence              |

## Architecture review

Covered compilation, duplicate decoders, naming/semantic separation of thread and rollout, malformed-input defaults, provider scope, local serialization, production/test sync initialization parity, and lookup/resume symmetry (layers 1–10). Network wire inspection was inapplicable because no network payload changed. This is a scoped bug-fix review, not a repository-wide architecture audit.

Performance verdict: blocked for a full performance sign-off — real desktop CPU/RSS measurements and shutdown verification ran, but the short, variable RSS samples did not establish a steady-state memory bound. The local raw-ingestion, sidebar, pin/unpin, fork, rescan and restart correctness checks pass. Live provider clicks, cloud topology and multi-GiB runtime histories remain explicitly untested; no comparative performance improvement is claimed.

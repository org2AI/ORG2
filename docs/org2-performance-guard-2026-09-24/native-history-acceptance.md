# Native history acceptance follow-up

Candidate implementation: `2b2c7259bb5cd56c4c98c5586b669f3a43461b88`, macOS ARM64, isolated instance 93. The candidate executable matches the previously recorded build receipt. The initial follow-up recorded verification of that candidate. Later sections record writer-boundary corrections, Combined93's stale-generation failure, and Combined2's rebuilt recovery/continuation evidence. Performance verdict remains **blocked**.

## Product evidence

- Configure/Open succeeded with Codex Luna; real core plugin boolean overrides were accepted. A normal catalog Refresh recovered the earlier timeout; this does not fix the separate intermittent catalog problem.
- A user-entered continuation completed native historical pre-compaction and a reply. Both Market receipts report `gpt-reserve`, HTTP 200 and complete usage. Ledger postings balance to buyer charge 5,481, seller payable 4,020 and platform revenue 1,461 micro-USD. The submitted canary contained literal backslashes before underscores; the response preserved them.
- A user-authorized SIGTERM to the verified isolated GUI ended it and its core. Automatic writeback was observed before any UI action: all 50 original records retained in order, plus one destination settings event. Both indexes contained one test conversation. Earlier ORG2 restarts are recorded; this is not uninterrupted normal-menu-exit acceptance.
- Product reopen cleared its reservation without manual edits. The user confirmed one visible conversation, retained reply and correct order. Repeating Open while the GUI was alive reused its PID.

## Resource measurement method

Private `sample.py` used macOS `proc_pid_rusage(RUSAGE_INFO_V2)` at both ends of each 30-second window. CPU is cumulative user+system time as a percentage of one core. The original sampler incorrectly treated Mach ticks as nanoseconds; the table below was recomputed from preserved raw samples using this machine's `mach_timebase_info` ratio of 125/3. This corrects CPU by a factor of 41.667; RSS and I/O are unchanged. RSS is summed over sampled processes; physical I/O is not a filesystem-read or scan count. The ORG2 measurement covers its backend and discoverable descendants, **not independently parented WebKit XPC renderers**. Native Codex figures cover its observed GUI descendant tree; CPU/I/O deltas omit processes absent at either endpoint. Machine load average varied around 4–6; no uncontended benchmark claim is made.

The minimized condition used the native minimize control; document visibility and background throttling were not instrumented. No new model message was sent during these samples. A read-only Market query afterward still found exactly the original two completed requests and no other request for the test proxy session; its latest request remained the earlier GUI reply. Startup measurements and stable idle are separate.

| Condition           | Backend CPU % | Backend RSS start → end MiB | Backend physical read / write MiB | Codex CPU % / final RSS MiB |
| ------------------- | ------------- | --------------------------- | --------------------------------- | --------------------------- |
| org2-visible-idle   | 0.297         | 59.2 → 68.8                 | 0.25 / 0.04                       | 28.347 / 798.6              |
| org2-minimized-idle | 1.716         | 63.9 → 76.8                 | 14.48 / 0.00                      | 20.263 / 685.3              |
| post-close-cycle1   | 0.216         | 76.9 → 79.4                 | 2.56 / 0.09                       | exited                      |
| reopen-cycle2       | 0.429         | 79.2 → 69.8                 | 0.17 / 0.07                       | 49.320 / 1960.1             |
| stable-cycle2       | 0.170         | 65.0 → 51.2                 | 0.00 / 0.00                       | 22.129 / 1093.4             |
| post-close-cycle2   | 0.242         | 44.7 → 56.4                 | 11.09 / 0.07                      | exited                      |

Native Codex startup physical I/O was approximately 681 MiB read / 580 MiB written among persistent sampled processes; most was attributed to its GUI/helper, not ORG2. Its later stable sample fell to about 1 MiB read / 15 MiB written and RSS decreased from 1,420 to 1,093 MiB. This needs a longer native-client baseline before attributing startup costs to this PR. No GUI/core accumulated after either test exit; pre-existing updater/crash handlers are outside this assertion.

## Audit

| Area               | Verdict                | Evidence                                                                           | Change or reason kept                                               | Verification                                                 |
| ------------------ | ---------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------ |
| Background work    | keep, partial evidence | Backend CPU returned near idle; stable second-cycle sample had zero physical I/O   | No polling or lifecycle code changed in this follow-up              | Finite runtime windows; watcher/scan counts not instrumented |
| Memory             | keep, partial evidence | Stable second-cycle backend and native process-tree RSS decreased after startup    | Short observations cannot establish a long-term bound               | Repeated Open/exit samples; no leak-free claim               |
| Scope/isolation    | keep                   | Only the isolated profile's verified GUI received SIGTERM; repeated Open reused it | Daily roots and auth were not modified                              | PID/profile argument checks and per-home index readback      |
| Rendering/hot path | keep, unverified       | No rendering instrumentation in this run                                           | Backend measurements do not cover WebKit or active-stream rendering | Active streaming and renderer coverage remain open           |

## Provider and boundary matrix

| Provider | Raw transition                                                                                               | App/UI state                     | Topology/boundary                                  | Expected invariant                                          | Observed evidence                                                                                                                                                                                                                                                                                  |
| -------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------- | -------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex    | Compaction + reply                                                                                           | Resumed existing native thread   | User GUI → package proxy → Market                  | Continue imported history using destination route           | Completed reply and authoritative billing receipts                                                                                                                                                                                                                                                 |
| Codex    | Completed append                                                                                             | Writer live, then SIGTERM        | Managed raw → automatic coordinator → source index | Publish only after writer release; preserve complete raw    | Raw persisted while live, source changed after exit; 50 records preserved                                                                                                                                                                                                                          |
| Codex    | No-message Open/exit                                                                                         | Repeated isolated product launch | Product launch + indexed roster + journal          | No duplicate writer/list row or publication loop            | Two SIGTERM exits separated by product reopen: raw hashes, indexed row counts, retained-file counts and journal hash unchanged; one pair, zero pending/waits/observations; no GUI/core remained after exits. User inspected first reopen; second launch did not automate native thread navigation. |
| Codex    | Competing edits, mtime-only edit, interrupted publication                                                    | Disposable fixtures              | Production storage/selection boundary              | Winner, fences and recovery remain correct                  | Existing final-source tests listed below; not GUI claims                                                                                                                                                                                                                                           |
| Claude   | Raw history roundtrip, completed tools                                                                       | Temporary native CLI homes       | Production raw storage + native CLI                | Preserve continuation and avoid reexecuting completed tools | Final-source native offline tests passed: two resume handoffs and 19 completed-tool handoffs, each consumed by real Claude CLI in isolated homes; raw bytes and destination configuration preserved                                                                                                |
| Both     | Account/endpoint switch, long-running active load, multi-instance contention, full fork/delete/rotate matrix | Not exercised here               | Full product lifecycle                             | Bounded work and no cross-owner writes                      | Not run                                                                                                                                                                                                                                                                                            |

## New native checks

```sh
ORG2_CLAUDE_CANARY_OUTPUT=<private-output-directory> cargo test --manifest-path src-tauri/Cargo.toml -p org2 --lib --locked --offline native_offline_ -- --ignored --test-threads=1
```

Result: **2 passed, 0 failed**. `native_offline_raw_history_roundtrip_uses_target_configuration` validated two native snapshots/resumes; `native_offline_completed_tools_do_not_execute_when_resumed` validated 19. Production storage transferred histories between disposable native homes; the real CLI consumed them through a sandbox restricted to loopback networking. No paid upstream call or GUI behavior is claimed. These opt-in tests were ignored in the earlier 437-test run and are reported separately.

## Existing owning-boundary evidence

The saved final-source command passed 437 tests with five opt-in/child fixtures ignored; these are prior results, not reruns in this follow-up:

```sh
cargo test --manifest-path src-tauri/Cargo.toml -p org2 -p agent_cli --lib --locked -- market_connection:: cli_managed_proxy:: managed_config:: agent_sessions::cli::native_materializer:: --test-threads=1
```

Specific passed cases include:

- C9/C10: `later_native_revision_wins_both_directions_and_does_not_rebound`, `tied_different_native_revisions_choose_primary_once`, `unchanged_raw_hash_ignores_mtime_and_does_not_defeat_a_real_edit`.
- C11: `target_writer_defers_then_reselects_both_latest_revisions`, `loaded_source_append_during_staging_discards_the_unpublished_copy`, `busy_destination_and_both_loaded_sides_do_not_hash_repeated_growth`.
- C12/C13: `fork_reuses_frozen_ancestor_retained_at_another_discovery_path`, `pending_fork_cannot_publish_when_its_existing_ancestor_disappeared`, `resumes_pending_publication_after_rename_without_duplicating_settings`, `resumes_pending_publication_after_sql_commit_and_before_ledger_commit`, `recovery_uses_durable_snapshot_when_source_continues_after_interruption`.
- Launch recovery: `observed_failed_launch_recovers_after_exit_even_after_org2_restart`, `observed_launch_never_recovers_from_live_or_unreadable_identity`, `recovery_rechecks_profile_and_reuses_a_replacement_without_dispatch`; `recorded_process_exit_requires_kernel_lifetime_evidence` separately exercises a real child process and kernel start time. The composed GUI failure/recovery branch was not induced.

## Subsequent C7 writer-boundary finding

A real source app-server resumed the existing thread with its own account profile
and completed an exact reverse marker using `gpt-reserve`, with zero tool calls.
Automatic handoff preserved its ordered user/assistant records; the user saw one
conversation and the marker once. After the managed GUI was terminated, however,
new managed metadata replaced the source rollout path while the source native
writer still held the previous inode. Native locks were under account
`CODEX_HOME`, while synchronization checked the separate `sqlite_home`. No second
append was attempted against the detached inode, so this proves unsafe writer
isolation, not observed data loss. C7 was **not passed** by the visible marker.

The source producer was then released through stdin EOF, exiting normally with
code zero. The correction adds a store fence at the producing spawn boundary and
holds it through target preparation/publication and recovery. Final history
regressions passed **42/42**; rebuilt two-turn GUI acceptance remains pending.
Initialize-only native probes verified inherited-child protection and release on
EOF without model calls. Direct command/exec did not inherit the descriptor;
stdio MCP did, and normal EOF teardown released it. Process-group teardown and
orphan availability limitations are recorded in the architecture audit.

The following 45-second samples belong to the **old candidate** and overlap other
compilation. CPU was recomputed from raw Mach ticks with timebase 125/3. WebKit
membership uses macOS process responsibility, not only parent PIDs. The separately
launched source app-server is excluded. RSS remains summed sampled RSS and CPU/I/O
omit children born and gone between samples.

| Actual phase                                                        | Backend CPU % | WebKit CPU % | Managed Codex CPU % |
| ------------------------------------------------------------------- | ------------- | ------------ | ------------------- |
| Product Open/startup (original filename said visible idle)          | 1.141         | 2.181        | 24.735              |
| Post-canary settle (sampling began after the short reply completed) | 1.366         | 2.755        | 41.597              |
| ORG2 minimized, source held, target inspected/closed during window  | 0.592         | 1.780        | 4.440               |
| After target SIGTERM, source still loaded                           | 1.062         | 1.184        | exited              |

These are process-resource observations, not active-stream renderer timings or an
uncontended benchmark. Minimize was observed; document visibility was not
instrumented. The writer-isolation failure prevents these samples establishing
acceptance of the old candidate.

## Fence93 follow-up: producing boundary and terminal history

The next local bundle included the store fence but preceded the terminal-history
correction below. Its main executable SHA-256 was
`50429b08a108121737368950f71531253e8dbe088c658b1b4ca5d9c3bbf7cd4a`.
The instance-93 build and strict ad-hoc signature verification passed. This
bundle is called Fence93 here to distinguish its runtime evidence from the final
source and any later combined acceptance build.

A real ORG2 Codex CLI session send proved the production `run_session` wiring:
the native child held the actual store fence, an exclusive probe was busy, and
normal child exit released it. That request hit the account's exhausted ordinary
allowance. It did not complete a successful product reply or exercise reserve
selection in the product. The reserve selector is separate PR #2143.

A separate protocol harness used the existing account's reserve route and held
one native app-server across two successful no-tool turns. Both exact canaries
completed, and the live source FD stayed attached to the indexed inode through
managed Open, target SIGTERM and the second append. However, while the source
was live neither marker exported. The user accurately reported seeing only the
older marker. After normal source EOF (exit zero), both markers automatically
reached the managed store before focus/Refresh, retaining all 95 source records
in order plus one destination settings record, with one indexed conversation.
These are protocol and product-Open observations; they are not two successful
product-entry sends and do not pass C7.

The authoritative source projection contained four completed and two older failed
turns. Its byte/ordinal frontier exactly matched the raw file; a synchronous
product Open also did not copy it. The writer's completed-snapshot predicate
incorrectly required every historical turn to be successful. Native terminal
states are `completed`, `failed` and `interrupted`; only `inProgress` is active.
The producing adapter now requires every selected turn to be one of those exact
terminal states. Unknown/empty statuses, unprojected bytes and ordinal lag remain
rejected. Source histories, indexes and journals were not manually rewritten.

The engine regression covers a fenced source with failed/interrupted ancestors
and a completed latest turn, live and unknown statuses, byte/ordinal lag, and
export of the valid terminal snapshot while the producer remains alive. The
entire `codex_history` suite passed **76/76**, and agent_cli test Clippy passed.
This source correction was not in Fence93 and still requires rebuilt runtime
acceptance. Review also identified a normal Stop cancellation path that notified before the
inherited child descriptor closed. Its correction probes exclusive availability
on an independent same-inode descriptor, releases that probe and then notifies.
Only a busy producer-release event starts 100 ms asynchronous checks, bounded to
ten seconds on the existing runtime. No store scan or idle loop is added. Two
regressions cover delayed release across two real children and bounded timeout;
no-runtime, runtime shutdown and orphan holds beyond the bound retain the safe
fence but may need a later event for convergence.

Final source checks after both corrections:

```sh
cargo test --manifest-path src-tauri/Cargo.toml -p agent_cli --lib --locked codex_history
cargo clippy --manifest-path src-tauri/Cargo.toml -p agent_cli --lib --tests --locked -- -D warnings
```

Results: **78 tests passed**, Clippy passed, and `git diff --check` passed. The
unchanged org2 runner regressions and library Clippy had already passed as
recorded above; they were not repeated for this adapter-only follow-up.

### Resource observations from Fence93

The corrected one-second sampler started before the first protocol request and
included ORG2 backend, WebKit attributed by process responsibility, the isolated
native GUI tree, and the separately launched source app-server. CPU uses measured
Mach timebase 125/3 and stable PID/start-time pairs. Short-lived unsampled processes
are omitted; summed RSS is not unique physical memory, and physical I/O is not a
scan count. No new compilation was started by this task during the sample, but
other machine workloads and sampler overhead were not controlled.

| Actual phase                           | Seconds sampled | Backend CPU % | WebKit CPU % | Native GUI CPU % | Source app-server CPU % |
| -------------------------------------- | --------------- | ------------- | ------------ | ---------------- | ----------------------- |
| Visible idle                           | 44.7            | 0.495         | 1.588        | absent           | absent                  |
| First protocol reply                   | 4.2             | 0.380         | 1.222        | absent           | 2.058                   |
| Managed Open, user inspection and exit | 197.1           | 0.840         | 1.809        | 34.467           | 0.013                   |
| Source held after target exit          | 12.6            | 0.359         | 1.423        | absent           | 0.003                   |
| Second protocol reply                  | 1.1             | 0.325         | 1.388        | absent           | 0.206                   |
| Source release and settle              | 50.7            | 0.864         | 1.915        | absent           | absent                  |
| Minimized idle                         | 47.4            | 0.380         | 1.410        | absent           | absent                  |

The recorded pre-Open window is intentionally excluded: its phase marker followed
the click and its tail included native startup. The native Open window includes
inspection and signal exit, not stable idle. Its sampled RSS peaked at 2,429 MiB,
with approximately 953 MB physical read and 2,106 MB write. Its CPU cost remains
unattributed; an unchanged native-client baseline is needed. No target GUI/core
remained after the verified signal exit.

Visible-idle backend RSS fell from 136.8 to 122.5 MiB and WebKit from 91.0 to
54.2 MiB. In minimized idle the backend fell from 96.9 to 70.4 MiB with zero
physical I/O, and WebKit from 184.4 to 33.1 MiB with 237,568 bytes read and no
writes. These finite observations do not establish a long-term memory bound.
Minimize was observed but document visibility was not instrumented. Protocol
replies do not cover the ORG2 product streaming renderer.

## Remaining acceptance

C7 requires the rebuilt candidate to preserve a live source through managed
metadata changes and a second continuation, then converge automatically after
normal source release. The terminal-history and Stop corrections need runtime
verification. Product-entry sends must be distinguished from the protocol harness:
the normal product runner exits its app-server per turn, so consecutive completed
product turns are not one continuously loaded producer.

Full interleaved native writers, normal menu exit, failed-startup GUI recovery
and fallback discovery uniqueness remain unverified. Retained physical
generations are not duplicate indexed conversations and were not deleted.
Current Claude desktop H1/H2 evidence is historical; the offline fixtures do not
replace GUI coverage.

Performance verdict: **blocked** on active product-stream/renderer measurements,
native-client cost attribution, sustained retention and contention,
identity/endpoint transitions and the remaining provider lifecycle cells. The
finite samples do not demonstrate an unbounded regression, and do not establish
a full pass.

## Combined93: actual product streaming and generation readback

This local-only candidate merged #2103 `4a29a30d6fd6be49b1a04266f48543c1bfbcaab8`
with #2143 `a02d3da41d69f5e8d53b5390cdb822f0911bf2ef` to make the explicit Reserve
selector available. Merge identity was `b9056d6abaf196ed4c3576bfa30d5cf4b798aaea`;
executable SHA-256 was
`24222973db6ac1ef43c2830ea19ac62c1cb1a62d4b03444070444d71c2fba07c`.
Build and strict ad-hoc signature verification passed. This mixed build was not
pushed into either PR and cannot be described as a pure #2103 build.

The user newly opened the C7 thread in the managed native GUI; read-only FD
inspection confirmed its thread lock and rollout. ORG2's actual chat UI then
sent a bounded no-tool request with GPT 5.6 Luna Reserve Medium. Its source
app-server held the inherited actual-store fence. Only the freshly verified
managed GUI received SIGTERM during the active turn. Source FD and indexed inode
matched before and immediately afterward; the final source inode was unchanged.
The reply completed with exactly 250 numbered lines and its distinct final
marker. Before any Refresh/focus/navigation, the managed store automatically
contained the reply, with equal user/assistant sequence, a source-prefix raw file,
single indexed rows and zero journal pending/waits/observations. Raw timestamps
place destination import about 0.818 seconds after source completion. Earlier
failed turns remained intact. The real product app-server exits after each turn;
this is not same-live-producer evidence across two product turns.

C7 still failed at ORG2 readback. Its durable session was completed with no live
PID, but settled-tail recovery read the old two-turn generation and reported a
missing native user anchor. The current SQLite `rollout_path` contained the reply;
the older retained file still existed. Existence-only cached paths and filename
suffix discovery had mistaken that old file for the current thread. The fix
reselects the authoritative indexed generation and propagates invalid indexed
state instead of substituting cached history. Historical retained files require
no deletion or migration. No manual reconciliation or lock clearing was used.
Second product continuation, actual Stop and native reopen of the new marker
were withheld after that failure, preserving the failed acceptance result.

### Measured resource phases

The one-second sampler includes backend, responsible WebKit XPCs, managed native
descendants and separate product source app-server. It retains PID/kernel-start
identities after parent exit. CPU uses Mach timebase 125/3; source identities take
precedence over backend membership. Three exit-transition samples overlapped and
were de-duplicated in derived results; original samples remain preserved. RSS is
summed, physical I/O is not scan count, and unsampled short-lived children are
omitted. No compilation ran during this sample.

| Actual phase                               | Seconds | Backend CPU % | WebKit CPU % | Native CPU % | Source CPU % |
| ------------------------------------------ | ------- | ------------- | ------------ | ------------ | ------------ |
| Target loaded, source idle                 | 47.4    | 0.726         | 1.367        | 3.773        | absent       |
| Real product turn, target still live       | 37.6    | 11.330        | 20.390       | 21.532       | 3.378        |
| Target exited, remaining stream and settle | 49.1    | 11.021        | 20.502       | 0.004        | 2.129        |
| Minimize requested, failed recovery state  | 51.3    | 0.662         | 1.611        | 0            | absent       |
| After normal ORG2 Quit                     | 58.2    | absent        | absent       | 0            | absent       |

The live-target native cost was primarily its profile-local computer-use helper
(19.115% of one core), not ORG2's history backend. Its loaded-idle RSS peaked at
1,764.3 MiB. This attribution does not establish an unchanged-client comparison.
The minimized observation was abnormal recovery, and accessibility did not
independently certify minimization; it is not a normal hidden-idle pass. Product
active rendering ran, but missing final history means these samples do not prove
correct or smooth completed-turn rendering.

Normal ORG2 CmdQ → Quit removed backend, WebKit and source cohorts; none survived
the 58.2-second postquit interval. The earlier native SIGTERM left one vendor
`bare-modifier-monitor` orphan, 22.9 MiB and zero measured CPU. Its managed-parent
and kernel-start identities were retained; only that verified test descendant
was subsequently cleaned up with SIGTERM. Native all-descendant release and
normal native menu Quit therefore remain unpassed.

**Performance verdict: blocked.** Rebuild the indexed-path correction before
continuation/Stop/reopen acceptance; then complete normal native exit, repeated
lifecycle, sustained retention/contention and provider/identity matrix cells.
Finite observations above are evidence, not a complete acceptance pass.

Indexed-generation correction verification:

```sh
cargo test --manifest-path src-tauri/Cargo.toml -p org2 --lib --locked native_transcript_resolution_tests
cargo test --manifest-path src-tauri/Cargo.toml -p org2 --lib --locked native_materializer
cargo test --manifest-path src-tauri/Cargo.toml -p org2 --lib --locked commands::history
cargo test --manifest-path src-tauri/Cargo.toml -p org2 --lib --locked transcript_revision_tests
cargo clippy --manifest-path src-tauri/Cargo.toml -p org2 --lib --tests --locked -- -D warnings
```

The four filters passed 5, 102, 8 and 6 tests respectively: **121 passed**, with
seven existing opt-in tests ignored (five materializer, two history). Clippy and
`git diff --check` passed. Owning-boundary regressions cover current-generation
selection after an earlier read, same-size/mtime revision changes, invalid or
locked indexes without stale fallback, managed/account symmetry and ambiguous
legacy discovery. This does not replace the pending rebuilt GUI run.

Removing the existence-only cache means each ordinary indexed resolution reads
one SQLite row on demand. Unindexed legacy homes use a bounded directory walk;
repeated legacy reads can cost more I/O than the old cached path. No new timer is
added, but a large-legacy-home runtime baseline has not been measured.

## Combined2: rebuilt recovery and product continuation

Local-only merge `88d607508da00275462b2429e0e5fc748ace62af` combines #2103
`33fddce8` with #2143 `a02d3da4` for Reserve selection. The signed instance-93
executable SHA-256 is
`d615fcd6effa8c57c1ee2d2d31b921feb2a645012e1bcf97a362c75ca8289138`.
The release Rust build completed; the reused frontend is unchanged between the
two local combined candidates and its build files are recorded in the private
build manifest. The combined branch is not published.

The reopened product recovered the existing 250-line answer from the indexed
generation without resending it. Native source and managed raw hashes remained
unchanged during this recovery. A subsequent product request returned the exact
short continuation marker, retained the earlier answer, and settled to idle.
Thus rebuilt indexed-generation recovery and source continuation have real GUI
evidence; this does not alone pass the whole C7 concurrent-writer case.

A bounded 500-line request was then dispatched through the product for Stop
acceptance. Its actual source app-server held the current indexed rollout inode
and inherited actual-store writer fence. While it ran, the empty composer showed
Send rather than Stop, an older failed prompt appeared at the end, and the
working timer counted from that old prompt. No Send/Retry was clicked after the
request. The request completed naturally before cancellation was exercised,
retained its answer, and the source process exited. **Stop remains unpassed**;
neither a successful cancellation nor a need to kill the process is claimed.
This older conversation/control projection path is being investigated separately
from the native generation resolver; no UI filter or persisted-data cleanup was
applied.

At that point the managed connection used the original setup: two catalog waits
had timed out. Normal ORG2 Quit and a fresh process cleared the flight; the next
catalog request succeeded, and product Configure/Open succeeded. Configure
imported both new source replies with matching ordered user/assistant roles,
one indexed conversation on each side, and zero pending/waits/observations.
This was configuration-triggered reconciliation, not automatic publication on
an active target's exit. The newly opened native process had loaded an empty
thread; user selection of the existing C7 conversation is required before the
current candidate's concurrent loaded-target case can proceed.

The one-second process/responsibility sampler covered these phases and normal
ORG2 exit/restart, then stopped after a bounded 13-minute run. Its Mach timebase,
PID/start identity retention and source/backend separation follow the method
above; there were no overlapping group identities in this run.

| Actual phase                                | Seconds | Backend CPU % | WebKit CPU % | Native CPU % | Source CPU % |
| ------------------------------------------- | ------- | ------------- | ------------ | ------------ | ------------ |
| Bounded long request, target absent         | 108.1   | 11.628        | 21.768       | absent       | 2.617        |
| After normal ORG2 Quit                      | 26.4    | absent        | absent       | absent       | absent       |
| Configured, visible, native startup ongoing | 23.1    | 0.639         | 1.449        | 107.865      | absent       |
| ORG2 minimize requested, native window open | 130.5   | 0.564         | 1.476        | 17.822       | absent       |

All previously observed backend/WebKit/source identities were absent throughout
the postquit interval. During the final 130.5-second window, backend RSS was
117.6 → 116.8 MiB and WebKit RSS 131.1 → 133.4 MiB; backend/WebKit physical writes
were zero. Native RSS fell from 1,451.8 to 1,214.5 MiB. These finite measurements
do not establish a long-term memory bound or prove document visibility changes.
The preceding 23.1-second native phase included a child `/usr/bin/tar` at 75.6%
of one core and approximately 1.44 GiB total native physical writes, so it is
startup/unpacking evidence, not stable-idle acceptance or an ORG2 regression
attribution. No before/after native-client baseline was measured.

Native normal-menu exit, actual Stop, sustained retention, contention and full
provider/identity lifecycle coverage remain open. No full performance acceptance
or merge-ready claim follows from these finite checks. The configured test
target remains open for the required user navigation; the sampler has exited.

## Combined2: concurrent target exit and actual Stop follow-up

The user then selected the existing C7 conversation in the newly opened native
window. Read-only process/start/profile checks and the native core's canonical
thread lock plus current rollout FD confirmed the target had actually loaded
that conversation. A new, real product request generated 250 numbered lines.
The source app-server held FD 33 on the current indexed inode 401512209 and the
inherited actual-store fence on FD 89. After identity revalidation, only the
isolated native GUI received SIGTERM at 21:24:48 UTC. Eight seconds later, the
still-active source retained the same path, FD and inode with its fence busy.

The reply completed at 21:25:44.028 UTC. Automatic managed publication followed
at 21:25:44.870 UTC, approximately 0.842 seconds later, before Refresh or any page
change. Both indexes contained one conversation; ordered user/assistant records
matched, the exact completion marker occurred in one assistant message per
side, and journal pending/waits/observations were zero. The current raw source
was a byte prefix of the destination, which added only destination settings.
ORG2's next readback retained the new answer and settled to idle, with six turns
in order and no stale-generation recovery error. This passes the rebuilt
loaded-target-exit writer-safety, automatic-convergence and settled source
readback case. It does not yet certify native reopen visibility or normal exit.

A separate bounded cancellation request then ran through the same product UI.
Its source app-server held the current rollout FD 39 and actual-store fence FD 65. This time the empty composer exposed the actual Stop control. Clicking it
at 21:27:17 UTC stopped that process; the same store-fence inode became free and
its release notification mtime advanced. The source persisted `turn_aborted` at
21:27:17.257 UTC and automatic managed publication followed at 21:27:18.090 UTC
(approximately 0.833 seconds). Both raw copies contained the interruption,
their ordered messages matched, journal pending/waits/observations were zero,
and ORG2 settled to idle. No Refresh, direct sync call, manual lock change or
synthetic runner was used. Actual active-request cancellation, writer release
and automatic interruption publication therefore passed.

There was no visible partial assistant text before Stop, so partial-text
retention and smooth live rendering are **not** passed. The earlier empty-Send
observation and stale failed-turn overlay remain preserved; Stop availability
was not consistently broken. The old failure appeared at the tail while active
and disappeared during settled canonical readback; its separate projection
diagnosis is still open.

The signal exit again left the vendor modifier-monitor helper. Its previously
sampled parent and current kernel-start identity were verified before narrow
test-only SIGTERM cleanup; this is not automatic all-descendant release. Product
Open then launched a fresh native test target for one final user check of the
latest completion/interruption and normal menu Quit. That check remains pending
at this writing. Full performance acceptance remains **blocked**.

This follow-up used a separate bounded 393.8-second, one-second-interval sampler
with the same process/start/responsibility method, which has now exited. The
20.9-second live-target dispatch phase measured backend/WebKit/source CPU of
10.754%/20.464%/4.317%; the next 72.6 seconds across target exit, source completion
and settling measured 10.736%/20.474%/2.076%. The distinct 40-second cancellation
request phase measured 13.455%/23.429%/3.101%. These mixed functional phases are
not uncontended throughput or rendering benchmarks. After product reopen,
120.7 seconds awaiting user inspection measured backend 0.763%, WebKit 1.504%,
native 15.813% and no product source process; native startup and its open window
are included. Long-duration retention and native normal-exit measurements still
require their separate lifecycle checks.

## Final native inspection and normal exit

The user supplied a screenshot showing the latest 250-line completion marker
and the later cancellation request in order, then confirmed normal native exit.
The screenshot did not expose an explicit interrupted-status label; persisted
interruption is established by the native raw `turn_aborted` evidence above.
At 21:49:38 UTC, read-only kernel checks found all 16 identities captured at
reopen absent, including the GUI/core and tracked descendants. A broader check
of all 23 native process/start identities sampled during that reopen also found
no survivors. No GUI root remained for the isolated profile. No signal or manual
helper cleanup was used for this normal-exit cycle. This closes the observed
normal native menu-exit/process-release check, not a claim about every possible
unsampled short-lived descendant or long-duration resource behavior.

After exit, both native indexes still contained one C7 conversation. The
completion marker occurred once per side in an assistant message, and both
retained one `turn_aborted`. Ordered user/assistant messages were identical
between stores and unchanged from the Stop result. Only destination/thread
settings events had been appended during native reopen/return. Journal pending,
waits and observations were all zero; subsequent readback confirmed stability.
No new model request was sent during final inspection or exit verification.

The screenshot also showed a visible internal `<ide_context>` correlation
envelope containing `orgii-turn-intent`. This is persisted producer data from
the existing `native_correlated_user_input` → `with_turn_intent` path, which
predates this PR. ORG2's parser extracts the correlation, while native Codex
displays the raw user input. Raw-history sharing exposes that compatibility/
presentation gap; it remains unmodified. No marker, native history or associated
recovery data was deleted, and completely clean native prompt presentation is
not claimed.

**Performance verdict remains blocked:** finite lifecycle/process-release
checks passed, but sustained retention/contention, smooth live rendering,
partial-text cancellation retention and full provider/identity/platform matrix
coverage remain incomplete.

## Correlation metadata correction after final screenshot

The producer now uses native `turn/start.clientUserMessageId`, leaving user text
literal. Current and legacy raw readers consume `client_id`; prior XML envelopes
remain read-only compatibility. This supersedes the earlier statement that the
presentation gap is unmodified **for new turns only**. Existing histories and
recovery artifacts have not been altered, and the old Combined2 package does not
validate this source correction.

| Area               | Verdict | Evidence                                              | Change or reason kept                                           | Verification                                                       |
| ------------------ | ------- | ----------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------ |
| Background work    | keep    | Existing turn RPC and raw ingestion                   | No timer, process, subscription or scan added                   | Source call-chain review                                           |
| Memory             | keep    | Intent bounded to 256 ASCII characters plus namespace | One per-turn metadata value; no app-lifetime map                | Boundary validation regression                                     |
| Scope/isolation    | keep    | Metadata on the owning native user record             | No identity sidecar or cross-home lookup                        | Distinct identical-text turns and legacy/native append regressions |
| Rendering/hot path | fix     | XML formerly injected into native user text           | Correct producer; constant-size metadata decode per user record | Literal-text RPC and raw-reader regressions                        |

| Provider                      | Raw transition                                               | App/UI state                        | Topology/boundary                                     | Expected invariant                                             | Observed evidence                      |
| ----------------------------- | ------------------------------------------------------------ | ----------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------- |
| Codex                         | Current/legacy user records, completed and interrupted turns | Repeated parse                      | Raw → ORG2                                            | Stable distinct IDs, ordered clean text, preserved correlation | Targeted regression                    |
| Codex                         | Legacy envelope followed by native metadata                  | Warm tail-window append             | Raw → mobile projection                               | Submit identity remains attached after append                  | Targeted regression                    |
| Codex                         | Fresh and resumed turn                                       | New native process for history read | Real installed app-server → disk → native read → ORG2 | Literal body and durable client/intent ID                      | Results below                          |
| Codex                         | New clean-body message                                       | Native GUI reopen                   | Rebuilt product → managed GUI                         | No newly injected XML; one ordered message                     | Not run after correction               |
| Older Codex / other platforms | New metadata-bearing turn                                    | Runtime-dependent                   | Native protocol                                       | Field accepted and persisted                                   | Not run; no fallback to text injection |

This correction does not change fence/reconciliation ownership. Previously
measured C7/Stop/menu-Quit results remain evidence for those earlier binaries,
not a complete performance verdict for a new package. Full sustained retention,
contention, partial-text cancellation and provider/identity/platform coverage
remain incomplete. **Performance verdict: blocked.**

Correction verification (installed native core `0.155.0-alpha.16.3`):

```sh
cargo test --manifest-path src-tauri/Cargo.toml -p orgtrack_core --lib --locked turn_correlation
cargo test --manifest-path src-tauri/Cargo.toml -p orgtrack_core --lib --locked sources::codex::app::transcript
cargo test --manifest-path src-tauri/Cargo.toml -p org2 --lib --locked codex_app_server
cargo test --manifest-path src-tauri/Cargo.toml -p org2 --lib --locked managed_codex_native_reply_keeps_submit_identity_after_append
# Set ORGII_NATIVE_CODEX_APP_BINARY to the installed Desktop core executable:
cargo test --manifest-path src-tauri/Cargo.toml -p org2 --lib --locked live_native_fresh_and_resumed_turns_are_in_default_desktop_list -- --ignored --nocapture
```

Respectively **3, 30, 66, 1 and 1 passed (101 total)**. The regular transcript
and app-server filters left 3 and 5 opt-in tests ignored; the named installed
native test was explicitly run separately. That test uses temporary account,
index and project homes plus a loopback Responses fixture (two model requests,
no account credentials or paid service). Each production fresh/resumed turn is
followed by a new native process reading the thread: native visible user text
matches the authored input exactly; `clientId` survives persistence, and the
actual raw file replays with the expected ORG2 `turnIntentId`, count and order.
This is real native protocol/disk evidence, not GUI visual acceptance.

`cargo clippy --manifest-path src-tauri/Cargo.toml -p org2 -p orgtrack_core --lib --tests --locked -- -D warnings`
and `git diff --check` passed. Workspace-wide `cargo fmt --all -- --check`
reported pre-existing formatting differences; unrelated source formatting is
excluded. No frontend code changed, so TypeScript/UI-control checks are not
applicable. Latest `develop` was fetched and a merge-tree check found no
conflicts; no unrelated target-branch changes were folded into this fix.

## Combined3 fresh-session regression and correction

The marker-correction bundle built and passed strict ad-hoc signature validation.
A fresh own-key Reserve session completed the requested clean-body reply, but
ORG2 entered its global error page with `Codex indexed rollout escaped its
store`. The current row pointed at the legitimate account-owned raw directory,
while SQLite lived in the native home. This run is **failed GUI acceptance**;
the successful model response and clean persisted input do not override it.
The error page also did not respond to normal menu Quit, so the verified isolated
ORG2 process was terminated with SIGTERM. Daily apps were not targeted.

The resolver correction scopes the extra permitted raw root to the persisted
account owner. Current read authority stays distinct from the native destination,
and missing/invalid rows never fall back to retained old files. Managed stores
keep their original single-home boundary. No timers, polling, caches or new
scans are introduced; resolution checks at most two known roots and one bounded
SQLite row. Promotion remains under the existing producer/finalization lifecycle.

The installed-native loopback fixture now exercises the production ORG2
resolver and revision reader, followed by production convergence/catalog refresh
and a new-process native read. It passed with literal fresh/resumed inputs and
both durable correlation IDs intact. This is real provider protocol evidence,
not GUI or paid-route acceptance. Private provider histories were not edited.

The separate installed-native interruption reference received three output-text
deltas, then invoked real `turn/interrupt`. `thread/read` returned an interrupted
turn containing only its user message; raw history had `turn_aborted` and zero
assistant response items. This establishes that unfinalized partial deltas are
not durable history in the tested native version. A live GUI cancellation after
visible text remains necessary to assess the product behavior; partial retention
must not be reported as passed or simulated by inventing a native message.

| Area               | Verdict                  | Evidence                                            | Change or reason kept                                                    | Verification                                                     |
| ------------------ | ------------------------ | --------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| Background work    | keep                     | One current-row lookup; at most two canonical roots | No additional recurring work                                             | Targeted resolver tests and native protocol fixture              |
| Memory             | keep, unverified runtime | No new retained state                               | Package idle and streaming samples still pending                         | No long-term bound claimed                                       |
| Scope/isolation    | fix                      | Fresh indexed raw belongs to the saved account      | Allow only that owner alongside the native home; managed homes unchanged | Foreign-account, escaping-link and managed-isolation regressions |
| Rendering/hot path | unverified               | Failed GUI canary stopped before streaming tests    | Fix the owning storage boundary before resuming GUI measurements         | GUI revalidation pending                                         |

Performance verdict: blocked — rebuilt GUI clean-body, visible streaming,
partial-output cancellation and sustained-resource measurements remain pending.

Split-home correction validation:

```sh
cargo test --manifest-path src-tauri/Cargo.toml -p org2 --lib --locked -- native_materializer native_transcript_resolution_tests commands::history transcript_revision_tests
ORGII_NATIVE_CODEX_APP_BINARY=<installed-desktop-core> cargo test --manifest-path src-tauri/Cargo.toml -p org2 --lib --locked live_native_fresh_and_resumed_turns_are_in_default_desktop_list -- --ignored --nocapture
cargo clippy --manifest-path src-tauri/Cargo.toml -p org2 --lib --tests --locked -- -D warnings
git diff --check
```

Results: **123 passed / 7 existing opt-in ignores**, **1 real-native test passed**,
Clippy passed, and diff whitespace checks passed. The native test uses only a
local Responses fixture; it verifies fresh/resume reads, promotion and reopening
with the installed core, not a hosted model or GUI rendering.

## Combined4 rebuilt GUI and sustained contention measurement

The locally combined package contains #2103 `3a73ef0c619086d074438376528d66af41b743d7`
and #2143 `89825511bfc645090d5013dc59f5c8976a2f540a`. Its combined branch is not
published. Main executable SHA-256:
`df3d64c1974b3df79abaa7327e9527d02288371a9b0f2be8637e28cd588aefe7`.
Build and strict ad-hoc signature verification passed. The unchanged frontend
was reused with its source/build-input manifest verified.

A new product-created Reserve conversation completed `ORG2_CLEAN_GUI_OK_0924`.
The native UserMessage retained the exact submitted body and stored correlation
in `client_id`. Automatic promotion bound the current raw to the native home.
Product Configure/Open copied it; source and managed indexes each contained one
row with equal ordered user/assistant messages and no pending/waiting work.
The user explicitly confirmed that the native GUI body had neither internal
marker and that the reply existed. This passes rebuilt clean-body GUI acceptance
for new messages. Historical polluted messages were not edited or deleted.
Native GUI automation was not used to obtain that confirmation.

Two longer real product requests did not establish continuous visible streaming
or partial-output cancellation. For a 120-line answer, observations at 18.7 and
24.6 seconds showed only the leading marker; the complete body appeared later.
For the longer narrative, observations at 26, 70, 91 and 103 seconds showed no
assistant body; the response completed before a partial-text Stop could be
performed. Stop was not clicked in that attempt. These are uncovered acceptance
cells, not a successful cancellation test. They do not yet locate the delay at
the provider, transport or renderer boundary.

With the user-confirmed native conversation still loaded, another real ORG2
send completed `ORG2_COMBINED4_LOADED_TARGET_OK_0924`. Source history retained
all previous ordered messages and appended one user/assistant pair. The managed
raw hash and inode remained unchanged, and reconciliation recorded exactly one
wait for the loaded destination. This is evidence of safe deferral. The latest
response was not present in the observed ORG2 accessibility text before minimize,
although it existed in source raw; visible refresh remains under investigation.
After the user normally quit the native test app, read-only verification at
23:36:23Z (before any refresh) found matching ordered user/assistant messages,
one indexed conversation on each side, one new canary reply, zero pending,
waiting or observation entries, and an empty launch lock. All 15 captured
native process lifetimes had exited without signal cleanup. A second readback
at 23:37:35Z stayed converged. Managed raw retained the full source prefix plus
native settings metadata. Exact exit-to-convergence latency was not sampled.

Sampling used kernel process-start identities, Mach timebase 125/3, and separate
backend, responsible WebKit, source app-server and native GUI cohorts. No local
build or model request ran during either idle measurement. The 600-second visible
window included initial native navigation; its first 120 seconds are excluded
from the settled row below. The minimized window deliberately retained the loaded
destination and pending wait. OS minimize was exercised; DOM visibility and
individual scan/listener counts were not instrumented.

| Window                                    | Seconds | Backend / WebKit CPU, % of one core | Backend / WebKit RSS start → end, MiB | Backend / WebKit footprint start → end, MiB |
| ----------------------------------------- | ------- | ----------------------------------- | ------------------------------------- | ------------------------------------------- |
| Visible settled suffix                    | 478.7   | 0.578 / 1.131                       | 153.6 → 149.0 / 243.9 → 163.9         | 91.8 → 92.1 / 485.8 → 506.0                 |
| Minimized, destination loaded and waiting | 600.1   | 0.599 / 1.416                       | 161.0 → 160.5 / 477.6 → 417.8         | 94.0 → 92.1 / 524.4 → 511.6                 |

Backend and WebKit counts stayed at one and three. Backend physical reads/writes
were 1.52/0.32 MiB in the visible suffix and 2.06/0.40 MiB while minimized;
WebKit writes were zero. Native GUI CPU was 6.41% and 12.87%, respectively,
with 103.7/124.2 MiB physical writes. Native membership changed during settling;
its resource costs require a vendor baseline before attribution to this PR.
RSS and footprint are separate indicators: decreasing RSS alone does not prove
a memory bound. These finite windows do not certify overnight retention,
background document throttling or the full provider/platform/identity matrix.

Private evidence names: `combined4-build-receipt.json`,
`combined4-native-clean-gui-confirmation.json`, `combined4-loaded-baseline.json`,
`combined4-loaded-after-send.json`, `combined4-contention-observation.jsonl`,
`combined4-visible-idle-settled-analysis.json`, and
`combined4-minimized-wait-settled-analysis.json`.

All published CI checks passed on implementation HEAD `3a73ef0` at the final
implementation-check readback. Report-only follow-up commits must be checked
separately. **Performance verdict: blocked** — continuous visible streaming,
partial-text Stop/retention and the full lifecycle matrix remain unverified.
Native exit convergence and captured native-process release passed as above.

## CLI live-text boundary correction

A bounded diagnostic rerun on Combined4 recorded 3,303 native
`item/agentMessage/delta` notifications, beginning at 23:39:42.778Z, before
`turn/completed` at 23:40:42.336Z. The workstation screenshot at approximately
42 seconds still showed no current assistant body; the completed answer later
appeared. This disproves provider-side buffering for this run. The diagnostic
wrapper changed logging only, retained the main executable hash, and was restored
after normal isolated-app exit. No raw history or native database was edited.

The owning boundary is `createCliActivityHandlers`: it accumulated valid provider
text into an EventStore cancellation projection but never called the existing
`onStreamingDelta` callback. Workstation Messages deliberately excludes incomplete
EventStore rows and reads the shared session-scoped live buffer. The adapter now
publishes bounded accumulated text through that callback. Existing coalescing and
cleanup remain owned by the shared buffer; no timer or subscription is added.
The EventStore row remains for interrupted-output retention, is marked as the
existing live renderer input, and prevents Chat from creating a second synthetic
bubble. Terminalization removes its live classification. Completing an older
thinking stream cannot clear a newer message stream; completion, failure, Stop,
reset and disposal clear the current live callback.

This was a presentation-ingestion defect over valid provider data, not malformed
persisted history. Historical cleanup is unnecessary. No renderer string filter,
provider-body rewrite, native schema change or CI change is introduced.

Verification executed: `pnpm test
src/engines/SessionCore/sync/adapters/cli/__tests__/createCliEventHandler.test.ts
src/engines/SessionCore/derived/__tests__/chatEvents.test.ts
src/engines/SessionCore/sync/__tests__/nativeTranscriptReconcile.test.ts
src/engines/SessionCore/derived/__tests__/sessionScopedChatEvents.stability.test.ts`
— **133 passed**. Rebuilt GUI verification of this correction is still pending.

Performance verdict: blocked — live callback and cleanup unit regressions pass;
actual continuous display, Stop/partial retention and remaining lifecycle cells
require the newly rebuilt package.

## Combined5 streaming/Stop failure and follow-up

The rebuilt Combined5 package contains published `de628b7f207cea67d30e54975563af5d2c3a8d5f` plus the separately tracked reserve selector. In the real ORG2 Chat UI, a long no-tool reply showed only the typing indicator at 13 and 46 seconds. Clicking Stop persisted 11,615 characters in the native session's SQLite event cache, but did not display the partial. This is **failed functional acceptance**, not a retention pass. Native raw history did not contain that unfinished assistant response.

A separate diagnostic build confirmed delivery through the Tauri session channel and CLI handler, with its streaming callback present. It again showed typing without a body at 35 seconds. Diagnostic logging was bounded, private, and removed from source before this follow-up. Neither run automated the native Codex GUI.

The follow-up corrects two authoritative boundaries. Codex's structured `generic.turn_aborted` provider context no longer creates a user turn; real user-authored lookalike text is preserved. Native interrupted reconciliation now recognizes the actual sparse event-cache contract: only Rust-finalized output is persisted, without the native user/history prefix. It recovers output only for a unique, matching last native user intent followed by a failed lifecycle, with no native answer or completed lifecycle. Missing/duplicate anchors, newer native turns, foreign sessions, live placeholders and divergent histories fail closed. No raw history or database was manually changed. This intentionally does not reconstruct older interrupted turns after a newer native user turn has arrived.

The rendering follow-up also prevents a transient idle snapshot from permanently latching an accepted turn closed when actual provider deltas arrive. The body-less synthetic typing sentinel alone cannot reopen a completed turn. This is covered by a rendered hook regression; the rebuilt real GUI verdict remains pending.

Validation actually run: seven targeted Vitest suites, **204 passed**; `pnpm exec tsgo --noEmit`; ESLint on changed frontend files; `cargo test --manifest-path src-tauri/Cargo.toml -p orgtrack_core --lib --locked sources::codex::app::transcript`, **31 passed, 3 existing ignored**; `git diff --check`. The rendered live-row test uses Rust-exported aliases rather than the stale assistant aliases in the global test fixture, and verifies two growing buffer states with a structurally unchanged event and no cross-session text.

A 708.15-second Combined5 mixed startup/generation/Stop/idle/normal-Quit sample measured backend CPU 2.396% of one core / peak RSS 209.52 MiB, WebKit 5.722% / 668.02 MiB, and source app-server 0.240% / 169.41 MiB. All measured process groups released on normal Quit. This mixed window does not prove idle-only behavior, an absence of leaks, or all-provider/platform coverage.

Performance verdict: **blocked** pending successful rebuilt streaming, Stop visibility and reopening acceptance. Combined5's functional streaming/Stop verdict is **fail**.

## Cold-load and idle-refresh recovery boundary

Production-entry review found that terminal reconciliation alone did not cover initial `loadPersistedHistory` or guarded idle native refresh. Both now apply the narrow intent/lifecycle-validated sparse-output merger at the shared local projection boundary, using the existing cache read. Cached failed-delivery sidecars no longer prevent canonical continuation from recovering the matching finalized output. Recovery runs before local failed-user sidecars are inserted; provider-native user ordering remains the anchor. Unchanged histories retain reference identity, and an empty projection skips the scan. No additional timer, subscription, retained cache, native write or database read is introduced.

Actual-entry regressions cover repeated cold loads, guarded idle refresh without the terminal preservation flag, and canonical continuation with sparse output plus an unrelated failed user. Five targeted suites passed **102 tests** with `pnpm exec vitest run --config config/vitest.config.ts` for nativeConversationReconciliation, nativeConversationMaterializer, canonicalConversationEvents, sessionSyncUtils and nativeTranscriptReconcile. Typecheck, changed-file ESLint and diff checks passed. The initially cancelled Combined6 build is not acceptance evidence.

Performance verdict: **blocked** pending rebuilt real GUI streaming, Stop and reopening verification; previous failed GUI evidence remains unchanged.

## Combined7 real GUI follow-up (2026-09-24 local)

Signed Combined7 combines PR HEAD `8c2d97a596` with the separately scoped Reserve dependency only for local acceptance. The combined branch, diagnostic code and bundles are not published.

- Cold load: previous interrupted Diagnostic5 output is visible from the ordinary native-history load path (10,078 characters); no provider cancellation context appears as a fabricated user turn.
- Real Send: current turn requested `ORG2_COMBINED7_STREAM_0924`. At roughly 10, 15 and 44.7 seconds the current assistant position still showed the prior Diagnostic5 reply. **Live streaming fails.** Provider generation is not inferred from the UI: actual current output was subsequently read from the authoritative finalized cache after Stop.
- Actual Stop: navigating to the latest turn shows one current partial, 10,224 characters, in correct order. Normal Quit/reopen and ordinary Search/latest-turn navigation retains the same complete body (whitespace-normalized AX comparison), with exactly one reply marker. SHA-256 of the persisted body: `7adab91be8d9a5c2167d948900b1127c08de38e8f14a5f12ea7b9dbe0a07fb89`.
- 141.57-second mixed Send/generation/Stop/Quit sample: backend 4.407% of one core / peak RSS 143.125 MiB; WebKit 12.474% / 562.672 MiB; source app-server 0.856% / 191 MiB. All observed process identities released on normal Quit. This sample is not a sustained or idle-only baseline.
- Exact published HEAD `8c2d97a59626aa8a32297aa8e32380a5c4a25d87`: 20 checks SUCCESS; MERGEABLE. No merge performed.

Evidence: `combined7-verdict.json`, `combined7-after-stop-tail-ax.txt`, `combined7-after-stop-tail.png`, `combined7-reopen-tail-ax.txt`, `combined7-reopen-tail.png`, `combined7-stream-stop.json`, `combined7-ci-final.json` in the private acceptance directory. No DB writes, raw-history rewrites or lock clearing were used.

Performance verdict: **fail** for stale live rendering; sustained/provider/platform lifecycle matrix remains incomplete. Stop persistence and cold recovery are passed cells, not an overall pass.

Additional 240.04-second idle-with-build-contention sample: backend 0.446% one core, RSS 129.75→57.69 MiB (peak129.81); WebKit 1.735%, RSS148.11→34.58 MiB (peak203.05); no process membership changes. System memory pressure can reduce RSS; this is not leak-free evidence or an unloaded-machine baseline. Evidence: `combined7-idle-build-contention.json`.

## Resume projection duplication and Diagnostic8

A bounded private diagnostic established that current provider text reaches the live buffer and leaf renderer and grows from below 1,000 to above 6,000 characters. Actual latest-turn/bottom navigation showed the new river-story reply while generation continued. The earlier unchanged visible garden text was an extra copy of the prior interrupted reply, placed between the new user and its live output. Thus Combined7's user-visible failure remains valid, but it does not establish that the live buffer stopped updating.

The producing boundary is pre-dispatch `hydrateSynchronizedConversationProjection`. Native synchronization appends a recovered partial to the rollout under a provider row id; EventStore already has that same output under its Rust-finalized id, followed by the prepared user. Merging the native suffix appends a second historical reply after the new user. The correction installs the complete verified native projection, merges existing failed-delivery/retry-lineage sidecars, and appends the exact prepared user row last. It runs once only when synchronization changes the native prefix, before provider dispatch under queue preparation ownership. Unchanged prefixes do no additional read/write. It adds one resident EventStore read for changed prefixes and one full replacement instead of suffix merge; large-prefix cost remains an uncovered performance cell. There is no content-based deduplication, new timer, cache, background scan or schema change.

Four hydration regressions cover rematerialized interrupted output, failed sidecars/retry lineage, changed native ids with distinct equal replies, and the no-change no-I/O path. Against the old implementation three fail; after the correction, hydration, continuation and settled-tail suites pass **108/108**. Typecheck and changed-file ESLint passed. Existing historical duplicates are transient projection state repaired by ordinary authoritative reconciliation; no manual database/raw-history deletion was performed. Diagnostic code is excluded from the PR.

Performance verdict: **blocked** until the corrected package passes ordinary-send streaming visibility, Stop/reopen and remaining sustained lifecycle checks. The diagnostic changes only observability and does not serve as acceptance of the correction.

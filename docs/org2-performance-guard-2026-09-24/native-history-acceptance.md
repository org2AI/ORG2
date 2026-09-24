# Native history acceptance follow-up

Candidate implementation: `2b2c7259bb5cd56c4c98c5586b669f3a43461b88`, macOS ARM64, isolated instance 93. The candidate executable matches the previously recorded build receipt. The initial follow-up recorded verification of that candidate. The subsequent C7 section below records a newly discovered writer-boundary defect and pending verification of its correction.

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

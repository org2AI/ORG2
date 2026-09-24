# Native history acceptance follow-up

Candidate implementation: `2b2c7259bb5cd56c4c98c5586b669f3a43461b88`, macOS ARM64, isolated instance 93. The candidate executable matches the previously recorded build receipt. This follow-up records verification, not implementation changes.

## Product evidence

- Configure/Open succeeded with Codex Luna; real core plugin boolean overrides were accepted. A normal catalog Refresh recovered the earlier timeout; this does not fix the separate intermittent catalog problem.
- A user-entered continuation completed native historical pre-compaction and a reply. Both Market receipts report `gpt-reserve`, HTTP 200 and complete usage. Ledger postings balance to buyer charge 5,481, seller payable 4,020 and platform revenue 1,461 micro-USD. The submitted canary contained literal backslashes before underscores; the response preserved them.
- A user-authorized SIGTERM to the verified isolated GUI ended it and its core. Automatic writeback was observed before any UI action: all 50 original records retained in order, plus one destination settings event. Both indexes contained one test conversation. Earlier ORG2 restarts are recorded; this is not uninterrupted normal-menu-exit acceptance.
- Product reopen cleared its reservation without manual edits. The user confirmed one visible conversation, retained reply and correct order. Repeating Open while the GUI was alive reused its PID.

## Resource measurement method

Private `sample.py` used macOS `proc_pid_rusage(RUSAGE_INFO_V2)` at both ends of each 30-second window. CPU is cumulative user+system time as a percentage of one core. RSS is summed over sampled processes; physical I/O is not a filesystem-read or scan count. The ORG2 measurement covers its backend and discoverable descendants, **not independently parented WebKit XPC renderers**. Native Codex figures cover its observed GUI descendant tree; CPU/I/O deltas omit processes absent at either endpoint. Machine load average varied around 4–6; no uncontended benchmark claim is made.

The minimized condition used the native minimize control; document visibility and background throttling were not instrumented. No new model message was sent during these samples. A read-only Market query afterward still found exactly the original two completed requests and no other request for the test proxy session; its latest request remained the earlier GUI reply. Startup measurements and stable idle are separate.

| Condition           | Backend CPU % | Backend RSS start → end MiB | Backend physical read / write MiB | Codex CPU % / final RSS MiB |
| ------------------- | ------------- | --------------------------- | --------------------------------- | --------------------------- |
| org2-visible-idle   | 0.007         | 59.2 → 68.8                 | 0.25 / 0.04                       | 0.680 / 798.6               |
| org2-minimized-idle | 0.041         | 63.9 → 76.8                 | 14.48 / 0.00                      | 0.486 / 685.3               |
| post-close-cycle1   | 0.005         | 76.9 → 79.4                 | 2.56 / 0.09                       | exited                      |
| reopen-cycle2       | 0.010         | 79.2 → 69.8                 | 0.17 / 0.07                       | 1.184 / 1960.1              |
| stable-cycle2       | 0.004         | 65.0 → 51.2                 | 0.00 / 0.00                       | 0.531 / 1093.4              |
| post-close-cycle2   | 0.006         | 44.7 → 56.4                 | 11.09 / 0.07                      | exited                      |

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

## Remaining acceptance

C7 reverse paid continuation requires the isolated source producer's own configuration/authentication, which is absent; no credentials were copied to manufacture coverage. Full interleaved native writers, normal menu exit, failed-startup GUI recovery and fallback discovery uniqueness remain unverified. Retained physical generations are not duplicate indexed conversations and were not deleted. Current Claude desktop H1/H2 evidence is historical; the offline fixtures do not replace GUI coverage.

Performance verdict: **blocked** on active-stream/renderer measurements, sustained retention and contention, identity/endpoint transitions and the remaining provider lifecycle cells. The finite samples do not demonstrate an unbounded regression, and do not establish a full pass.

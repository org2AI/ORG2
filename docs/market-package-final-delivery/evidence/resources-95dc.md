# Resource samples: ORG2 95dc and official Claude

Measured on 2026-09-18 against ORG2
`95dcff53a321224b329062d1de93abaaf405b178`, with an isolated official Claude
profile. Short visible-idle and menu-hidden samples observed low CPU. After
normal Quit, all **28 recorded process identities** were confirmed exited.
These measurements do not establish full performance acceptance.

## Method and scope

The ORG2 tree comprised its root and three attributed WebKit services. Claude
had 12 recorded processes in each of two launches. Executable identity,
parent/child relationships and process birth identity were checked; WebKit
ownership was also attributed through the ORG2 launch namespace. Exit checks
retained the original identities rather than substituting same-name processes.
Unobserved short-lived or previously reparented children remain outside scope.

Each segment contains four memory samples and three CPU intervals spanning
approximately 13 seconds. CPU uses the delta of OS-reported user plus system
CPU time divided by the monotonic sampling interval; **100% means one core**.
It does not use lifetime-average process CPU. The first CPU interval is unknown;
subsequent intervals between confirmed-exited observations contribute zero.
RSS and physical footprint are separate process-accounting sums, not unique
physical RAM. All stored process sums were independently recomputed.

The operator supplied the visible-idle state and performed Hide/Quit through
the app menus. Menu Hide does not independently prove browser
`document.visibilityState === "hidden"`. Other local workloads remained active,
so this is not a controlled benchmark or a comparison against an earlier build.

| State                                    | App                      | CPU (% of one core) |     RSS (MiB) | Physical footprint (MiB) |
| ---------------------------------------- | ------------------------ | ------------------: | ------------: | -----------------------: |
| Visible idle                             | ORG2                     |         0.041–0.045 |         433.3 |              476.4–476.6 |
| Visible idle                             | Claude                   |         0.043–0.048 | 1804.0–1804.2 |              785.5–785.7 |
| After menu Hide                          | ORG2                     |         0.051–0.054 |   423.3–430.2 |              478.5–478.6 |
| After menu Hide                          | Claude                   |         0.058–0.114 | 1360.6–1360.9 |              795.6–796.0 |
| Claude Quit; Configure activity overlaps | ORG2                     |         0.035–0.095 |   401.9–407.3 |              512.5–545.1 |
| Claude Quit                              | First Claude tree        |                   0 |             0 |                        0 |
| Both apps normally Quit                  | ORG2 + both Claude trees |                   0 |             0 |                        0 |

The Configure row is **UI activity, not idle**: opening Configure and selecting
a Package overlapped sampling. It cannot support an idle comparison. The second
Claude launch was recorded for process identity and final exit verification;
its steady-state resource use was not sampled. Final exit verification covered
four ORG2 identities and 24 identities across the two Claude launches, all absent
in four observations over approximately 13 seconds.

## Performance guard coverage

| Area               | Verdict                   | Evidence                                                | Change or reason kept                                         | Verification                                      |
| ------------------ | ------------------------- | ------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------- |
| Background work    | keep within sampled scope | Low short-window idle CPU; recorded trees exit          | No source changes; timer ownership/cadence audit remains open | CPU-time deltas and original identity exit checks |
| Memory             | keep within sampled scope | Four snapshots per segment; final counters zero         | Long-term growth and retained-object bounds unmeasured        | RSS/footprint counters and recomputed sums        |
| Scope/isolation    | keep observed attribution | Isolated profile, attributed WebKit and process births  | Identity-switch and revocation behavior unmeasured            | Process ownership checks                          |
| Rendering/hot path | blocked                   | No active inference, rendering, allocation or I/O trace | No optimization claim                                         | Not run in this sampling task                     |

| Provider / app         | Transition                                                       | App/UI state                              | Boundary                          | Expected invariant         | Observed evidence             |
| ---------------------- | ---------------------------------------------------------------- | ----------------------------------------- | --------------------------------- | -------------------------- | ----------------------------- |
| ORG2 + official Claude | Idle and menu Hide                                               | Operator-controlled visible/hidden states | Recorded local trees              | Low ongoing CPU            | Short samples above           |
| ORG2 + official Claude | Normal Quit                                                      | Both apps closed                          | Original process identities       | Recorded processes stop    | All 28 identities exited      |
| Claude / Codex         | Create, append, compact/rewrite, rotate, fork, delete            | Cold/live/open/pinned/rescan              | History ingestion and listability | Correct bounded ingestion  | Not run in this resource task |
| ORG2 + vendor apps     | Offline/retry, focus return, account/endpoint switch, revocation | Active/hidden/return                      | Resource lifecycle                | Bounded work and isolation | Not run in this resource task |

Raw samples and identity evidence are retained privately. Functional calls,
billing, history continuity and configuration protection have separate evidence;
this report does not replace those checks. No new source tests or compilation
are claimed for this documentation-only report.

Full acceptance remains blocked by uncovered sustained active inference,
long-term memory growth, rendering/allocation/I/O behavior, source transitions,
explicit document-visibility behavior, focus return, offline/retry and
account/endpoint/revocation lifecycle cells.

Performance verdict: blocked

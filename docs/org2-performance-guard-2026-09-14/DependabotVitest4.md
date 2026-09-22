# Vitest 4 compatibility and resource lifecycle

Scope: PR #1721's test-toolchain migration. No application subscription, cache,
identity, transport, or persistence behavior changes. The single production fix
cancels Tooltip's pending positioning frame when its effect closes or unmounts.

| Area               | Verdict | Evidence                                                                           | Change or reason kept                                                                           | Verification                                                                                                       |
| ------------------ | ------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Background work    | fix     | Tooltip's open effect scheduled an animation frame without owning its cancellation | Capture the frame ID and cancel it in the same effect cleanup as scroll/resize listeners        | Existing ConversationModePill test checks zero timers and removed listeners over three open/unmount cycles; passed |
| Memory             | keep    | Vitest owns test workers for a CLI run; Stryker concurrency is one                 | Migrate removed poolOptions to maxWorkers, preserving main-suite cap 4 and mutation-suite cap 1 | createVitest resolved threads/4 and threads/1; contexts closed explicitly; mutation process exited                 |
| Scope/isolation    | keep    | Vitest file isolation remains enabled; production data paths are unchanged         | Retain isolated test workers and existing per-test teardown                                     | Targeted regression run: 183 tests passed                                                                          |
| Rendering/hot path | fix     | Tooltip positioning frame could outlive the open effect                            | Cancel pending work on close, unmount, or effect replacement without altering placement         | Repeated unmount test passed without weakening its zero-pending-work assertion                                     |

Lifecycle coverage: closed/idle tooltip schedules no work; open schedules its
positioning frame and listeners; cleanup cancels the frame and removes listeners.
Test workers exist only during test execution and remain bounded. Document-hidden,
authentication, provider ingestion, and multiple app-instance matrices are not
changed by this patch. No CPU/RSS improvement is claimed.

No Computer Use was performed. Visual output is unchanged, and the single
Tooltip bug fix does not require a frontend consistency audit. Source diff
inspection found no added or modified action controls or shared-input bypasses.

Performance verdict: pass for the changed frame cleanup and test-worker bounds.

# Agent Org finalization: structure and verification review

The change keeps one objective: finish team work accurately, publish a recoverable
report, and let queued user work continue in the next generation.

## Production and test boundaries

- Six new production modules are 43–584 lines. The largest is the pending
  completion-candidate owner. None of these modules embeds a test suite.
- Substantial new regressions are sibling `*_tests.rs` files or existing dedicated
  test modules. Task-tool suites are reached only through `#[cfg(test)] mod
task_tests`; persistence fixtures are also test-gated.
- Fake-provider modules and HTTP fault-injection helpers use the repository's
  existing `debug_assertions` boundary. New fake-provider behavior is separated
  into dedicated completion, report, rework and terminal support modules.
- Rendered tests remain in `tests/e2e/specs/core`; scenario support is in separate
  `tests/e2e/support/core` modules. They are not part of the frontend bundle.
- Existing small inline tests remain under their existing test gates. This is
  not a claim that the repository has no colocated tests or no long files.

## Existing long production files

Lengths below compare the implementation starting point `83109bf12` with the
verified change before target-branch integration. Integration changes from
`develop` are excluded from this size assessment. No new production file exceeds
584 lines. Broad splitting of inherited modules would add unrelated refactoring
to a tested lifecycle fix, so the exceptions below are explicitly retained.

| File                                                | Before → after | Verdict          | Reason                                                                                                                          |
| --------------------------------------------------- | -------------: | ---------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `core/coordination/agent_inbox/store_read.rs`       |    1091 → 1096 | Keep with reason | Adds the explicit system-reconciled disposition to existing reads; no new responsibility or embedded test suite.                |
| `core/coordination/agent_member_interventions.rs`   |    1738 → 1741 | Keep with reason | Only declares the new continuation module; new resume-context logic is in continuation.rs (43 lines).                           |
| `core/coordination/agent_org_run_completion.rs`     |    1938 → 1950 | Keep with reason | Keeps the completion facade; new notification, presentation and candidate logic is in three separate modules.                   |
| `core/coordination/agent_org_tasks/mod.rs`          |    1105 → 1144 | Keep with reason | Revalidates assignment identity in the existing authoritative writer; new race tests are separate.                              |
| `core/coordination/agent_org_turn_contexts.rs`      |    3018 → 3024 | Keep with reason | Retains existing admission facade; typed wake admission is in wake_admission.rs (160 lines).                                    |
| `core/coordination/schema.rs`                       |    1007 → 1006 | Keep with reason | Updates the canonical fresh-database schema; pre-existing inline tests remain test-gated.                                       |
| `core/session/persistence/crud/ops.rs`              |    1438 → 1438 | Keep with reason | Mechanical explicit-terminal adaptation; total length is unchanged.                                                             |
| `core/session/scheduler.rs`                         |    1125 → 1165 | Keep with reason | Existing scheduler and panic fallback owner; no new scheduler or embedded regression suite.                                     |
| `core/session/turn/event_handler/mod.rs`            |    1728 → 1779 | Keep with reason | Propagates the explicit terminal signal through existing event ownership; pre-existing test module retained.                    |
| `core/session/turn/processor/orchestrator.rs`       |      927 → 919 | Keep with reason | Explicit-terminal propagation reduces total length; no unrelated responsibility added.                                          |
| `lifecycle.rs`                                      |     956 → 1080 | Keep with reason | Existing transactional finalization owner; shared terminal semantics belong here, regressions live in tests/lifecycle_tests.rs. |
| `state/commands/session/message/send.rs`            |    1560 → 1581 | Keep with reason | Adapts the existing accepted-turn/send boundary; no independent feature or test suite added here.                               |
| `state/commands/session/org_tasks/group_actions.rs` |    1182 → 1184 | Keep with reason | Mechanical explicit-terminal call-site adaptation.                                                                              |
| `state/commands/session/org_tasks/lifecycle.rs`     |    1137 → 1139 | Keep with reason | Mechanical explicit-terminal call-site adaptation.                                                                              |
| `state/session_runtime.rs`                          |    1171 → 1200 | Keep with reason | Keeps terminal event projection in its current owner; new regression in session_runtime/terminal_tests.rs.                      |
| `agent_sessions/cli/native_materializer.rs`         |    6063 → 6063 | Keep with reason | Only a mechanical terminal-result adaptation in this branch; inherited long file is not expanded by this change.                |

Dedicated tests and inherited E2E drivers can also exceed these production-size
ranges. New scenarios use separate files rather than extending the generic
2,900-line UI driver with scenario implementations.

## Contract-to-test mapping

| Contract                                                          | Owning boundary                                         | Evidence                                                                                                     |
| ----------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Completion, failure and cancellation keep exact turn identity     | Executor → sender → lifecycle transaction               | Lifecycle, send-chain, scheduler and terminal tests; real member/tool Stop                                   |
| Redundant notification reconciliation preserves original messages | Completion evidence and inbox transactions              | Presentation, mixed-inbox, pending-candidate and receipt/wake tests; read-back of unread dispositions        |
| Report Stop/failure closes one attempt; retry preserves work      | Final-summary receipt and stable EventStore ID          | Summary-terminal tests; real Stop → quit/restart → retry, no member reruns                                   |
| No ready work produces no fake failure or provider turn           | Typed wake admission and assignment writer              | Wake, watchdog, obsolete-assignment race tests; real production-writer probes                                |
| Report-period user requests enter the next generation             | Shared task-creation transaction                        | `next_work_tests.rs`: both writers, success/Stop, rollback, stale/invalid authority; real examples.md replay |
| Resume and delivery guidance use actual task evidence             | Continuation context and existing tool/prompt contracts | Dedicated continuation/rework tests; real task resume, independent unittest and review                       |

## Scope and compatibility

Fresh databases only. Existing incompatible Agent Org databases are not migrated
or cleaned. Preserve the old data directory for rollback and use separate
version-compatible test profiles; do not open a new-schema database with an old
binary. There are no new dependencies, public commands, production UI controls,
background polling loops, or background-process lifetime policy changes.

The review covers call chains, transactional ownership, explicit terminal types,
source identity, stale/default rejection, persistence readers and both task
creation entrances. Ordinary-session/CLI changes are limited to shared result
wiring; full ordinary-session GUI coverage is not claimed.

## Target integration

The branch integrates `develop` at `73af1eac0` without conflicts and without
rewriting the implementation checkpoint. Of the 104 verified changed source
files, only the inherited CLI materializer differs after integration; this
branch still changes only its explicit scheduler result type and matching test.
The new real-provider BuildFast run was not repeated after integration, so its
evidence is identified as pre-integration rather than relabeled as a new run.

Post-integration core tests: **3,700 passed, 0 failed, 3 existing ignored**. Core
all-target check, 31 frontend contracts, TypeScript, lint, test placement and
changed-TypeScript file-length checks pass. The newly integrated upstream
import-cycle fixes also make the full circular-dependency check pass with zero
cycles. Strict core/application all-target Clippy also passes without warnings.

## Verification record

Verification results and integration status are recorded in the pull request.
Before target integration: full core 3,691 passed / 3 existing ignored; persistence
61 passed; frontend contracts 31 passed; core/application strict Clippy and
BuildFast passed. The pre-F5 fixed artifact had 30 passing native UI cases across
three rounds; after F5, only the requested affected regression was repeated.

The real-provider replay accepted the original examples.md request 5.5 seconds
before the preceding report finished. It then created implementation, review and
test tasks in generation 2. All six examples ran with the expected output/exit
status. Stopping the new report left no formal partial event; normal restart
preserved the tasks, certificates and stopped attempt; rapid Retry produced only
one new attempt and one persisted report without rerunning members.

Remaining limits are explicit: exact pending-dependency replacement timing was
not hit manually; report-write failure plus queued input and crash plus queued
input were not separately forced in the real-provider run; exact frontend timer,
subscription and full WebKit memory measurements remain incomplete. Earlier
failed runs and the first replay that missed the report window were preserved.

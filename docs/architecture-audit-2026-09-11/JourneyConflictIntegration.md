# Journey conflict integration architecture audit

Scope: reconcile PR #827 with develop without restoring removed owners. Completion criteria: no conflicts, type/compile checks, affected regression suites, current PR metadata, and a normal push preserving published history.

| Layer                   | Integration review                                                                                                                                                                                                          |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 Compilation           | TypeScript and Rust workspace checks plus affected tests; final results recorded in the PR verification section.                                                                                                            |
| 2 Ownership/dead code   | Keep develop's extracted sidebar actions, icon owner, imported-history cache writer and processor message shaping. Remove Journey additions to the archived renderer barrel. Pre-existing unwired helpers identified below. |
| 3 Naming                | Preserve current icon names, SessionExportModal and conversationTargetBinding.                                                                                                                                              |
| 4 Semantic overloading  | Keep session identity, active conversation runner, durable message ID and Journey branch/task as separate concepts.                                                                                                         |
| 5 Defaults              | Journey metadata defaults move with the imported-session writer; exact targets clear on a plain keyed-tab reopen.                                                                                                           |
| 6 Boundaries            | Membership assignment stays in the authoritative SQLite writer, inside the same transaction as archive authorization and assistant insertion.                                                                               |
| 7 Readability           | Integration follows current module owners instead of restoring deleted implementations.                                                                                                                                     |
| 8 Wire/persistence      | No new wire or schema format in the conflict resolution. Existing additive Journey fields and protocol-locked review API remain; adapter/serialization tests cover the local boundary. Live provider requests were not run. |
| 9 Initialization parity | Imported canonical session construction supplies default Journey metadata. Current archive-safe assistant persistence also assigns Journey membership transactionally.                                                      |
| 10 Resolver symmetry    | Keep shared tab-host category resolution and propagate both exact message targets and current conversation bindings.                                                                                                        |

All ten layers were considered for the integration. A fresh feature-wide architecture audit, live provider calls, real-app behavior and platform matrix were outside this conflict-resolution pass.

## Pre-existing release blocker

Both the original PR head (`4ed6e02a4`) and this integration have no production callers for `load_llm_history_for_active_journey` or `save_completed_turn_and_assign_journey`; only exports and tests reference them. The production turn orchestrator still calls `load_llm_history`. Therefore branch-filtering and completed-turn-membership unit coverage does **not** establish those end-to-end feature invariants. This gap was not introduced by the merge and requires focused implementation and production-boundary regression coverage before release. Keep the PR in Draft for this concrete blocker, not for missing screenshots alone.

## Archive-safe assistant integration

Authoritative source: `agent_messages` and `session_journey_memberships` in SQLite. Develop introduced `save_agent_org_assistant_msg_for_turn`, bypassing the Journey-aware generic writer. The integrated path preserves its durable archive/Turn authorization and assigns the exact inserted message's branch/task membership before commit. An error rolls back the transaction; archived Turns cannot append messages or memberships. The existing archived-Turn regression now seeds a Journey task and verifies authoritative membership readback. No historical cleanup was performed.

# Converted Codex project membership

## Producing boundary

A real Claude→Codex conversion resumed correctly under the selected repository but its new native Codex thread had `project_id = NULL`. Ordinary fresh launches resolve `projectId`; conversion registers a thread in `native_materializer::materialize_cli` / `catalog::register_thread`, injects history, then resumes it. Registration omitted project membership and resume correctly preserved that omission.

Registration now calls the existing bounded native `ensure_project` helper with the session repository root, and sends its ID in the creating `thread/start`. The execution cwd remains independent, including worktrees. No repository name/path is hardcoded, no private App UI tables are written, and existing assigned threads are not reassigned during resume. Old unassigned conversions are not bulk migrated.

## Verification

- `CARGO_TARGET_DIR=<shared-target> cargo test --manifest-path src-tauri/Cargo.toml --lib converted_thread_preserves_repository_project_across_resume -- --ignored --nocapture`: passed with a real installed app-server, isolated storage, distinct repository/worktree paths, and two resumes/reopens. No model or network request. An initial sidebar-list assertion was corrected: before a real model turn app-server leaves `has_user_event=0`; the isolated fixture checks authoritative project membership instead.
- `CARGO_TARGET_DIR=<shared-target> cargo test --manifest-path src-tauri/Cargo.toml --lib agent_sessions::cli::`: 457 passed, 5 ignored.
- `CARGO_TARGET_DIR=<shared-target> cargo clippy --manifest-path src-tauri/Cargo.toml --lib -- -D warnings`: passed. Diff check passed; matching signed macOS bundle built.
- Real ORG2 Fable 5.1 source answered 紫杉，41; switch to Astra created a new native UUID and answered 紫杉，42. The native DB row contains the resolved repository project ID; cwd remains the repository.
- Codex App's first-class task APIs opened/read this exact thread. `list_projects` and `list_threads` agree that it belongs to the existing ORGII project, unlike earlier failing conversions listed with null project. Sending a continuation through Codex App returned 紫杉，43 with no tools and no error. The raw thread remains the same UUID. Native CUA refuses automation of Codex itself; these are App task-interface checks, not a claimed visual screenshot/search-latency measurement.
- This acceptance exposed a separate ORG2 refresh issue: converted child writes were absent from the root-only revision probe. That belongs to #1465 and is fixed/tested there, not folded into this project-assignment change. Cloud upload authority is #1488.

## Lifecycle and resource assessment

| Area               | Verdict | Evidence                                             | Change or reason kept                                            | Verification                                     |
| ------------------ | ------- | ---------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------ |
| Background work    | keep    | Existing native registration only                    | No new timer/listener/idle work                                  | Real registration and two resumes                |
| Memory             | keep    | Existing project list limits and RPC client lifetime | No retained project/history cache                                | Isolated app-server lifecycle completes          |
| Scope/isolation    | fix     | Repository root differs from execution worktree      | Resolve inside the target native home; preserve assigned resumes | Distinct roots fixture plus real App project IDs |
| Rendering/hot path | keep    | No React or streaming changes                        | Single creation-time project registration                        | Actual provider continuation                     |

Performance verdict: pass for this bounded creation-time change; no whole-app CPU/RAM or large-catalog latency claim. Existing project discovery is capped at 100 pages and a deadline, and uses its existing idempotent creation key. Registration failure stops conversion rather than creating a knowingly unassigned thread.

| Provider                       | Raw transition                              | App/UI state                        | Topology/boundary            | Expected invariant                                    | Observed evidence                    |
| ------------------------------ | ------------------------------------------- | ----------------------------------- | ---------------------------- | ----------------------------------------------------- | ------------------------------------ |
| Claude Fable 5.1 → Codex Astra | new native UUID with injected prior history | ORG2 model switch                   | local conversion → Codex App | Repository project set at creation; context preserved | 41 → 42, App project list membership |
| Codex Astra                    | resume existing converted UUID              | Codex App task interface            | native App continuation      | Membership and prior context preserved                | 43, same UUID                        |
| Codex app-server               | registration + two resumes                  | isolated native home, no model turn | native catalog               | Worktree cwd does not become project root             | Native DB assertion passes twice     |

Existing null-project histories are preserved; this is prevention at the creating boundary, not a bulk migration. Other native Apps, physical-machine topology, compaction/rotation and UI list refresh delay are not re-certified by this PR. Rollback is reverting the app bundle; no schema/dependency/credential change or destructive cleanup.

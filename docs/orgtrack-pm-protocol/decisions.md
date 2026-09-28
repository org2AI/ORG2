# Phase 0 Frozen Decisions

This file records the frozen Phase 0 decisions. If implementation in Phases 1–8 conflicts with it, either change the implementation or first revise this file with a reason. Silent divergence is not allowed.

## 1. Product mode and resolver precedence

The product mode enum is `build | plan | ask | project`. The sole source of truth is ExecutionContext's `mode` field; shadow booleans such as `tracking_enabled` are prohibited.

Mode resolution has this fixed order:

1. Launch from a WorkItem detail, Routine, or RoutineRun → `project`.
2. The mode explicitly selected by the user in the current Session.
3. An ordinary new Session → `build`.

At the time of this decision, four lists of modes had diverged: Rust `AgentExecMode`, `agent_list_modes` (which returns four entries and has no UI caller), the TS `AGENT_EXEC_MODES` picker, and `MODE_LABELS`. Phase 3 must converge on one source before adding `project`.

Plan mode snapshots the prior mode on entry and restores it on exit (`restore_mode_before_plan_entry`). `Convert to Project` must invalidate that snapshot.

## 2. Mode × capability allowlist

The capability vocabulary has 12 entries (see `common.schema.json#/definitions/capabilityId`): `work.read|create|update|claim|transition|note|relate` and `routine.read|apply|run|cancel|set_enabled`. Reading `context` needs no capability.

| Mode | Allowlist |
| --- | --- |
| build / plan / ask / other exec modes | Empty; `context` only |
| project | All 12 capabilities |

Final capabilities are the intersection of the mode allowlist, actor/org policy, and provider capabilities. Implement this with the existing deny-delta mechanism (“modes never grant tools”): Build, Plan, and similar modes explicitly deny work/routine mutation surfaces; Project adds no such denial. Authorization itself comes only from actor/org policy.

Keep terms distinct. This protocol's `runtimeExecutionMode` maps to existing `AgentExecMode` wire values. Do **not** reuse the Rust type name `ExecutionMode { Direct, WorkStation }`. Qualify `review` in all three domains: exec mode (`AgentExecMode::Review`), agent role (`AgentRole::Review`, the orchestrator state-machine column key), and orchestrator phase (`OrchestratorPhase::Review`).

## 3. Error codes ↔ exit codes

`envelope.schema.json` defines 18 error codes, including `RESULT_SCHEMA_MISMATCH`.

| Exit | Error code |
| --- | --- |
| 0 | Success |
| 2 | INVALID_ARGUMENT / RESULT_SCHEMA_MISMATCH / DEPENDENCY_CYCLE |
| 3 | NOT_FOUND / CONTEXT_REQUIRED / ACTOR_REQUIRED |
| 4 | REVISION_CONFLICT / IDEMPOTENCY_CONFLICT / ALREADY_CLAIMED / ALREADY_EXISTS / NOT_READY / INVALID_TRANSITION |
| 5 | PROJECT_MODE_REQUIRED |
| 6 | PROVIDER_UNAVAILABLE / STORE_UNAVAILABLE |
| 7 | UNSUPPORTED_CAPABILITY |
| 8 | PERMISSION_DENIED / SCOPE_VIOLATION |

`PROJECT_MODE_REQUIRED` (5) means the user must switch mode; `PERMISSION_DENIED` (8) means the actor lacks permission. In a claim race, `ALREADY_CLAIMED` takes precedence over `REVISION_CONFLICT`. The existing `orgtrack check` command's 0/1/2 exit semantics belong to that binary and are unrelated to this table.

## 4. CLI binary and crate names

- The user-facing command is `org2`, provided by a **new, independent console binary**: crate `orgtrack-pm-cli`, cargo bin name `org2-pm` (unique in the workspace), installed or aliased as `org2` in the distribution's PATH.
- The existing GUI binary (cargo package `org2`, with `windows_subsystem = "windows"` in release and no console) carries **no CLI subcommands**.
- The PM protocol DTO crate is named `orgtrack-pm-protocol`. `orgtrack-protocol` is already used by session-provenance wire contracts, so this supersedes the suggested name in design document §19. Later domain/application/store crates also use the `orgtrack-pm-*` prefix.
- The existing `orgtrack` binary for external session-history indexing is unchanged. Delete the `packages/orgtrack` npm stub in Phase 1.

## 5. Provider ID namespace

SessionRef.provider and ProviderBinding.provider use this frozen registry:

- `org2` for every session owned or hosted by ORG2. Internal canonical sources `orgii_rust_agents`, `orgii_cli_sessions`, and `orgii_cloud_replay` all appear externally as `org2`; record the underlying harness in SessionRef.metadata.nativeHarness.
- External providers use importer canonical source IDs: `claude_code`, `codex_app`, `cursor_ide`, `cursor_cli`, `opencode`, `cline`, `copilot`, `kimi`, `qwen_code`, `droid`, `antigravity`, `zcode`, `warp`, `trae`, `qoder`, `windsurf`, and others according to the `orgtrack-core` source registry.
- Short hook names map to canonical IDs and never appear externally: `claude→claude_code`, `codex→codex_app`, `cursor→cursor_ide`, `qwen→qwen_code`; other names map directly.
- Planning provider IDs are `linear` and `github`; existing adapter registry IDs remain unchanged.

## 6. Session lifecycle hook names

Canonical protocol hooks: `session.started`, `session.completed`, `work.claimed`, `work.transitioned`, `routine.invoked`, `routine.completed`, and `artifact.produced`.

Wire the three existing naming schemes in Phase 5 without adding a fourth:

| Existing name | Canonical name |
| --- | --- |
| WS wire `session.completed` / `session.failed` / `session.cancelled` | `session.completed`, with terminal status in the payload |
| Internal Tauri `session-status-changed` | Internal signal that drives canonical hooks; not exposed directly |
| Agent stream `session_start` / `session_end` | `session.started` / `session.completed` |

`session.started` does not currently exist and must be added. By default, `session.completed` only appends a SessionRef. Replace automatic completion rewrites in orchestrator scenarios with an explicit default completion policy through canonical `work.transition`, carrying attempt/session identity.

## 7. Workspace manifest and environment

- The manifest is `.orgii/orgtrack.json`, with minimum shape `{ "version": 1, "scopeId": "...", "orgId": "..." }`.
- `is_initialized(workspace)` means this file exists with a supported `version`. The presence of `.orgii/` alone does **not** mean initialization; git-folder sync and other side effects can create that directory.
- Trusted local resolution order is explicit CLI flags → `ORGII_*` environment → manifest. Frozen variable names are `ORGII_MODE`, `ORGII_ACTOR`, `ORGII_SCOPE`, and `ORGII_SESSION_REF`. Keep the existing `ORGII_` prefix; add no `ORG2_*` variables.

## 8. Cross-process wake (`pm_change_seq`)

- Add the single-row table `pm_change_seq(id INTEGER PRIMARY KEY CHECK(id=1), seq INTEGER NOT NULL)` to `projects.db`.
- Each PM mutation increments `seq` within the same transaction.
- The desktop host reads the sequence through low-frequency polling (or a DB-file watch) and performs incremental reconciliation on change. In-process mutations notify memory directly.
- Readiness, RoutineRun projection, and output binding complete synchronously within the mutation transaction. CLI writes do not depend on a running host.

## 9. List pagination and result shape

- List command data has the fixed shape `{ "items": [...] }`.
- `--cursor <token>` requests the next page. The presence of `meta.nextCursor` means another page exists.
- The cursor is opaque; its implementation may change and its meaning is outside the protocol.

## 10. Claim versus existing locks

- The claim record assumes the local `execution_lock` responsibility for CAS session-execution locking.
- Cloud `orgii_acquire_work_item_lock` remains an **edit lock** for human collaboration. An edit lock and a work claim coexist but do not stand in for each other. The Phase 2a service layer must state that holding an edit lock does not block a claim, and a claim does not grant edit rights.

## Revision history

### 2026-08-07 — S0 conformance convergence (PR #737)

- `execution-context.schema.json`: Add null branches for `scopeId` and `actor`. Bare `org2 context` output may legitimately contain null in an uninitialized workspace; the schema previously contradicted the implementation, which has emitted null since Phase 3.
- Align error fixture text with implementation before byte-golden testing: `actor-required` adds the `<kind:id>` hint; `idempotency-conflict` drops the trailing word “body”; `invalid-transition` uses the generic envelope-mapping phrase; `project-mode-required` changes “WorkItem mutation” to “WorkItem/Routine mutation.”
- Correct the second claim-race branch (active linked session) to `ALREADY_CLAIMED`. It had incorrectly returned `STORE_UNAVAILABLE`, violating the precedence rule in §3.
- Give `ALREADY_EXISTS` a producer: a global existence guard in `work.create`. Cross-scope short-ID collisions now fail structurally instead of silently overwriting data.

### 2026-08-07 — S1 payload-shape decision (PR #737)

- Keep the storage shape of successful `work.*` payloads in this pass: `frontmatter` + `portableState` + `revision`. The blocker is that `work-item.schema.json` requires a persistent `id` matching `^work_[A-Za-z0-9]+$`, while storage still uses a short ID such as `AAA-0001`. Switching now would produce payloads that fail their own schema. Mark the schema and six success fixtures explicitly as the **target shape after ID migration**. The `commands.rs` header is no longer the sole residual status note; this decision is the source of truth.
- Pagination (`--cursor`/`meta.nextCursor`), the portable `--status` vocabulary, `work assign/release`, and the `org2 project` command family (without delete) were implemented and added to conformance coverage.

### 2026-08-07 — PM Case CLI decision (user decision)

Revise the previous “no PM CLI in this pass” item in §4/§9: **the PM Case agent interface uses CLI from the outset**. The `org2 pm` command family carries an independently versioned `org2/pm/v1` contract and lands with PM Case implementation, neither earlier nor as a typed-tool exception.

Reason: the agent surface already converged on `org2-pm` (see agent-cli-unification-design.md §5.6). A unique typed exception for PM tools would break “agent-visible surface = CLI surface,” and early conformance is cheaper than adding it later.

Constraints:

- When `org2 pm` lands, update schemas, fixtures, permission matrix, and entry-point parity tests together. Do **not** silently change `orgtrack/v1`; it has a separate version namespace.
- Verbs not exposed to agents must never enter the CLI: `commit-confirmed-graph` and `promote-standalone-to-project` exist only inside user-confirmation handlers.
- This does not change the scope of the pass recorded here: PM Case and `org2 pm` remained unimplemented. It resolves only the future interface decision.

### 2026-08-07 — S4 typed-tool retirement (PR #737)

Remove `manage_work_item` and `manage_project` from the tool surface: implementation, registration, orchestrator fresh-registry branch, built-in table entries, and capability seeds. The agent's sole entry point becomes `org2-pm`. Retire the product-mode deny-delta tool layer (`product_mode_layer`/`with_modes`) at the same time; gating converges at the CLI application boundary through `ORGII_MODE` and `require_project_mode`.

Supporting decisions:

- Add tool names to `SUBAGENT_RETIRED_TOOL_ALIASES` to defend old checkpoints. Keep constants for historical transcript rendering; do not remove the frontend rendering path, as with `manage_story`.
- Expose standalone work items (without a project) through `work show/update/create --standalone`. Inject org context through the `ORGII_ORG` environment variable and the session marker's `org` field. Add `--schedule-cron`/`--schedule-at` for recurring tasks.
- Resolve subagent CLI identity to the **top-level ancestor session**. The workspace marker binds the owner and the environment must agree; otherwise workers sharing a workspace are rejected as impersonators. Subagent session records inherit parent `product_mode`.
- Restrict `debug_session_execute_tool` to `read_file`. Remove two E2E scenarios that invoked typed tools through the debug hook; cross-process E2E for `orgtrack-pm-cli` covers the agent surface.

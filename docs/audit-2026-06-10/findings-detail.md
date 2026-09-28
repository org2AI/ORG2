# Detailed Findings — 2026-06-10

Grouped by severity: Critical → High → Medium → Low / Info.
Each finding includes its location, issue, suggested fix, sweep status, and corresponding anti-pattern.

---

## CRITICAL

### F-CRIT-1 — UI calls transport directly, bypassing the FSM

- **Location**:
  - `src/scaffold/GlobalSpotlight/palettes/AgentControlPalette/useAgentControlPalette.ts:115` — `invokeTauri("agent_send_message", { sessionId, content, … })`
  - `src/engines/ChatPanel/ChatItems/AgentErrorChatItem.tsx:114` — direct call to `SessionService.sendMessage({ sessionId, content: "", isResume: true, … })` (resume button)
- **Issue**: `beginTurnDispatch / markTurnTerminal` in the FSM are the only generation sources, via `useMessageDispatch.dispatchMessageBySessionType` and `useQueueDispatch.dispatchMessage`. These two direct calls skip `beginTurnDispatch`, causing subsequent turn-end signals to have a mismatched generation → the queue may incorrectly report idle while work is still in progress, or a terminal signal from an old turn may contaminate a new turn.
- **Fix**: Route the spotlight palette path through `useMessageDispatch`; change the AgentErrorChatItem resume path to use `useMessageDispatch`, or wrap it with separate calls to `beginTurnDispatch` + `markTurnRunning`.
- **Sweep**: There are 11 `SessionService.sendMessage` call sites; each was checked individually. The other 9 are inside dispatch hooks / already go through the FSM.
- **Anti-pattern**: #21 / #53.

### F-CRIT-2 — Entire `src/coding_agent/` module tree is orphaned

- **Location**: `src-tauri/src/coding_agent/{mod.rs, commands.rs, config.rs, context.rs, modes.rs, permission.rs, persistence.rs, processor.rs, question.rs, tools.rs}`
- **Issue**:
  1. `lib.rs:69-73` has no `pub mod coding_agent;`
  2. There are 0 references in `handler_list.inc`
  3. Contains broken imports: `use crate::agent_core::compaction::CompactionState` (line 33), `use crate::agent_core::mcp::McpManager` (line 34), and `crate::osagent::providers::create_provider` (line 180) — none resolve
  4. Contains 10+ dead `#[tauri::command]` functions
- **Fix**: Check `git log src/coding_agent/` to confirm whether it was superseded by `agent_core::state::commands::session::`, then delete the entire tree with `rm -rf`.
- **Sweep**: `grep` for `coding_agent::` outside `src-tauri/` = 0 hits ✅.
- **Anti-pattern**: #29 + #43.

### F-CRIT-3 — `holdSessionQueueForStopAtom` is a shadow boolean for the FSM `stopping` phase

- **Location**:
  - `src/store/ui/messageQueueAtom.ts:139, 151`
  - `src/engines/SessionCore/control/sessionTimelineBoundary.ts:20, 132`
- **Issue**: The FSM already has a `stopping` phase to represent “the user clicked Stop; waiting for the terminal signal.” `holdSessionQueueForStopAtom` is a parallel boolean written inside `beginTimelineBoundary`. The two must stay synchronized; otherwise one can report idle while the other reports hold → queue flushes can be delayed or dispatches repeated.
- **Fix**: Delete `holdSessionQueueForStopAtom`; read `getTurnPhase() === "stopping"` instead. Alternatively, incorporate the semantics of “do not auto-flush after Stop, even if idle” into a new FSM phase (such as `idle-after-stop`).
- **Sweep**: `grep` for `holdSessionQueueForStop` = 6 hits (including tests + 2 implementations + 1 timeline boundary).
- **Anti-pattern**: #19 / #51.

### F-CRIT-4 — Four `SessionStatus` definitions coexist

- **Location**:
  - FE `src/types/session/session.ts:28` (16 variants, including cloud-only `queued / in_progress / error / killed`)
  - Rust `agent-core::session::SessionStatus` (`enums.rs:27`, 12 variants)
  - Rust `agent_sessions::cli::SessionStatus` (`cli/types.rs:18`, 6 variants)
  - Rust DB `AgentSessionStatus` (5 variants)
- **Issue**: See the table in cross-layer-audit.md. On the Rust side, `abandoned / timeout / paused / waiting_for_user` are not recognized by the CLI adapter's `cli/types.rs::SessionStatus::parse` → silently dropped on the wire; `cliAdapter.ts` then uses the superset `CliSessionStatus` to add them back.
- **Fix**:
  1. Use a single Rust source: `agent-core::session::SessionStatus`
  2. Have the CLI side pass values through with `From<agent_core::SessionStatus>` instead of defining its own type
  3. Keep enum strings in the DB column, but reuse the agent-core parser during deserialization
  4. Generate the FE enum from Rust → TS
- **Sweep**: 5 duplicate literal definitions in the FE.
- **Anti-pattern**: #4 / #30.

### F-CRIT-5 — Nested sub-agent UI regex does not match Rust prefixes at all

- **Location**:
  - FE `src/engines/SessionCore/sync/adapters/shared/subagentTracking.ts:38` — `SPAWNED_SESSION_RE = /(?:agentsession|subagent)-[a-f0-9-]+/`
  - Rust `crates/types/src/session.rs:26` — `SUBAGENT_SESSION_PREFIX = "agent-"`; `crates/types/src/session.rs:32` — `SHADOW_SESSION_PREFIX = "shadow-"`
- **Issue**: The regex requires a prefix of `agentsession-` or `subagent-`; Rust actually produces `agent-…` / `shadow-…`. The string literals do not overlap → `subagentTracking.ts` can never recognize sub-agents, breaking the nested UI chain.
- **Fix**: Either change the regex to `/(?:agent|shadow|sde|os|cli)agent?-…/` (covering all prefixes), or change the Rust prefixes (a larger change). The memory file `workspace_subagent_ui_visibility_regex.md` previously called this regex “the only bridge”; that bridge is currently broken.
- **Sweep**: `SPAWNED_SESSION_RE` is used in 6 files (`subagentTracking.ts` + `rustAgent` eventHandlers).
- **Anti-pattern**: #1 / #38.

### F-CRIT-6 — Asymmetric async fallback in `resolveFilePayload.ts` (OPEN bug)

- **Location**: `src/modules/WorkStation/CodeEditor/SessionReplay/resolveFilePayload.ts:49, 64, 76`
- **Issue**: Recorded in memory file `workspace_sessionreplay_file_blank.md`; `[file-blank]` TEMP DIAG is still running while waiting for the user to reproduce the issue. After clicking FILES READ, CodePanel reaches the `content === undefined` branch.
- **Fix**: See memory; after inline `op.content` is stripped by deduplication, add a fallback to the `convertToFileOperation(op.event)` extraction branch.
- **Anti-pattern**: #10.

### F-CRIT-7 — One `unwrap_or_default` at `src-tauri/src/lib.rs:892` can delete every user's file history

- **Location**: `src-tauri/src/lib.rs:892`
- **Issue**: If decoding any row from `SELECT session_id FROM agent_sessions` fails, `unwrap_or_default()` returns an empty `Vec<String>` → `agent_core::tools::file_history::prune_orphan_sessions(&[])` treats every session as orphaned and deletes it.
- **Fix**:

```rust
let live = match query(…).await {
    Ok(v) => v,
    Err(e) => {
        tracing::warn!("failed to load live sessions for prune, skipping: {e:#}");
        return; // skip pruning
    }
};
```

- **Anti-pattern**: #6 / #33.

### F-CRIT-8 — TEMP DIAG residue across 5 files, 25 lines

- **Location**:
  - `src/components/ComposerInput/imperativeApi.ts:106-120` — contains `console.trace`, triggered on every ComposerInput.setContent / clear (**performance cost**)
  - `src/engines/ChatPanel/hooks/useInputArea/index.ts:359, 366, 380, 397, 408` — `[draft-bug]` ×5
  - `src/engines/ChatPanel/InputArea/components/ModePill.tsx:141, 142` — `[draft-bug]`
  - `src/modules/shared/layouts/AppLayout.tsx:206, 219` — `[ws-blank-diag]`
  - `src/modules/WorkStation/CodeEditor/SessionReplay/resolveFilePayload.ts:49, 64, 76, 85` — `[file-blank]`
- **Issue**: Three OPEN bugs are still waiting for reproduction logs from the user (memory files `workspace_mode_switch_clears_draft.md`, `workspace_workstation_toggle_right_blank.md`, `workspace_sessionreplay_file_blank.md`). `feedback_audit_before_commit.md` records that a previous audit session accidentally committed these once.
- **Fix**: Keep `console.warn` and delete `console.trace`, or gate all of them behind a `window.__orgiiDiag` flag.
- **Sweep**: `grep` for `\[draft-bug\]|\[ws-blank-diag\]|\[file-blank\]|TEMP DIAG` = 25 lines.

---

## HIGH

### F-HIGH-1 — `launch_cli_agent` silently drops 7 fields

See cross-layer-audit.md. `launch.rs:265-309`. Fix: reject the combination or pass through all 7 fields.

### F-HIGH-2 — `userInitiatedCancelAtom` combines multiple concerns

- **Location**: `src/store/session/cliSessionStatusAtom.ts:174-175`
- **Issue**: The comment explicitly says it handles (1) distinguishing the “user clicked Stop” signal from Rust failure; (2) triggering input restoration; and (3) being cleared on force-send through `useQueueDispatch.ts:193`. Each concern should have its own atom (anti-pattern #54).
- **Fix**:
  - `postStopDispatchEpisodeAtom`: only “the next submit is an explicit post-Stop dispatch”
  - `stopDraftRestorationPendingAtom`: only “the input restoration window is open”
  - Give each concern its own writer / clearer
- **Sweep**: `grep` for `userInitiatedCancelAtom` = 5 files, 8 occurrences.
- **Anti-pattern**: #22 / #54.

### F-HIGH-3 — BE `CancelReason` validation is permissive

- **Location**: `src-tauri/src/agent_sessions/cli/commands.rs:498-500`
- **Issue**: `cli_agent_cancel(session_id, reason: Option<CancelReason>)` — an unknown reason deserializes to `None`. Memory already warned about this, but it still coerces to `None` rather than explicitly rejecting it.
- **Fix**: Implement custom deserialization; return `Err("unknown cancel reason: …")` for an unknown reason.
- **Anti-pattern**: #11.

### F-HIGH-4 — 10+ unregistered Tauri commands in `benchmark.rs`

See be-audit.md.

### F-HIGH-5 — Two same-crate struct definitions in the `advanced-search` crate

See naming-collisions.md.

### F-HIGH-6 — Three `ApiError` definitions

See naming-collisions.md.

### F-HIGH-7 — Same-name `ProviderConfig` types with different meanings across crates

See naming-collisions.md.

### F-HIGH-8 — 177 production `unwrap()` calls

- **Sweep**: `grep -rE "^\s*\.unwrap\(\)" src-tauri/src src-tauri/crates/agent-core/src --include="*.rs" | grep -v test | wc -l` = 177.
- **Fix**: Clean these up in batches; prioritize explicit assumptions with `expect("…")`; return `Result` from hot paths.
- **Anti-pattern**: #33.

### F-HIGH-9 — Seven reachable poisoned-mutex / resolver-init `.expect()` calls

- **Location**:
  - 4 `.expect("agent metadata resolver initialized")` calls in `src-tauri/src/agent_sessions/unified_stats/aggregation.rs`
  - `.expect("WatchHandlesState mutex poisoned")` at `src-tauri/src/cursor_ide_watch.rs:82, 128, 146`
- **Issue**: If the IoC slot is not populated or another thread poisons the mutex by panicking, the entire app exits. Anti-pattern #33 applies directly.
- **Fix**: Use `lock().unwrap_or_else(|p| p.into_inner())` or return `Err` for the caller to handle.

### F-HIGH-10 — `_ => None` in `extractors.rs:341` swallows new enum variants

See be-audit.md. **Sweep**: This file has 6 `_ =>` arms (lines 72, 341, 929, 1143, 1491, 1558); all need to be made exhaustive.

### F-HIGH-11 — Eight dispatch sites concentrated in `useWorkspaceChat.ts`

- **Location**: `src/engines/ChatPanel/hooks/useWorkspaceChat/useWorkspaceChat.ts:198, 386, 401, 418, 432, 445, 460, 503`
- **Issue**: One hook calls `dispatchMessageBySessionType` in 8 places; it is hard to trace the 1-to-1 relationship between user action → dispatch.
- **Fix**: Consolidate into one dispatcher and explicitly tag the source (`"submit"` / `"queue-flush"` / `"interactive-event"` / `"next-step-event"`, etc.).
- **Anti-pattern**: #21.

### F-HIGH-12 — Industrial-scale schema residue from Anti-pattern #43

See cross-layer-audit.md. The pre-user-stage schema can be cleaned up into a canonical CREATE TABLE.

---

## MEDIUM

### F-MED-1 — Multiple sources write to `setSessionRuntimeStatusAtom`

- **Location**: `src/store/session/cliSessionStatusAtom.ts:37-46`
- **Issue**: The `source` field has 10 values (`dispatch / queue / sync / timeline-boundary / planning / launch / interactive-event / repo-setup / session-reset / e2e`), but the setter does not enforce the source; it is only used for tracing. This is a boundary case for anti-patterns #20 / #52 — it has not gotten out of control yet.
- **Fix**: Make status a derived value from the FSM phase (`getTurnPhase() → "idle" | "running" | …`) and delete the setter.

### F-MED-2 — Six misplaced items in the `engines/ChatPanel/` root

See fe-audit.md F-MED-2.

### F-MED-3 — No glossary for overloaded terms

See naming-collisions.md. Recommend adding `glossary.md` under `docs/`, listing each overloaded term with its meaning, recommended usage, and current locations.

### F-MED-4 — Five duplicate status / mode definitions in the FE

See cross-layer-audit.md & naming-collisions.md. Recommend adding a `core-types/wire` generation step.

### F-MED-5 — `cli_agent_resume` is missing `ensure_cli_account_key_fresh`

See cross-layer-audit.md & be-audit.md.

### F-MED-6 — 13 `dangerouslySetInnerHTML` sites need a sanitizer audit

- High risk (LLM / external content): `engines/ChatPanel/blocks/primitives/BlockOutput.tsx:314`, `a2uiElements.tsx:9, 108`, `MermaidBlock.tsx:512, 589`, `GitHubDiff/DiffRow.tsx:110, 186, 210`, `DocxPreview/index.tsx:94`, `PagesPreview/index.tsx:120`
- Low risk (internally generated): `useShikiHighlight.ts:132` (generated by tokenizer), `TerminalCommand.tsx:110`, `ShellCssOutput.tsx:107`, `CopilotSessionSetup/index.tsx:343`
- **Fix**: Add DOMPurify or an equivalent sanitizer at each high-risk site, and document the sanitization invariant in the file header.

### F-MED-7 — Files exceed the size limit

- FE: `cliAdapter.ts` 1000, `ChatHistory/index.tsx` 909, `EditorMainPane/index.tsx` 917, `CreateWorkItemView/index.tsx` 903, `Diff/SessionReplay/index.tsx` 902, `SessionCreator/variants/ChatPanel/index.tsx` 872, `BenchmarkPanel/index.tsx` 845, `CanvasApp.tsx` 793, `ComposerInput/index.tsx` 739, `spotlightActionDefinitions.ts` 737, `Tooltip/index.tsx` 732, `GitDiffContent/index.tsx` 723, `MessageReferenceCards.tsx` 710
- BE: `cursor_native/provider.rs` **3220**, `e2e-test/agent_org.rs` 3167, `cli/session_runner/session.rs` 2838, `benchmark.rs` 2746, `api/agent/test/agent_org.rs` 2744, `inbox_drain/mod.rs` 2330, `agent_org_runs.rs` 2260, `prompt/sections.rs` 2153, `e2e-test/harness.rs` 2067, `agent_org_tasks_and_exec_mode.rs` 2056, `agent_org_tasks.rs` 2003, `projects/commands/sync.rs` 1964, `dev-record/cursor_db_history.rs` 1854, `api/agent/test/sde.rs` 1811
- **Fix**: Split each file into separate modules; splitting is not mandatory within this audit's scope.

### F-MED-8 — 11 leaked variant literals in `agent-core`

See layer 6 of be-audit.md.

---

## LOW / INFO

| ID       | Title                                                                 | Location                                                                                  | Notes                                                                 |
| -------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| F-LOW-1  | Ghost `EnvFilter` in `osagent`                                        | `src-tauri/src/lib.rs:476`                                                                | Can be removed along with F-CRIT-2 cleanup                            |
| F-LOW-2  | `MessageReferenceCards` test drift                                    | `src/engines/ChatPanel/blocks/__tests__/MessageReferenceCards.test.ts`                    | Memory `workspace_message_reference_cards_drift.md`; confirm with vitest |
| F-LOW-3  | 7 bare localStorage keys                                              | `themeInit`, `timezone`, `oauthRedirect_*`, etc.                                          | Some are conventional; OK                                             |
| F-LOW-4  | 88 TS TODO / FIXME / HACK comments                                    | Scattered                                                                                | Most are intentional markers                                          |
| F-LOW-5  | 37 Rust TODO comments                                                 | Scattered                                                                                | Same as above                                                         |
| F-LOW-6  | Incomplete cargo-machete allow-list                                   | `src-tauri/Cargo.toml:170-171`                                                            | Only 3/18 macro-only crates are in the allow-list                     |
| F-LOW-7  | Three cancel mechanisms coexist                                       | `coding_agent::cancel_flags` (dead), `agent_session_cancel` (live), `CancellationToken`   | Confusing for newcomers; after F-CRIT-2 dead-code cleanup, 2 remain   |
| F-LOW-8  | Four modules follow the same `*_bridge` naming pattern                | `agent_sessions::cli::agent_core_bridge`, etc.                                            | Consistent pattern; OK                                                |
| F-LOW-9  | Three `@ts-expect-error` directives concentrated in `eventPayload.ts` | `eventPayload.ts:63, 259, 355`                                                            | Locally manageable                                                    |
| F-INFO-1 | No compile-time duplicate-name check for Tauri command registration    | `handler_list.inc`                                                                        | Could add a build-script lint diff                                    |
| F-INFO-2 | No PR CI                                                               | `.github/workflows/` contains only `release.yaml`                                         | Basic CI would catch F-CRIT-2 / F-HIGH-4 / F-CRIT-7                   |
| F-INFO-3 | `infrastructure/housekeeping.rs:218-226` drops 7 legacy KG tables on every startup | `infrastructure/housekeeping.rs:218-226`                                  | Anti-pattern #43; should be a one-time migration version              |

# Cross-Layer Duplication Findings (Frontend and Backend)

> Cross-layer duplication: the frontend and backend each implement the same concept, or share hard-coded literals without a canonical source.

## 1. AgentExecMode strings: picker subset vs wire union

Recorded in memory file `workspace_agent_exec_mode_display_wire_split.md`:

- The frontend picker `AGENT_EXEC_MODES` (build/plan/investigate-as-"Ask") has only 3 entries.
- The frontend wire union `ALL_AGENT_EXEC_MODES` still includes legacy modes such as debug / review / wingman.
- The backend enum is in `src-tauri/crates/agent-core/src/core/...` (exact location not identified).

**Risk**: Modes unavailable in the frontend UI may still appear on the wire, with string comparisons scattered throughout the code.

**Action**: Establish a single canonical source in Phase 6:

- The backend enum `AgentExecMode` + `as_str()` is the single source of truth.
- Generate the frontend `ALL_AGENT_EXEC_MODES` or keep it explicitly synchronized. **Do not** hard-code string literals such as `mode === "wingman"` in UI files.

Unfinished subtask: grep for frontend occurrences of `mode === "<specific string>"` to find hard-coded values.

## 2. Tauri command strings: ~915 hard-coded occurrences

`src-tauri/src/commands/handler_list.inc` lists ~915 `module::path::fn_name` entries. The frontend calls them with `invoke("<command_name>", ...)`, using **hard-coded strings**.

**Current state**: No canonical typed wrapper layer was found; every `invoke()` call uses a bare string.

**ROI**: Low (frontend usage of each command is limited, and TypeScript has no equivalent type-checking tool).
**Action**: Add to follow-up work; exclude from Phases 2–8.

## 3. Scattered mode / tab key / model strings

Deep scan incomplete. Before Phase 6, grep for:

- `mode: "<...>"` / `mode === "<...>"`
- `tab: "<...>"` / `tabKey === "<...>"`
- `model: "<...>"` (including OpenAI / Anthropic / Google model IDs)

Scattered hard-coded values are expected; each should have a canonical const source.

## 4. Duplicate maxHeight values across chat input surfaces

Memory file `workspace_chat_input_surfaces_matrix.md` records 4 independent implementations:

- `src/features/SessionCreator/EditorArea.tsx` —— ternary `isChatPanel ? 140 : 300`
- `src/engines/ChatPanel/InputArea/ComposerInput.tsx`
- `src/components/UserChatItem`
- `src/engines/ChatPanel/blocks/AgentMessageBlock`

**Risk**: Each "input grew too tall" bug requires checking all 4 locations.

**Assessment**: 🟡 Moderate consolidation effort. A `useChatInputMaxHeight(variant)` hook or layout primitive could help. However, the maxHeight values differ by context (compact vs full), so unifying them may not be appropriate.

**Action**: Phase 6, step 2. First list the current values in all 4 locations; **user decision** on whether to consolidate.

## 5. Context-pill prefix list

Memory file `workspace_composer_pill_context_prefix_extension.md` records `CONTEXT_PILL_PREFIXES` (frontend const) + `PillIconType` + `pasteHandlers.ts`.

**Current state**: A canonical source already exists (one const + one paste-handler branch table). ✅ No duplication.

Do not include in Phase 6.

## 6. `Local` / `Remote` naming in the sync module

In backend `src-tauri/crates/.../sync/`:

- `AppliedSide` uses `Local` / `Remote`
- `ConflictResolution` (adapter) uses `KeepLocal` / `UseRemote`
- `ConflictResolution` (conflict_log) uses `UseLocal` / `UseRemote`

**Risk**: `Keep*` and `Use*` are inconsistent when reading across enums. The user choices "keep local" and "use local" are nearly synonymous in the UI but differ on the wire.

**Action**: In Phase 6, align the backend enum variant naming with frontend UI labels (if there are "keep local" / "use local" buttons).

## 7. Cross-layer tab systems

Memory file `workspace_tab_systems_inventory.md` lists 8 tab systems.

- Does the backend have its own session tab / replay tab concepts? Not investigated in depth.
- Does each of the 8 frontend tab implementations have its own `Tab` interface? Not investigated in depth.

**Action**: Revisit cross-layer behavior after consolidating the duplicate tab systems (frontend §4).

## OPEN questions

1. **Scope of hard-coded mode string cleanup**: clean up the frontend only, or reconcile the frontend and backend enums / `as_str()` together?
2. **Hard-coded `invoke()` command-name strings**: is a code-generated wrapper layer worthwhile, or should we accept the current state of "~915 strings"?
3. **Four maxHeight values across chat input surfaces**: consolidate them? Can the values be abstracted if they differ by variant?

---

**Audit scope statement**: This file synthesizes findings from the main context, two subagents, and the memory index. Specific grep results were not deeply investigated (to avoid duplicating the frontend/backend reports). Before Phase 6, first grep for hard-coded strings and list their current values.

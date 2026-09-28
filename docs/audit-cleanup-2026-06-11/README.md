# ORGII Dead Code and Duplicate Implementation Audit (2026-06-11)

> Results of a repository-wide read-only audit. No source code was changed; findings are recorded by category. Cleanup is planned in phases starting with Phase 2.
>
> **Audit scope**: `src/` (frontend TS / React) + `src-tauri/` (backend Rust + Tauri command registration).
> Excluded: `packages/`, `mobile-pwa/`, `build/`, `node_modules/`, `target/`, `gen/`, `docs/`.

## TL;DR

Top five, ordered by "high ROI, low risk, no behavior changes":

1. **Backend `IntegrationsConfig` spans domains** (embedding + excluded_skills + Smithery key + channels + databases in one struct)—anti-pattern #31. Fix: split into 3–4 structs.
2. **The frontend has 14 `dispatchMessageBySessionType` calls across 4 files** (`useWorkspaceChat.ts` 6, `useMessageDispatch.ts` 2, `useEditUserMessage.ts` 3, `next-step/index.tsx` 3)—anti-patterns #21/#36/#53. Fix: establish one dispatcher and route all UI sends through the intent → queue state machine.
3. **Fourteen frontend `src/services/**Service.ts` files have unused `export default` exports** (all callers use named imports)—remove the `export default` keywords.
4. **Backend `ProviderConfig` name collision** (`key-vault` environment-variable descriptor vs `agent-core` LLM connection parameters, with no overlapping fields)—anti-pattern #30. Fix: rename to `KeyVaultProviderConfig` and `LlmConnectionConfig`.
5. **Backend `ConflictResolution` name collision within the same crate** (`sync/adapter.rs` resolver decision vs `sync/conflict_log.rs` user UI choice)—anti-pattern #30. Fix: use `AdapterResolverVerdict` and `UserConflictChoice`.

## Baseline drift

**Memory file `workspace_dead_code_scan_landscape.md` (written 2026-06-08) is partly stale.** This audit rechecked it with ripgrep:

| Candidate from memory                                    | Current state                                             | Review result                              |
| ---------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------- |
| `src/util/monitoring/apiTracker.ts` + `apiTrackerUtils.ts` | Files no longer exist                                      | `[stale → closed]`                         |
| `src/util/core/storage/localStorage.ts`                    | Referenced by `src/app/root/useAppDeferredInitialization.ts:26` | `[stale → ALIVE]` do not delete       |
| `src/util/core/init/deferredInit.ts`                       | Referenced by `src/app/root/useFirstPaintSignal.ts:21`     | `[stale → ALIVE]` do not delete             |
| `src/util/platform/tauri/gitBundle.ts`                     | 0 references (none of three patterns matched)             | `[confirmed dead]` removable                |
| `src/util/dialogs/gitActionDialog.ts`                      | 12 references                                             | `[stale → ALIVE]` do not delete             |
| `src/util/dialogs/channelActionDialog.ts`                  | 1 reference                                               | `[stale → ALIVE]` do not delete             |
| `src/util/dialogs/gitAuthenticationDialog.tsx`             | 1 reference                                               | `[stale → ALIVE]` do not delete             |
| ~14 `src/services/**` files with unused `export default`  | All 14 still qualify (no `import X from`)                 | `[confirmed]` remove `default`, keep named exports |

**Memory file `workspace_force_send_queue_dispatch.md` (2026-06-10) is also partly stale**:

- It says `` `holdSessionQueueForStopAtom` / `forceSendPendingQueueAtom` / `markQueueTurnSettled` are GONE``—incorrect. In fact:
  - `holdSessionQueueForStopAtom` remains in `src/store/ui/messageQueueAtom.ts:164` and `sessionTimelineBoundary.ts:20/132`, with four test references. This is the "shadow boolean shadowing FSM phase" described by anti-pattern #51.
  - `forceSendPendingQueueAtom` is now referenced only by the e2e helper `inspectChatState.ts:147`; it has indeed been removed from production paths.
  - `userInitiatedCancelAtom` remains in several places, including `cliSessionStatusAtom.ts`, `sessionTimelineBoundary.ts`, and `useQueueDispatch.ts`; the "multi-purpose cancel atom" from anti-pattern #54 has not yet been split.

## Execution status (updated 2026-06-11 21:30)

### ✅ Completed

- **Phase 1** — Filed the audit reports (four Markdown files in this directory).
- **Phase 2** — Removed zero-risk items:
  - Deleted `src/util/platform/tauri/gitBundle.ts` (confirmed zero references).
  - Deleted `src/util/dialogs/openLinkDialog.ts` (confirmed zero references).
  - Removed `export default` from 14 `src/services/**Service.ts` files (kept named exports; all callers use named imports).
  - **Verification**: `pnpm tsc --noEmit` reported 109 errors, matching the Phase 1 baseline. All were pre-existing `LegacyRef` errors; no new errors were introduced.
- **Phase 3** — Moved files out of the ChatPanel engine:
  - Used `git mv` to move eight files to `src/engines/ChatPanel/panels/`: ProjectPanelView / WorkItemPanelView / Workspace{Dashboard,Explore,Overview}PanelView / BenchmarkRunBuilder / LinkSessionToWorkItemModal / useBenchmarkSessionCreatorSlots.
  - Updated imports in ChatPanelContent.tsx (five locations), ChatPanelEmptyContent.tsx, index.tsx, hooks/useChatPanelSessionModals.tsx, and panels/WorkItemPanelView.tsx (`./ChatView` → `../ChatView`).
  - **Verification**: `pnpm tsc --noEmit` still reported 109 errors; no new errors were introduced.
- **Phase 4** — Reassessed backend dead code:
  - The three `#[tauri::command]` items at `src/api/agent/mod.rs:14/21/26` are actually `#[cfg(not(debug_assertions))]` release stubs called by e2e helpers (`projects.ts:240/287`)—**they are not dead commands**. However, `handler_list.inc` does not register the release stubs, so a release build would return "command not found" instead of "only in debug build." This potential release/debug behavior mismatch is a follow-up bug, not a cleanup target.
  - The two `.expect("string serializes")` calls in `cursor-bridge/src/models.rs:257/258` are defensive code: JSON string serialization cannot fail. **Keep them.**
  - **No source changes in this phase.**

### ⛔ Paused: Phases 5–8 require baseline e2e first (do not proceed blindly)

**Reason**: These four phases involve real semantic or wire changes, and memory repeatedly warns that "removing the wrong thing can drop the first message after Stop" and "background-path changes need e2e verification." Proceeding without baseline queue, send, and reflection e2e could break existing behavior and violate the "no behavior changes" constraint.

| Phase                                       | Change                                             | Required first steps                                                                              |
| ------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Phase 5: split `IntegrationsConfig` | Change wire JSON shape + add migration | Run baseline reflection + active_learning + consolidation e2e; define migration strategy (overwrite vs multi-source fallback) |
| Phase 5: `skills_lookup` helper | CLI session runner no longer requires sde `selected_model_id` | Run baseline sde session-launch e2e, including the skills-resolution path |
| Phase 6: rename two `ProviderConfig` types | Update frontend Zod schema | Find all frontend `invoke()` calls to commands involving `ProviderConfig`; update Zod in the same PR |
| Phase 6: rename two `ConflictResolution` types | Rename sync wire protocol fields | Run baseline sync conflict-resolution e2e |
| Phase 6: align `TantivyIndexInfo` field types | Wire schema `u64` vs `usize` | Run semantic-search e2e with the feature flag both on and off |
| Phase 7: remove `holdSessionQueueForStopAtom` | Queue-dispatch semantics | Run baseline `messageQueueAtom.test.ts` and manual Stop → immediately resend one message e2e |
| Phase 7: split `userInitiatedCancelAtom` | Separate post-Stop dispatch and draft-restoration semantics | Same as above, plus manual draft-restoration verification |
| Phase 8: unify `dispatchMessageBySessionType` | Concentrate 14 call sites into one | Run baseline e2e for next-step, edit-user-message, and useWorkspaceChat |

**Action**: Decide on the delivery cadence (one large PR or one PR per phase with e2e) and whether to create a separate plan for Phases 5–8. This audit records all findings, recommendations, and risks in four Markdown files; each phase can be started independently.

### General

- [ ] `pnpm tsc --noEmit` reports 0 errors (check after each phase).
- [ ] `cargo check -p <crate_underscore_name>` reports 0 errors for each affected crate.
- [ ] Before deleting or renaming, confirm zero references with all three ripgrep patterns: `from ['"].*<basename>['"]`, `import\(.*<basename>`, and `['"].*\/<basename>['"]`; also search `*.rs`, `tests/`, `scripts/`, and `mobile-pwa/`.
- [ ] Create no new files except audit reports or files containing the target split structs.

### Phase 2 (frontend dead code)

- [ ] Delete `src/util/platform/tauri/gitBundle.ts` and `src/util/dialogs/openLinkDialog.ts`.
- [ ] Remove `export default` from 14 `src/services/**Service.ts` files (keep all named exports).
- [ ] `pnpm check:unused-exports` reports fewer than 862 modules.

### Phase 3 (move files out of the ChatPanel engine)

- [ ] Keep only chat files in the `src/engines/ChatPanel/` root (see `frontend-findings.md` §3).
- [ ] Use `git mv`; move one PanelView at a time and update all import paths in the same PR.

### Phase 4 (backend dead code)

- [ ] Remove the dead string-serialization `.expect` near `cursor-bridge/src/routing.rs:61` if confirmed to be a dead path.
- [ ] Check whether the three `#[tauri::command]` items at `src/api/agent/mod.rs:14/21/26` are unregistered; delete them if they are dead commands.
- [ ] Sample and verify the two unchecked `.expect()` calls at `cursor-bridge/src/models.rs:257/258`.

### Phase 5 (split backend config domains and decouple the resolver)

- [ ] Split `IntegrationsConfig` into `EmbeddingConfig` (global) + `ExcludedSkillsConfig` (global) + `McpSmitheryConfig` (key-vault) + `ChannelsConfig` + `DatabasesConfig`; keep `IntegrationsConfig` as a facade (migration writes the new JSON fields).
- [ ] Change `resolve_sde_skills` at `src/agent_sessions/cli/session_runner/session.rs:1680` to use a new `skills_lookup::resolve_skills_for(agent_id)` helper instead of the full `ResolvedAgent::resolve()`.
- [ ] After grepping `ResolvedAgent::resolve`, only foreground session-startup paths and tests should remain.

### Phase 6 (rename colliding types)

- [ ] Split `ProviderConfig` into `KeyVaultProviderConfig` + `LlmConnectionConfig`.
- [ ] Split `ConflictResolution` into `AdapterResolverVerdict` + `UserConflictChoice`.
- [ ] Align fields between the `TantivyIndexInfo` stub and real type (`index_size_bytes` should be `u64` in both).

### Phase 7 (queue/cancel semantics cleanup — anti-patterns #51/#54)

- [ ] Remove `holdSessionQueueForStopAtom` and let the FSM `stopping` phase replace it.
- [ ] Split `userInitiatedCancelAtom` into `postStopDispatchEpisodeAtom` (intent) + `stopDraftRestorationPendingAtom` (draft window), with a single writer for each atom.

### Phase 8 (unify send paths — anti-patterns #21/#36/#53)

- [ ] UI components no longer call `dispatchMessageBySessionType` directly; route all sends through the single dispatcher in `useMessageDispatch`.
- [ ] After grepping `dispatchMessageBySessionType`, only `useMessageDispatch.ts` should remain.

## File index

- [`frontend-findings.md`](./frontend-findings.md) — Frontend dead code and duplicate implementations (TS / React / atoms)
- [`backend-findings.md`](./backend-findings.md) — Backend dead code and duplicate implementations (Rust / Tauri commands)
- [`cross-layer-findings.md`](./cross-layer-findings.md) — Cross-layer duplication (work performed by both frontend and backend)

## Out of scope

- Leave `src/hooks/workStation/browser/useOpenUrlInBrowser.ts` and `src/modules/WorkStation/.../DomComponentPreviewContent/index.tsx` untouched (the user's other in-flight dirty work).
- Leave `packages/` and `mobile-pwa/` untouched (not part of the desktop build; see memory file `workspace_packages_and_mobile_split.md`).
- Leave `docs/shared/cla-process--0602.md` untouched (referenced by a Rust string literal).
- Do not add `knip`, `madge`, or `depcheck` (not installed in the repository).
- Do not delete `build/` (already in `.gitignore`).

## Audit confidence

| Dimension                      | Confidence | Notes                                               |
| ------------------------------ | -------- | ---------------------------------------------------- |
| Frontend dead modules / dead exports | High | All three ripgrep patterns checked |
| Misplaced files in ChatPanel engine | High | Listed directly with `list_dir` |
| Duplicated frontend send paths | High | grep found 14 locations |
| Frontend atoms with multiple sources of truth | High | grep matches and all file paths listed |
| Remaining frontend tab-system duplication | **Low** | Audit incomplete (frontend subagent interrupted); follow-up needed |
| Frontend empty / single-file directories | **Not run** | Follow-up needed |
| Backend Tauri command matrix | Medium | Sampled; not all 1,149 entries checked |
| Backend duplicate struct/enum names | High | Three real conflicts grepped and fields compared |
| Backend config domain overlap | High | Verified by reading the file in depth |
| Backend `.expect()` on fallback | High | Nearly all are in `#[cfg(test)]` |
| Backend wire-protocol bloat | High | None found |
| Backend init parity | Medium | Seven entry points sampled; not exhaustive |
| Backend resolver asymmetry | **Low** | `identity.rs` not read in depth |
| Backend backward-compatibility shims | Medium | Sampled |

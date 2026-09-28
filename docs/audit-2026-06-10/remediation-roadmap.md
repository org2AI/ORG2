# Remediation Roadmap — 2026-06-10

Ordered by "blast radius / ROI / anti-pattern severity / non-overlapping files." Slices within Phases 1–3 **share no files** and can all be developed as parallel PRs.

---

## Phase 1 — Clear all Critical findings (8 independent PRs, all parallelizable)

> Goal: Resolve all F-CRIT-* findings; the release can proceed at the end of this phase.

| PR   | Title                                                              | Files                                                                 | Description                                                                                                                         | Anti-pattern | Verification |
| ---- | ------------------------------------------------------------------ | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------- | -------------------------------------------------------------------------- | --- | ----------------------------------------------------------------------- | -------- | --------------------------------------------------- |
| P1-1 | fix(startup): skip prune on session decode error                   | `src-tauri/src/lib.rs:892`                                            | Change the `Err` branch to `tracing::warn!` + `return;`; do not accidentally delete file history                                    | #6 / #33  | Add unit test: simulate query failure and assert `prune_orphan_sessions` was not called |
| P1-2 | fix(ipc): align subagent UI regex with Rust prefixes               | `src/engines/SessionCore/sync/adapters/shared/subagentTracking.ts:38` | Change regex to `/^(?:agent|shadow|sde|os|cli)agent?-[a-f0-9-]+/`; derive constants from `crates/types/src/session.rs:7-32` | #1 / #38 | E2E: spawn a builtin subagent and assert the UI nests it correctly |
| P1-3 | chore(cleanup): remove orphaned coding_agent tree                  | `src-tauri/src/coding_agent/**`                                       | `rm -rf`; remove the `osagent` literal from the EnvFilter in `lib.rs:476`; confirm the replacement exists with `git log`              | #29 / #43 | `cargo check -p app` passes; grep finds 0 `coding_agent` hits               |
| P1-4 | fix(chat): route spotlight palette + error-resume through FSM      | `useAgentControlPalette.ts:115`, `AgentErrorChatItem.tsx:114`          | Call `useMessageDispatch.dispatchMessageBySessionType`, or call `beginTurnDispatch + markTurnRunning` directly                     | #21 / #53 | E2E: trigger spotlight send + resume; assert FSM phase changes from dispatching → working |
| P1-5 | fix(queue): collapse holdSessionQueueForStopAtom into FSM stopping | `store/ui/messageQueueAtom.ts`, `sessionTimelineBoundary.ts`          | Delete the atom; read `getTurnPhase() === "stopping"` instead. Consider adding an `idle-after-stop` phase for "wait for the user to explicitly send now" | #19 / #51 | vitest: simulate Stop → terminal signal arrives → verify flush timing       |
| P1-6 | chore(diag): gate TEMP DIAG behind window flag                     | 5 files (see F-CRIT-8)                                                | Wrap all diagnostics in `if (window.__orgiiDiag) { console.warn(…) }`; remove `console.trace`; keep [draft-bug]/[ws-blank-diag]/[file-blank] tags unchanged | — | Visually confirm ComposerInput performance without traces; OPEN bugs remain reproducible |
| P1-7 | fix(types): unify SessionStatus across FE+BE                       | `agent-core/.../enums.rs:27` + 3 FE copies + CLI/DB enum               | a) Change `cli::SessionStatus` to `From<agent_core::SessionStatus>`; b) generate FE definitions from Rust via build script; c) remove 4 duplicate FE literals | #4 / #30 | Grep confirms literals such as `"running"`, `"queued"` have one FE source |
| P1-8 | fix(resolve): fix resolveFilePayload async fallback                | `resolveFilePayload.ts`                                               | Follow the `[file-blank]` diagnostic path and wait for user repro logs; this PR can be a separate hotfix outside Phase 1             | #10       | Close the OPEN bug                                                           |

---

## Phase 2 — High (10 independent PRs)

| PR    | Title                                                         | Files                                                      | Description                                                                   | Anti-pattern |
| ----- | ------------------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------- | --------- | ------------------------- | --- |
| P2-1  | refactor(launch): unify launch_cli_agent vs launch_rust_agent | `state/commands/session/launch.rs:265-309`                 | Reject CLI + agent_org_id combinations with a typed error, or pass the 7 fields through `CliLaunchParams` | #9 / #38 |
| P2-2  | refactor(atom): split userInitiatedCancelAtom                 | `cliSessionStatusAtom.ts:174-175`                          | Split into `postStopDispatchEpisodeAtom` + `stopDraftRestorationPendingAtom`  | #22 / #54 |
| P2-3  | fix(cancel): typed CancelReason parse                         | `cli/commands.rs:498-500`                                  | Return an explicit `Err` for unknown reasons; do not coerce to `None`         | #11 |
| P2-4  | chore(benchmark): decide register-or-delete                   | `src-tauri/src/benchmark.rs`                               | a) Register in `handler_list.inc`; b) use `git blame` to confirm it is obsolete, then delete the module | #2 |
| P2-5  | chore(advanced-search): delete stub duplicates                | `crates/advanced-search/src/commands/stubs.rs`             | Delete 5 stub structs redefined in `tantivy_index.rs`                         | #29 |
| P2-6  | rename(api-error): split 3 ApiError definitions               | `git-api/{types,error}.rs`, `api-search/error.rs`          | Keep one definition in git-api; rename api-search type to `ApiSearchError`    | #30 |
| P2-7  | rename(provider-config): split 2 ProviderConfig definitions   | `key-vault/provider_config.rs`, `agent-core/.../traits.rs` | `ProviderEnvDescriptor` + `ProviderClientConfig`                              | #30 |
| P2-8  | chore(rust): replace reachable expects with safer fallbacks   | `aggregation.rs` (4), `cursor_ide_watch.rs:82,128,146`    | Use `lock().unwrap_or_else(|p| p.into_inner())` or return `Err`               | #33 |
| P2-9  | fix(extractors): exhaustive match for EventDisplayVariant     | `event_pipeline/extractors/extractors.rs:341`              | Remove `_ => None`; let the compiler enforce exhaustiveness; sweep all 6 occurrences in this file | #1 |
| P2-10 | refactor(chat): consolidate useWorkspaceChat 8 dispatch sites | `useWorkspaceChat.ts:198-503`                              | Extract a single dispatcher hook and add an explicit source tag               | #21 |

---

## Phase 3 — Medium / Low (10+ independent PRs)

| PR    | Title                                                                 | Files / scope                                                                            | Anti-pattern |
| ----- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | --------- |
| P3-1  | refactor(chatpanel): move misplaced PanelViews out of engine root     | 6 files in `engines/ChatPanel/` → `features/` or `modules/`                              | #6        |
| P3-2  | refactor(status): derive `setSessionRuntimeStatusAtom` from FSM phase | `cliSessionStatusAtom.ts`                                                                | #20 / #52 |
| P3-3  | chore(schema): canonicalize pre-user-stage CREATE TABLE               | `cli/mod.rs`、`session_snapshots.rs`、`session-persistence/schema.rs`、`housekeeping.rs` | #43       |
| P3-4  | feat(types): Rust → TS enum generation pipeline                       | build script + `types/wire/`                                                             | —         |
| P3-5  | fix(resume): cli_agent_resume runs ensure_cli_account_key_fresh       | `cli/commands.rs:592`                                                                    | #9        |
| P3-6  | docs: glossary.md for 17 overloaded terms                             | `docs/glossary.md` (new file)                                                            | #4        |
| P3-7  | chore(diag): consolidate dangerouslySetInnerHTML sanitization         | 6 high-risk locations                                                                    | #15 OWASP |
| P3-8  | chore(rust): unwrap reduction phase 1                                 | Convert 30 hot-path calls to `Result`                                                   | #33       |
| P3-9  | chore(rust): unwrap reduction phase 2                                 | Remaining 147 calls                                                                     | #33       |
| P3-10 | refactor(naming): resolve 18 same-named structs across crates (non-critical) | See naming-collisions.md                                                           | #30       |

---

## Phase 4 — Info / Long Tail

| Item                                                            | Scope                              |
| --------------------------------------------------------------- | ---------------------------------- |
| Add PR-level CI (lint + clippy + cargo check -p app + vitest)   | New `.github/workflows/pr.yaml`    |
| Add a build-script lint for duplicate Tauri command names        | `src-tauri/build.rs`               |
| Split oversized files (`cursor_native/provider.rs` 3,220 → ≤ 1,000 lines) | Split `provider.rs`         |
| Make legacy KG table DROP in `infrastructure/housekeeping.rs:218` a one-time operation | Add `schema_migrations` record |
| Lift 11 `agent-core` variant literals to `core-types::session`   | `prefix_lookup.rs`, etc.           |
| Sweep for memory file updates (see `memory-verification.md`)     |                                    |

---

## Out of Scope (Explicitly Excluded from This Roadmap)

| Item                                         | Reason                                                                                                 |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Root-cause fixes for the three `OPEN` bugs     | Require user repro logs (`feedback_stop_speculating_add_diagnostic.md`); do not continue speculating immediately after the audit |
| `packages/`, `mobile-pwa/`, `contrib/relay/` | Deployed independently; audit separately                                                             |
| Reduce noise in the full `tsc --noEmit` baseline | `workspace_tsc_noemit_preexisting_noise.md` documents many pre-existing errors unrelated to this audit |
| Physically split large files                   | Does not directly eliminate an anti-pattern; do when driven by need                                    |
| Edit Skill / agent definition content          | Outside engineering scope                                                                             |

---

## Phase 1 PR Non-Overlap Check

| PR   | Main files                                                                                                                        |
| ---- | --------------------------------------------------------------------------------------------------------------------------------- |
| P1-1 | `src-tauri/src/lib.rs`                                                                                                            |
| P1-2 | `src/engines/SessionCore/sync/adapters/shared/subagentTracking.ts`                                                                |
| P1-3 | `src-tauri/src/coding_agent/` + one line in `lib.rs:476`                                                                          |
| P1-4 | `src/scaffold/.../useAgentControlPalette.ts`、`src/engines/ChatPanel/ChatItems/AgentErrorChatItem.tsx`                            |
| P1-5 | `src/store/ui/messageQueueAtom.ts`、`src/engines/SessionCore/control/sessionTimelineBoundary.ts`                                  |
| P1-6 | 5 files (excluding files changed by P1-2/P1-4/P1-5)                                                                              |
| P1-7 | `src/types/session/session.ts`, `agent-core/.../enums.rs`, etc. (**May conflict with cross-layer status changes**; review P1-7 separately) |
| P1-8 | `resolveFilePayload.ts` (this file only)                                                                                         |

**Conflict point**: P1-1 and P1-3 both modify `lib.rs`, at `:892` and `:476` respectively; they can be combined or kept separate. All other PRs are independent.

---

## Acceptance Gates (Each PR)

1. Confirm the fix with grep.
2. Relevant sweep commands return 0 hits (see the Sweep status for each item in `findings-detail.md`).
3. Path-filtered `tsc --noEmit` shows only baseline issues.
4. Path-filtered `cargo check -p <crate>` passes.
5. Close the OPEN flag in memory.

---

## "Highest Acceptance Standard" Summary (for Review)

✅ All 30 Acceptance Criteria are ✅, and:

- All F-CRIT-* findings closed → Phase 1 done
- All F-HIGH-* findings closed → Phase 2 done
- All sweep greps return 0 hits
- All items in the README.md "Audit Self-Check" are ✅
- Address the 3 OPEN bugs separately after collecting diagnostic logs

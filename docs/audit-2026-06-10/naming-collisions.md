# Naming Collisions / Overloaded-Term Glossary — 2026-06-10

## Same-Named `pub struct`s Across Modules (Rust BE)

Source: `grep -rE "^pub struct " src-tauri/src src-tauri/crates --include="*.rs"` → sort | uniq -c.
Only entries with ≥ 2 occurrences are listed (**23 total**).

| Struct name              | Occurrences | Location                                                                                                                       | Risk                | Suggested fix                                           |
| ------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------- | -------------------------------------------------------- |
| `ApiError`               | **3**    | `git-api/src/types.rs` + `git-api/src/error.rs` (same-crate conflict) + `api-search/src/error.rs`                              | ❌ Critical         | Keep one definition in git-api; rename api-search type to `ApiSearchError` |
| `ProviderConfig`         | 2        | `key-vault/src/provider_config.rs:12` (FE settings descriptor) + `agent-core/src/core/providers/traits.rs:360` (runtime credential) | ❌ Critical         | `ProviderEnvDescriptor` + `ProviderClientConfig`         |
| `SearchHit`              | 2        | `advanced-search/src/commands/stubs.rs:54` + `advanced-search/src/tantivy_index.rs:669`                                        | ❌ High (same crate) | Delete stubs (dead code)                               |
| `MatchingLine`           | 2        | `advanced-search/src/commands/stubs.rs:46` + `tantivy_index.rs:680`                                                            | ❌ High (same crate) | Delete stubs                                            |
| `IncrementalResult`      | 2        | `advanced-search/src/commands/stubs.rs:21` + `tantivy_index.rs:692`                                                            | ❌ High (same crate) | Delete stubs                                            |
| `TantivyIndexStats`      | 2        | `advanced-search/src/commands/stubs.rs:65` + `tantivy_index.rs:654`                                                            | ❌ High (same crate) | Delete stubs                                            |
| `TantivyIndexInfo`       | 2        | `advanced-search/src/commands/stubs.rs:72` + `tantivy_index.rs:662`                                                            | ❌ High (same crate) | Delete stubs                                            |
| `SemanticHit`            | 2        | `advanced-search/src/commands/stubs.rs:34` + another location                                                                   | ⚠️ Medium           | Same as above                                           |
| `SearchFilters`          | 2        | `advanced-search/src/commands/types.rs:6` + another location                                                                     | ⚠️ Medium           | Check whether stubs are dead                            |
| `EmbeddingModelStatus`   | 2        | `advanced-search/src/commands/types.rs:16` + another location                                                                    | ⚠️ Medium           | Same as above                                           |
| `SessionEvent`           | 2        | –                                                                                                                              | ⚠️ Medium           | Needs confirmation                                       |
| `EffectiveToolsResponse` | 2        | –                                                                                                                              | ⚠️ Medium           | Needs confirmation                                       |
| `QuotaInfo`              | 2        | –                                                                                                                              | ⚠️ Low              | Needs confirmation                                       |
| `QueryResult`            | 2        | –                                                                                                                              | ⚠️ Low              | Needs confirmation                                       |
| `FileSearchResult`       | 2        | –                                                                                                                              | ⚠️ Low              | Needs confirmation                                       |
| `GitStatus`              | 2        | –                                                                                                                              | ⚠️ Low              | Needs confirmation                                       |
| `GitHubClient`           | 2        | –                                                                                                                              | ⚠️ Low              | Needs confirmation                                       |
| `ExecuteResult`          | 2        | –                                                                                                                              | ⚠️ Low              | Needs confirmation                                       |
| `DirEntry`               | 2        | –                                                                                                                              | ⚠️ Low              | Needs confirmation                                       |
| `ColumnInfo`             | 2        | –                                                                                                                              | ⚠️ Low              | Needs confirmation                                       |
| `CacheStats`             | 2        | –                                                                                                                              | ⚠️ Low              | Needs confirmation                                       |
| `TableInfo`              | 2        | –                                                                                                                              | ⚠️ Low              | Needs confirmation                                       |
| `WorkingDirectoryFile`   | 2        | –                                                                                                                              | ⚠️ Low              | Needs confirmation                                       |

**Sweep command**:

```bash
grep -rE "^pub struct " src-tauri/src src-tauri/crates --include="*.rs" \
  | sed 's/.*pub struct \([A-Za-z0-9_]*\).*/\1/' \
  | sort | uniq -c | sort -rn | awk '$1 >= 2'
```

---

## Same-Named Types Across FE Files (TypeScript)

| Name                             | Hits     | Location                                                                                                                          | Fix                                      |
| -------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `SessionInfo`                    | 2        | `store/session/sessionAtom/types.ts:27` + `engines/SessionCore/services/types.ts:51`                                              | Rename service-side type to `SessionServiceInfo` |
| `SessionView` vs `MessageViewer` | Similar names | `store/session/viewAtom.ts:39` + `WorkStation/Chat/Communication/MessageViewer.tsx`                                            | Not a collision, but easy to confuse     |
| `SessionStatus`                  | 5        | `types/session/session.ts`, `WorkItems/constants.ts`, `TaskKanban/config.ts`, `AgentOrgOverviewPanel.tsx`, `AgentOrgTaskList.tsx` | Single source (see F-CRIT-4)             |

---

## Duplicate Definitions Across Layers (FE + BE)

| Concept                                                                          | FE                                    | BE                                    | Canonical source                                  |
| -------------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------- | ------------------------------------------------- |
| `SessionStatus` 16 / 12 / 6 / 5 variants                                       | 1 location                            | 3 locations                           | Generate TS from `agent-core::session::SessionStatus` |
| `AgentExecMode` 6 variants                                                     | `sessionCreatorConfig.ts:70`           | `enums.rs:172`                        | Manually duplicated — should be generated              |
| `CancelReason` 4 variants                                                      | `api/tauri/agent/session.ts:42-48`     | `state/control_flow.rs::CancelReason` | Manually duplicated                                    |
| Event names `agent:* / code_session.*`                                        | `cliAdapter.ts:858+`                   | agent-core / cli emitter              | Manually duplicated                                    |
| Session ID prefixes `cliagent- / sdeagent- / osagent- / wingman- / agent- / shadow-` | `src/util/session/sessionCategory.ts` | `crates/types/src/session.rs:7-32` | Manually duplicated |

---

## Overloaded-Term Glossary

### `session` (3 FE meanings / 8 BE meanings = 11 total)

FE:

1. `activeSessionIdAtom` — session subscribed to by the pipeline
2. `workstationActiveSessionIdAtom` — session remembered by the UI
3. `sessionCreatorDraftListAtom` — pre-launch session draft

BE:

1. CLI agent subprocess session (`agent_sessions/cli/`)
2. Rust agent session (`agent_core::session::*`)
3. Tauri IPC subscription session (`websocket_handler::register_channel`)
4. PTY session (`terminal::pty::PtySession`)
5. LSP language-server session
6. wingman observation session
7. cursor-bridge probe session
8. browser webview session

**Unified dispatcher**: `session_launch` (`launch.rs:111`) dispatches by the `category` string.

### `agent` (3 FE / 8 BE meanings)

FE:

1. `api/tauri/agent/` — Rust IPC layer
2. `modules/MainApp/AgentOrgs/` — multi-agent org configuration
3. `osagent/useBrowserAutomation` — OS browser driver

BE:

1. `AgentDefinition` (config)
2. `ResolvedAgent` (runtime)
3. `AgentAppState` (Tauri singleton)
4. `AgentSession` (`session_runtime.rs:105`)
5. `AgentRunTarget`
6. "CLI agent" subprocess
7. `AgentKind` enum
8. `AgentOrg` (org of agents)

**Most easily confused trio**: `AgentSession` vs `AgentAppState` vs `AgentDefinition`.

### `tab` (8 parallel FE tab systems)

Per memory file `workspace_tab_systems_inventory.md`: WorkStation TabBar / PrimarySidebarLayout / EditorBottomPanel / Communication / SessionReplay / SidebarModules / TabPill / WorkItem detail. `PanelTabBar` (formerly SecondaryPanelHeader) bridges ①↔③.

### `mode` (3 state machines)

1. `agentExecMode` (build / ask / plan / debug / review / wingman)
2. `stationMode` (workstation surface mode: agent-station / my-station / work-management, etc.)
3. `chatPanelContentModeAtom` (which content view is displayed)

### `pill` (3 UI primitives)

1. `ModePill` (agent-exec-mode selector)
2. `SidebarTabButton` (segmented-control chrome)
3. `ComposerPill` (@file / context pill in composer)

### `panel`、`event`、`block`、`creator`、`bridge`、`manager`、`handler`、`broadcast`、`gateway`、`provider`、`runtime`、`config`

See the Layer 4 tables in [be-audit.md](./be-audit.md) and [fe-audit.md](./fe-audit.md).

---

## Phantom Names (Partly Cleaned Up, but Still Present)

| Term                                                                  | Remaining location                                | Status                           |
| -------------------------------------------------------------------- | ------------------------------------------------- | -------------------------------- |
| `osagent`                                                            | `coding_agent/mod.rs:180`, `lib.rs:476` EnvFilter | Entire module is dead; clean up together |
| `sdeagent-`                                                          | 6 agent-core literals                             | Should be lifted to `core-types::session` |
| `SDE Agent` display label                                            | Multiple locations                                | Partly lifted                    |
| `secondary-panel`                                                    | –                                                 | `PanelTabBar` rename completed   |
| `setup-repo` skill pinned by default                                 | Removed in migration                              | memory STALE                     |
| `forceSendPendingQueueAtom` / `holdForStop` / `markQueueTurnSettled` | Do not exist                                      | memory STALE                     |

# Engines

Self-contained runtime subsystems that power specific tools in the editor.

## What is an Engine?

An engine is a **complete, isolated subsystem** that:

- Has its own state management and business logic
- May include UI components specific to that engine
- Operates independently from other engines
- Can be loaded/unloaded as needed

## Current Engines

Line counts are `.ts` / `.tsx` excluding tests, measured 2026-09-16.

| Engine         |   Lines | Purpose                                                        |
| -------------- | ------: | -------------------------------------------------------------- |
| `ChatPanel`    | 100,765 | Conversation surface — history, composer, tab bar, side panels |
| `SessionCore`  |  41,111 | Session event lifecycle — ingestion, storage, sync, rendering  |
| `Simulator`    |  12,655 | Visual replay of agent sessions as dockable "apps"             |
| `TerminalCore` |   5,444 | PTY terminal sessions on xterm.js                              |
| `DatabaseCore` |   2,252 | Unified database provider interface                            |
| `BrowserCore`  |   1,304 | Embedded browser sessions on Tauri WebViews                    |

There is no `GitWorkflow` engine, and there has not been one for some time. Git
UI is spread across `components/GitDialogs`,
`modules/WorkStation/shared/{GitFileList,DiffFileSection,DiffSectionList}`,
`modules/WorkStation/shared/SidebarModules/SourceControl` and
`features/CodeMirror/Diff`, over the atoms in `store/git/` and the provider in
`contexts/git/`.

Per-engine detail is in `docs/architecture/frontend-engines.md`.

## Layering

Six tiers. Imports point **downward only**; coordination flows down as data and
up as registration. This is the target the tree is being migrated to, so expect
upward edges that predate the rule — add none.

| Tier | Location                                                                             | Holds                                                                                                                  |
| ---: | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
|    6 | `src/app/`                                                                           | composition root, providers, bootstrap, router                                                                         |
|    5 | `src/modules/`                                                                       | user-facing surfaces (MainApp, WorkStation, ProjectManager, …)                                                         |
|    4 | `src/scaffold/`                                                                      | app shell: layout, sidebar, tab bar, workbench chrome, modals, spotlight, context menu, wizard, updater, action system |
|    3 | `src/engines/`                                                                       | runtime subsystems (the table above)                                                                                   |
|    2 | `src/components/`                                                                    | presentational and layout primitives — no store, no domain                                                             |
|    1 | `src/contracts/`, `types/`, `store/`, `api/`, `util/`, `config/`, `i18n/`, `assets/` | leaves                                                                                                                 |

- `components/` imports only tier 1.
- `scaffold/` never imports `modules/`.
- `engines/` never imports `scaffold/` or `modules/`, and tier 1 never imports
  tier ≥ 2.

`src/features/` is not yet a settled tier — it holds both engine-shaped code
(`Org2Cloud`, `CodeMirror`) and surface-shaped code; treat a new subsystem as an
engine unless it composes surfaces.

## Structure

Each engine should follow this pattern:

```
engines/MyEngine/
├── index.ts          # Public exports
├── types.ts          # Engine-specific types
├── hooks/            # React hooks (if needed)
├── components/       # UI components (if needed)
├── services/         # Core logic
└── store/            # State management (if needed)
```

## Guidelines

1. **Isolation**: Engines should minimize dependencies on other engines
2. **Self-contained**: Include all logic and UI needed for that subsystem
3. **Clear API**: Export a clean public interface via `index.ts`
4. **No cross-engine imports**: Use services or events for communication

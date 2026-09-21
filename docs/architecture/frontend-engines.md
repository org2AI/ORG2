# Frontend Engines Architecture

> Last updated: 2026-09-16

Engines (`src/engines/`) are **self-contained runtime subsystems** that power
specific tools in the editor. Each engine owns its own state, business logic,
and (optionally) UI components. They are isolated from each other by design —
cross-engine coordination happens through Jotai atoms, events, or explicit
service calls, never via direct import chains.

Engines sit at tier 3 of the six-tier layering described in
`src/engines/README.md`: an engine may import `components/` and the tier-1
leaves, and must not import `scaffold/` or `modules/`.

---

## Engine Inventory

Line counts are `.ts` / `.tsx` excluding tests, measured 2026-09-16.

| Engine           | Directory                   |   Lines | Primary responsibility                                                              |
| ---------------- | --------------------------- | ------: | ----------------------------------------------------------------------------------- |
| **ChatPanel**    | `src/engines/ChatPanel/`    | 100,765 | Conversation surface — history, composer, tab bar, side panels, event rendering     |
| **SessionCore**  | `src/engines/SessionCore/`  |  41,111 | Session event lifecycle — ingestion, conversations, turns, storage, sync, rendering |
| **Simulator**    | `src/engines/Simulator/`    |  12,655 | Visual replay of agent sessions as dockable "apps" in a grid                        |
| **TerminalCore** | `src/engines/TerminalCore/` |   5,444 | PTY terminal sessions with xterm.js, shell integration, agent-linked sessions       |
| **DatabaseCore** | `src/engines/DatabaseCore/` |   2,252 | Unified database provider (SQLite, Supabase, Turso, Neon, Postgres, MySQL)          |
| **BrowserCore**  | `src/engines/BrowserCore/`  |   1,304 | Embedded browser sessions on Tauri WebViews                                         |

There is no `GitWorkflow` engine, and the `GitHubDiff/` and
`GitSuggestionCards/` directories it was said to own no longer exist anywhere in
the tree. Git UI is spread across `components/GitDialogs`,
`modules/WorkStation/shared/{GitFileList,DiffFileSection,DiffSectionList}`,
`modules/WorkStation/shared/SidebarModules/SourceControl` and
`features/CodeMirror/Diff`, over the atoms in `store/git/` and the provider in
`contexts/git/GitStatusContext`.

---

## Engine Descriptions

### ChatPanel

The largest engine, and the conversation surface itself: it renders the event
stream and owns the composer.

**Owns:**

- `ChatHistory/` — scrollable, grouped event list and its projections
- `ChatItems/` — per-event item wrappers
- `events/` — per-event-kind stream renderers (agent message, thinking, tool
  results, discussion)
- `blocks/` — reusable block components (`CodeBlock`, `DiffBlock`,
  `ExploreBlock`, `ListDirBlock`, …)
- `InputArea/` — composer, attachments, slash commands, conversation targeting
- `ChatPanelTabBar/`, `TabContent/` — the chat pane's own tab strip and per-tab
  surfaces
- `panels/` — auxiliary panel views (project, work item, runtime, cloud org,
  GitHub issue / PR)
- `SideChat/`, `ThreadSelector/`, `ConversationStreamProvider/`
- `header/`, `components/`, `rendering/`, `adapters/`, `hooks/`

**Config constants** (`config.ts`): `MIN_WIDTH = 420`,
`MAX_WIDTH_RATIO = 0.5` (the maximum is derived per viewport by
`getChatMaxWidth()`, not a fixed pixel value), `LEFT_PANEL_WIDTH = 64`,
`RAPID_CLICK_THRESHOLD_MS = 300`.

---

### SessionCore

The **central data engine**. All other engines read from its atoms. See
`src/engines/SessionCore/ARCHITECTURE.md` for the full pipeline.

**Owns:**

- `core/atoms/` — `events.ts`, `metadata.ts`, `replay.ts`, `context.ts` and the
  write actions (`actions*.ts`)
- `derived/` — derived atoms: `chatEvents.ts`, `simulatorEvents.ts`,
  planning-indicator and plan-display atoms
- `ingestion/` — bridge to the Rust normalizer (`rustBridge.ts`); converts raw
  `ActivityChunk` → `SessionEvent[]` over Tauri RPC
- `conversations/` — canonical conversation events, native materializer /
  projection / reconciliation, local continuation and turn identity
- `turns/`, `control/` — turn lifecycle, intent dispatch, timeline boundaries
- `sync/` — session channel subscription, sync provider, reconciliation, and
  per-session-type adapters (CLI, native, Rust agents)
- `rendering/` — prop normalization, component registry, per-tool event types
- `replay/` — replay turn segments and shell replay ranges
- `storage/` — SQLite cache adapter
- `payloads/`, `services/`, `components/`
- `workspace/atoms/` — session-scoped UI atoms (`sessionAtoms.ts`, `uiAtoms.ts`)
- `hooks/session/` — session creation and discovery hooks
- `hooks/replay/` — `useStepState` and planning-indicator hooks

**Key invariant:** ALL chunk normalization happens in Rust. The TypeScript layer
only calls Tauri RPC — no local normalization logic exists in TS.

---

### Simulator

Replays agent sessions visually as full "apps" rather than individual event
components.

**Owns:**

- `types/appTypes.ts` — the `AppType` enum: `CODE_EDITOR`, `CHANNELS`,
  `BROWSER`, `STORY_MANAGER`, `DIFF`, `BACKGROUND_TASKS`, `CANVAS`
- `utils/eventToDockMapping.ts` — maps `functionName` → `AppType`
- `utils/simulatorEventRouting.ts` — pattern-based app-type routing
- `utils/findIndexAtTime.ts` — canonical binary-search for the replay cursor
- `apps/core/` — the framework layer: app config factory, matchers, replay
  types, `useSimulatorAppState`, full-event hydration registry
- `apps/canvas/`, `apps/backgroundTasks/` — the two app surfaces the engine
  renders itself
- `hooks/` — `useCellPlayback`, `useReplayMode`, `useEventNavigation`,
  `useSimulatorEvents`, `useSimulatorSubagents`, `useGridLayout`, …
- `components/` — `SimulatorContentArea`, `Dock`, `GridCell`, `CaptionBar`,
  `SimulatorStatusBar`, `SubagentPipCard`, …

**App registration:** the remaining app surfaces (code editor, channels,
browser, project, diff) are WorkStation components. They are registered
`AppType` → lazy component in
`modules/WorkStation/shared/simulatorRegistry`, so the engine never imports
them — it renders whatever the registry resolves.

---

### TerminalCore

Full PTY terminal backed by xterm.js with agent integration.

**Owns:**

- `components/` — `TerminalInteractive`, `TerminalDisplay`, `XtermOutput`,
  `TerminalSearchPanel`
- `hooks/useTerminalState.ts` — session CRUD, active session, resize
- `addons/ShellIntegrationAddon.ts` — OSC shell-integration sequence handling
- `terminalMountWindow.ts` — detached-window mounting
- `types.ts` — `TerminalSession` (with `readOnly`, `agentSessionId`, `shellKind`)

---

### DatabaseCore

Uniform interface over heterogeneous database back-ends.

**Owns:**

- `factory.ts` — creates provider instances by type
- `providers/` — per-type adapters (`TauriSqliteProvider`, `TauriSqlProvider`,
  `SupabaseProvider`, `TursoProvider`, `NeonProvider`, `PostgresProvider`,
  `MySQLProvider`)
- `types.ts` — `DatabaseType`, `ConnectionStatus`, `TableInfo`, query result types

**Supported providers:** `sqlite`, `supabase`, `turso`, `neon`, `postgres`,
`mysql`.

---

### BrowserCore

Provides in-app browsing via Tauri WebViews.

**Owns:**

- `index.tsx` — the `BrowserCore` surface that hosts the active session
- `BrowserSessionWebview.tsx` — renders a single browser WebView
- `nativeFrameAnchor.ts` — keeps the native webview aligned with its DOM slot
- `webviewMountWindow.ts` — detached-window mounting
- `hooks/` — `useBrowserAutomation`, `useBrowserContextAdapter`
- `types.ts` — `BrowserSession`, navigation types

The URL bar and tab strip are chrome, not engine code: they live in
`modules/WorkStation/Browser/` and `scaffold/WorkbenchChrome/`. Session state is
provided by `contexts/workstation/BrowserContext`.

---

## Data Flow Between Engines

```
┌──────────────────────────────────────────────────────────────────────┐
│  Tauri IPC (Rust backend)                                            │
│  • chunk consolidate / normalize / merge   (SessionCore ingestion)   │
│  • Terminal PTY commands                   (TerminalCore)            │
│  • Browser navigation / screenshot         (BrowserCore)             │
│  • SQL execution                           (DatabaseCore)            │
└───────────────────────────────┬──────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│  SessionCore                                                        │
│  sync/ → ingestion/ → core/atoms/events                             │
│                         │                                           │
│              derived/chatEvents      derived/simulatorEvents        │
└──────────┬──────────────┬───────────────────────────────────────────┘
           │              │
           ▼              ▼
    ┌─────────────┐ ┌──────────────┐
    │  ChatPanel  │ │  Simulator   │
    │             │ │              │
    │ reads       │ │ reads        │
    │ chatEvents  │ │ simEvents    │
    └─────────────┘ └──────────────┘

Independent engines (own state, no SessionCore dependency):
  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
  │  BrowserCore │  │ TerminalCore │  │ DatabaseCore │
  └──────────────┘  └──────────────┘  └──────────────┘
```

---

## How Engines Communicate

### Jotai Atoms (primary)

Each engine exposes atoms through its `index.ts`. Consumers import the atom
and call `useAtomValue` / `useSetAtom` in a component or hook. This is the
standard channel for reading shared state (e.g., ChatPanel reads
`chatEventsAtom` from SessionCore's derived layer).

### Tauri Commands / IPC

Engines that need data from Rust invoke Tauri commands through
`@src/api/tauri/rpc` and write results into their own atoms. Commands are typed
via generated bindings in `src/commands/`.

### Registration (down as data, up as registration)

An engine that must render surface-owned UI exposes a registry instead of
importing the surface. `Simulator` is the worked example: WorkStation registers
its app components into `simulatorRegistry`, and the engine resolves them by
`AppType`. Use this whenever the alternative would be an `engines/ → modules/`
import.

### Events (rare)

Some cross-engine coordination uses a lightweight in-process event bus
(custom `EventEmitter` wrapper). This is reserved for fire-and-forget
notifications (e.g., "session ended") where the publisher should not depend on
the subscriber.

### Hook composition

When two engines need to interoperate at the hook level, one engine exports a
hook that the other engine's component tree can compose. For example,
`SessionCore` exports `useEventNavigation`, which ChatPanel composes to route
replay navigation through the canonical event atoms.

---

## Public Exports (`index.ts`)

Each engine exports only its intended public surface through `index.ts`.
Internal modules (`core/atoms/events.ts`, `rendering/registry/…`) should not
be imported by consumers directly — always go through the engine's `index.ts`
to avoid accidental coupling.

---

## Adding a New Engine

1. Create `src/engines/MyEngine/` with `index.ts`, `types.ts`, `hooks/`,
   optional `components/`.
2. Keep the engine isolated — no imports from sibling engines except via atoms
   or service calls, and no imports from `scaffold/` or `modules/`.
3. Export the public API from `index.ts`.
4. Register any Tauri command bindings in `src/commands/`.
5. Add the engine to this document and to `src/engines/README.md`.

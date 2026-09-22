# Workstation sharing policy

## Behavior

Settings → General → **Workstation sharing** uses `general.myStationSharing`:

- **Working directory** (default): chat sessions with the same known local working directory present one Workstation workspace
- **Chat tab**: each remembered chat session presents its separate Workstation workspace

The policy routes open tabs, tab data, ordering, active selection, recent tabs,
editor repository caches, terminal selection, pending opens, and target-session
ADE file context through the same identity. Existing app-wide appearance settings
and live Browser/Terminal resource ownership keep their existing semantics.

Different stored working-directory paths remain separate. With no chat selected,
the Global workspace is used.
Missing/relative directories and guest imports use the session workspace until a
local directory can be established. Remote guest paths cannot join local paths.
Path matching preserves case and normalizes separators and trailing slashes; it
does not resolve symlinks or equate differently cased paths on a case-insensitive
volume.

The resolver currently reads `repoPath`, not the separate `worktreePath` field.
The sharing policy does not yet cover all formatting: sidebar/bottom-panel
dimensions and collapse state remain shared generally, while some temporary
view state (scroll offsets, expanded sections, detail selections) is cached by
tab ID alone. Matching tab IDs can therefore reuse that temporary state even
under the Chat tab policy.

## Ownership and compatibility

The former producing boundary always selected `session:<id>` in
`presentedWorkstationWorkspaceKeyAtom`. `workspaceScope.ts` now resolves the
settings policy against the selected session record's `repoPath`, without using
stale presentation metadata or a pipeline session selected by another surface.
Imperative/delayed actions capture the resolved key before navigation.

The canonical state remains `workstationTabsStateAtom`, persisted through
`persistWorkstationTabsState`. Directory documents use dedicated encoded v4 keys
and an optional `directories` manifest field; existing v4 documents remain valid.
No database, IPC shape, dependency, or lockfile changes are required.

Directory and per-chat-tab configurations are separate saved workspaces. A newly
used policy starts with an empty workspace until populated; selecting Chat tab
restores existing per-session layouts. Switching policies does not merge or delete
those saved layouts. To roll back behavior, select Chat tab. Historical persisted
user data was not edited or cleaned up during implementation.

Deleting one chat does not delete its directory's shared workspace. A deleted
agent terminal target is cleared wherever it was selected. Explicitly closing a
live Browser/Terminal resource removes its references from every directory and
session workspace.

## Architecture checklist

| Layer                | Result                                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 1 Compilation        | Native checker passes on the isolated latest-develop branch; the earlier shared-checkout check was blocked by unrelated changes |
| 2 Duplication        | UI workspace, Terminal selection, and ADE context use the canonical policy resolver                                             |
| 3 Naming             | Explicit `directory`, `session`, and `global` key variants; no synthetic session IDs                                            |
| 4 Semantics          | Chat identity is distinct from working-directory identity and live Browser/Terminal resource identity                           |
| 5 Defaults           | Directory default; unknown/remote paths stay session-scoped; no selected chat stays Global                                      |
| 6 Boundaries         | Scope resolution lives below tab and Terminal state, avoiding a tab-state/Terminal import cycle                                 |
| 7 Readability        | Sharing and normalization rules documented beside resolver and public key types                                                 |
| 8 Serialization      | Tests round-trip directory and session partitions together; malformed/old manifest paths use existing sanitizers                |
| 9 Initialization     | Same resolver for presented UI and background context; existing v2 seed claim supports directory keys                           |
| 10 Resolver symmetry | All workspace consumers use the same key serialization; captured delayed keys do not follow subsequent navigation               |

All ten relevant TypeScript layers reviewed. Rust compilation, provider wire
protocols, and backend initialization are outside the implementation change;
Rust edits only rename text in comments.

## Settings control review

The new row reuses `SectionRow`, shared `Select`, `SECTION_CONTROL_STYLE`, and
localized labels in all 13 locales. `Select.ariaLabel` supplies its accessible
name. AST inspection of the changed production TSX found no raw action/input
controls or clickable substitutes. No Button presentation was changed. This is a
new settings row, not a component-refactor/UI-cleanup audit batch.

## Verification

- `pnpm test src/store/workstation/tabs src/store/workstation/codeEditor/terminal/__tests__/terminalTargetAtom.test.ts src/services/context/collectors/AdeContextCollector.test.ts src/hooks/tabHost/useWorkStationTabs src/config/settingsSchema src/config/settingsSearch` — 26 files, 202 tests passed in the original implementation check; the isolated PR branch passes the expanded 54-file / 417-test set
- `pnpm exec eslint src/store/workstation/tabs/{workspaceScope,types,atoms,storage,recentTabs,editorCache}.ts src/store/workstation/tabs/__tests__/workspaceScope.test.ts src/store/workstation/codeEditor/terminalTargetAtom.ts src/config/settingsSchema/registry/general.ts src/config/settingsSearch.ts src/modules/MainApp/Settings/sections/GeneralSection.tsx src/services/context/collectors/AdeContextCollector.ts --max-warnings 0` — passed
- `pnpm run typecheck` — Node exhausted its default 4 GB heap
- `pnpm run typecheck:fast` — passed on the isolated PR branch based on latest develop; earlier errors in the shared checkout came from unrelated changes
- `git diff --check` — passed
- Parsed all locale JSON files and checked all four new keys and description punctuation — passed
- Live Tauri visual/CPU/RSS and detached-window lifecycle checks were not run; computer control is not authorized

The PR branch is isolated from the shared checkout. Unrelated working-tree
changes were left intact. Commit and PR authorship use the requested sudomaggie
profile.

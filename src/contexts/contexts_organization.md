# Contexts Organization

This document describes the organization of the `src/contexts/` folder.

## Structure Overview

```
src/contexts/
├── git/                        # Git status context (has index.ts)
├── workspace/                  # Workspace-level contexts (no barrel)
└── workstation/                # Workstation page contexts (has index.ts)
```

There is no top-level `src/contexts/index.ts`. Import from the domain barrel
(`@src/contexts/git`, `@src/contexts/workstation`) or, for `workspace/`, from
the file itself.

## Domain Categories

### `git/` — Git Status Contexts

Contexts for git operations and status tracking.

| File                | Contents                                                               |
| ------------------- | ---------------------------------------------------------------------- |
| `GitStatusContext/` | Single-repo git status, with a deferred provider and watcher lifecycle |

### `workstation/` — Workstation Contexts

| File             | Contents                                          |
| ---------------- | ------------------------------------------------- |
| `BrowserContext` | Browser tab sessions for the Workstation surfaces |

`AutomationContext`, `EditorContext`, `FilesContext` and `TerminalContext` were
removed; `BrowserContext` is the only survivor in this directory.

### `workspace/` — Workspace Contexts

Workspace-level contexts for chat and data. This directory has no `index.ts`;
consumers import the file directly.

| File          | Contents                        |
| ------------- | ------------------------------- |
| `ChatContext` | Chat state (partially migrated) |
| `DataContext` | Workspace data state            |

## Import Guidelines

### Direct imports (recommended)

```typescript
import { useGitStatus } from "@src/contexts/git";
import { useChatContext } from "@src/contexts/workspace/ChatContext";
import { useBrowserContext } from "@src/contexts/workstation";
```

### Namespace imports (when names conflict)

```typescript
import * as GitContexts from "@src/contexts/git";
import * as WorkStationContexts from "@src/contexts/workstation";
```

## Design Principles

1. **Domain-driven**: Contexts grouped by what they manage, not where they're used
2. **Barrel exports**: `git/` and `workstation/` each expose an `index.ts`
3. **Provider pattern**: Each context follows Provider + useContext hook pattern
4. **Last resort**: React context is for genuinely provider-scoped subscriptions
   (`GitStatusContext`). Shared state belongs in `store/` atoms; state that only
   one surface needs belongs in that module.

## Adding New Contexts

Prefer not to. Add a Jotai atom under `store/`, or module-local state, unless
the value is a provider-scoped subscription whose lifetime must follow the
provider's mount. If a context really is the right shape:

1. Identify the domain: Git? Workstation? Workspace?
2. Add to an existing file if related, or create a new file if distinct
3. Export from that domain's `index.ts`

## Migration Notes

Reorganized on 2026-01-29:

- Moved `GitStatusContext/` → `git/GitStatusContext/`
- Moved `AutomationContext`, `BrowserContext`, `EditorContext`, `FilesContext`, `TerminalContext` → `workstation/`
- Moved `SessionListContext`, `RecentFilesContext` → `session/`
- Kept `workspace/` as-is (already organized)

Updated on 2026-03-29:

- Removed `integration/` folder (code-server extension bridge removed)

Updated on 2026-09-01:

- Removed the unused multi-repository Git status context after Spotlight stopped showing repository status badges

Updated on 2026-09-16:

- Corrected this document: the Structure Overview listed a top-level `index.ts`
  and a `session/` directory, neither of which exists. The real contents are
  `git/`, `workspace/` and `workstation/`.
- Documented the direction of travel: `contexts/` is a fourth state tier beside
  `store/`, `services/` and module-local state. `contexts/workstation/` and
  `contexts/workspace/` are slated to fold into their owning modules; the git
  status provider stays.

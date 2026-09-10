# Agent display names UI audit

Scope: consolidating Kanban provider labels with the shared agent formatter.

| Line                                                                  | Element          | Verdict          | Reason                                                                                                                                                                    | Suggested change |
| --------------------------------------------------------------------- | ---------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `src/features/TaskKanban/components/KanbanHeaderFilters/index.tsx:94` | CLI filter label | keep with reason | Uses the shared formatter instead of a separate four-provider naming switch. Existing dropdown components, keyboard interaction, spacing, and theme tokens remain intact. | None.            |

Verdict totals: **0 fix**, **1 keep with reason**, **0 abstract**.

Verification: targeted ESLint, typecheck, and 35 existing tests passed. Desktop visual verification was not run because computer control is explicit opt-in.

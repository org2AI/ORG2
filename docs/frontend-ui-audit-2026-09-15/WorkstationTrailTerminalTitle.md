# WorkstationTrailTerminalHeader UI audit

| Line                                     | Element                                | Verdict          | Reason                                                                                                                                                                                               | Suggested change                                       |
| ---------------------------------------- | -------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `WorkstationTrailTerminalHeader.tsx:80`  | Single-terminal title and fold control | fix              | The separate icon button differed from the workstation trail heading. The shared title-toggle API supplies matching typography, inline chevron, transparent hover surface, and whole-title hit area. | Applied the shared title toggle only for one terminal. |
| `WorkstationTrailTerminalHeader.tsx:87`  | Multiple-terminal controls             | keep with reason | The requested title change applies only to one terminal. Multiple terminals retain their existing tabs, keyboard navigation, fold action, and process-count summary.                                 | None.                                                  |
| `WorkstationTrailTerminalHeader.tsx:69`  | Title and panel labelling              | keep with reason | The named span preserves the panel's aria-labelledby target. Shared Button owns keyboard activation and aria-expanded; heading tokens supply case, dimensions, and colors.                           | None.                                                  |
| `WorkstationTrailTerminalHeader.tsx:107` | Stop, add, and hide actions            | keep with reason | These use shared Button or WorkstationTrailIconButton with accessible names and established compact sizes.                                                                                           | None.                                                  |

Verdict totals: **1 fix**, **3 keep with reason**, **0 abstract**.

## Verification

- Reviewed the production JSX and shared-header call chain: no raw-button, native-button-creation, or clickable-element bypasses introduced.
- Single-terminal fold/expand, transition from multiple terminals to one, and unchanged multiple-terminal controls are covered by WorkstationTrailTerminal.test.ts. Shared header behavior is covered by WorkstationTrailSurface.test.ts.
- On the isolated PR branch, `pnpm test src/engines/TerminalCore/components/TerminalInteractive/__tests__ src/store/ui/__tests__/miniTerminalAtom.test.ts src/store/workstation/codeEditor/terminal/__tests__/terminalAtoms.close.test.ts src/modules/shared/layouts/FocusedChatWorkstationRail/WorkstationTrailTerminal.test.ts src/modules/shared/layouts/blocks/WorkstationTrailSurface.test.ts` passed: **18 files, 177 tests**.
- `pnpm typecheck:fast` passed on the isolated PR branch.
- Desktop visual checks were not run because computer control requires explicit opt-in. The heading reuses the existing workstation trail primitive. Actual theme, viewport, and GPU rendering remain unverified.

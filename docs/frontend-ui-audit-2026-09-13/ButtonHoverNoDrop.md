# My Station button hover audit

Scope: explicit no-drop hover on My Station ports, CI status actions, and PR checks. Session sidebars and all existing shared defaults retain their original treatment.

| Line                                                                                                                    | Element                  | Verdict          | Reason                                                                                                | Suggested change             |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------ | ---------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------- |
| `src/tailwind.css:33`                                                                                                   | No-drop hover token      | fix              | Transparent My Station controls need a semantic fill-2 alias; existing button-hover remains fill-3    | Added button-hover-no-drop   |
| `src/components/Button/presentation.tsx:57`                                                                             | Opt-in Button appearance | fix              | soft-no-drop is explicit; existing soft and all other defaults retain their palette                   | Applied only to port actions |
| `src/modules/WorkStation/shared/StatusBar/PortsStatusMenu.tsx:133`                                                      | Open, Copy, Stop         | fix              | Transparent port controls use the new hover token; Stop overrides only this instance                  | Applied                      |
| `src/modules/WorkStation/shared/StatusBar/CiStatusMenu.tsx:179`                                                         | CI details action        | fix              | Transparent My Station status action used raw fill-2                                                  | Applied semantic alias       |
| `src/modules/WorkStation/CodeEditor/Panels/EditorPrimarySidebar/content/PullRequestContent/detail/PrChecksPanel.tsx:67` | PR check action          | fix              | Transparent My Station sidebar action used raw fill-2                                                 | Applied semantic alias       |
| `src/config/workstation/tokens.ts:83`                                                                                   | Existing sidebar palette | keep with reason | Original button-hover maps to fill-3 in both themes; session and other sidebar callers must retain it | None                         |
| `src/components/ProcessStopButton/index.tsx:32`                                                                         | Shared Stop defaults     | keep with reason | Preserve every other caller; port instance owns its explicit no-drop override                         | None                         |

Verdict totals: **1 fix** (one authorized token sweep; affected sites above), **2 keep with reason**, **0 abstract**.

Verification: TypeScript, targeted Button/Stop/Ports tests, changed-file lint, generated Tailwind CSS inspection, and git diff whitespace check. No computer-control visual verification was run. No runtime lifecycle or persistence changes are introduced by this token sweep.

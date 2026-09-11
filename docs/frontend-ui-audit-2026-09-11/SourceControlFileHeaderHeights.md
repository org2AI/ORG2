# Source Control and file header heights UI audit

Scope: requested 40px → 36px header sweep. Reviewed D1–D5. The global workstation header is already 36px; existing 32px section rows and unrelated 40px panel headers are outside this sweep.

| Line                                                                                 | Element                      | Verdict          | Reason                                                                                                                                                                       | Suggested change |
| ------------------------------------------------------------------------------------ | ---------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `src/config/workstation/tokens.ts:239`                                               | Shared file bar              | keep with reason | Uses h-9 (36px) for inline file/diff and search headers, matching the existing global header. The inline browser URL fallback shares this token and follows the same height. | None.            |
| `src/modules/WorkStation/shared/GitFileList/index.tsx:519`                           | Changed-files header         | keep with reason | Uses the existing SectionHeader height override with h-9, preserving controls and collapse behavior.                                                                         | None.            |
| `src/modules/WorkStation/CodeEditor/SessionReplay/CodePanel/CombinedDiffView.tsx:72` | Replay edit header           | keep with reason | Uses h-9 on the existing sticky button; native keyboard and toggle behavior are unchanged.                                                                                   | None.            |
| `src/modules/WorkStation/CodeEditor/Panels/EditorPrimarySidebar/config.ts:73`        | Code Editor height constants | keep with reason | Tab-row and header dimensions both declare 36px; no virtualized row sizes or content heights were changed.                                                                   | None.            |

Verdict totals: **0 fix**, **4 keep with reason**, **0 abstract**.

The user explicitly requested the cross-file height sweep. Inline FileHeader and the existing shared file-bar token remain the consistency boundary. No new timers, subscriptions, caches or lifecycle behavior. Desktop visual verification was not performed because computer control was not authorized.

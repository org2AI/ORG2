# Dead code cleanup UI audit

| Line                                                                                        | Element                     | Verdict          | Reason                                                                                                                                                   | Suggested change |
| ------------------------------------------------------------------------------------------- | --------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `src/engines/ChatPanel/index.tsx:411` sessionHeaderExtras                                   | Active header controls      | keep with reason | Only the already-commented CLI action is removed; active viewer, participant, fork and raw-session controls are preserved.                               | None             |
| `src/modules/shared/layouts/blocks/BreadcrumbPillNav/index.tsx:37` BreadcrumbPillNavTrigger | Settings breadcrumb trigger | keep with reason | Removes unused wrapper/geometry only. The live forwarded-ref button keeps its markup, tokens, disabled behavior and caller-provided accessibility props. | None             |

Verdict totals: **0 fix**, **2 keep with reason**, **0 abstract**.

D1–D5 checked on retained UI. Deleted files have no remaining UI to restyle. Other edited TSX files only change comments. No new visual pattern or design-system sweep candidate. No screenshots: the removed components were not mounted and the retained markup is unchanged.

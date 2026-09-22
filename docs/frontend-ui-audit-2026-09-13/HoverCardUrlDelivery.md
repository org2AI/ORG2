# Hover card URL presentation audit

| Line                     | Element      | Verdict          | Reason                                                                                                                                                | Suggested change                               |
| ------------------------ | ------------ | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `HoverCardUrlRow.tsx:46` | URL icon row | keep with reason | Local edit uses HoverCardRow directly with the canonical icon size and stroke; appearance and link behavior remain equivalent to the metadata adapter | Retain requested local composition             |
| `LinkHoverCard.tsx:168`  | Copy icon    | fix              | Explicit stroke duplicated the Button-owned icon presentation                                                                                         | Applied: inherit stroke from the shared Button |

Verdict totals: **1 fix**, **1 keep with reason**, **0 abstract**.

Verification: targeted ESLint, full typecheck, and three hover-card Vitest suites passed (11 tests). No desktop screenshots were captured because computer control requires explicit opt-in. No interaction, request, persistence, or lifecycle ownership was changed.

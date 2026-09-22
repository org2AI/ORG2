# PageNotice UI audit

| Line                                      | Element              | Verdict          | Reason                                                                                                                                                   | Suggested change |
| ----------------------------------------- | -------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `src/components/PageNotice/index.tsx:315` | Copy action          | keep with reason | Reuses shared Button with tertiary/soft presentation, small size and iconOnly; localized tooltip and accessible name; appears before the existing action | None             |
| `src/components/PageNotice/index.tsx:320` | Copy glyph           | keep with reason | The 14px shared icon matches the small Button and existing notice glyphs                                                                                 | None             |
| `src/components/PageNotice/index.tsx:300` | Existing pill toggle | keep with reason | Custom layout preserves the compound icon/title expand target and flex geometry; aria-expanded remains intact                                            | None             |

Verdict totals: **0 fix**, **3 keep with reason**, **0 abstract**.

The copy control is implemented once in the shared notice. Inspection of production JSX confirms every action uses shared Button; no native button or substitute clickable element was introduced. No input controls changed.

Verification: both PageNotice test files pass (11 tests), targeted ESLint and `pnpm typecheck:fast` pass. Tests cover copy ordering, nested multiline text, subtitles, titleless notices, success/failure feedback, and independence from Retry. Desktop visual verification was not performed because computer control was not authorized.

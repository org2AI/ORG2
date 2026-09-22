# Skill editor attachments UI audit

| Line                                                                 | Element                      | Verdict          | Reason                                                                                                                                                   | Suggested change |
| -------------------------------------------------------------------- | ---------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `src/scaffold/WizardSystem/variants/Skill/SkillEditorBlocks.tsx:141` | Attachment path              | keep with reason | Shared Input retains its callback and metadata; disabled state prevents renaming an unreadable/binary attachment.                                        | None.            |
| `src/scaffold/WizardSystem/variants/Skill/SkillEditorBlocks.tsx:153` | Remove attachment            | keep with reason | Existing shared icon-only Button supplies icon and tooltip; no new native action element. Removing this draft entry does not delete the source file.     | None.            |
| `src/scaffold/WizardSystem/variants/Skill/SkillEditorBlocks.tsx:163` | Protected attachment warning | keep with reason | PageNotice keeps the attachment visible with its actual read error or binary explanation, using shared semantic colors.                                  | None.            |
| `src/scaffold/WizardSystem/variants/Skill/SkillEditorBlocks.tsx:170` | Editable text attachment     | keep with reason | Existing CodeMirror shell and 150px geometry are preserved for readable text, including empty files. This is an editor boundary, not a plain form input. | None.            |

Verdict totals: **0 fix**, **4 keep with reason**, **0 abstract**.

Changed JSX introduces no raw buttons/inputs or clickable substitutes, literal colors or duplicate scaffold. Production shared control contracts were inspected. Rendered regression tests cover warning versus editable states; native themes/screenshots remain unverified.

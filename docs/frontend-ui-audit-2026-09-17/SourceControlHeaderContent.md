# SourceControlHeaderContent UI audit

| Line                                                                                                     | Element                                   | Verdict          | Reason                                                                                                                                                                         | Suggested change |
| -------------------------------------------------------------------------------------------------------- | ----------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| `src/modules/WorkStation/CodeEditor/Panels/EditorMainPane/components/SourceControlHeaderContent.tsx:231` | Diff mode, refresh, and overflow controls | keep with reason | Uses the shared `DiffViewModeToggle`, `Button`, and Source Control menu components; the reordered children preserve the existing toolbar geometry and shared action styling.   | None.            |
| `src/modules/WorkStation/CodeEditor/Panels/EditorMainPane/components/SourceControlHeaderContent.tsx:254` | Focus-toolbar portal target               | keep with reason | The empty span is the deliberate portal mount for file-specific shared header actions; replacing it with an action primitive would break ownership of the teleported controls. | None.            |

Verdict totals: **0 fix**, **2 keep with reason**, **0 abstract**.

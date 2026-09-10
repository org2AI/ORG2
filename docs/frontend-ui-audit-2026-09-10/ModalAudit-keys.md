# Modal keys UI audit

Implementation follow-up to the modal audit. Scope is this PR only.

| Line                                                                              | Element                 | Verdict          | Reason                                                                              | Suggested change                     |
| --------------------------------------------------------------------------------- | ----------------------- | ---------------- | ----------------------------------------------------------------------------------- | ------------------------------------ |
| `src/scaffold/WizardSystem/variants/KeyVault/components/KeySelectionModal.tsx:52` | Custom backdrop/header  | fix              | Bypassed named dialog, keyboard and overlay behavior                                | Use Modal and the existing footer    |
| `src/scaffold/WizardSystem/variants/KeyVault/components/KeySelectionModal.tsx:52` | Credential option cards | keep with reason | Selectable cards have native button semantics and dynamic credential detail content | Preserve validation and presentation |

Verdict totals: **1 fix**, **1 keep with reason**, **0 abstract**. The fix is implemented; multi-site patterns count once.

Compose the existing Modal with a string title and the existing credential body and PanelFooter. Cover named dialog semantics, selection validation, keyboard focus, Escape, focus restoration, overlay registration and repeated mount/unmount cleanup.

The shared shell changes header spacing, portal placement and overlay stacking to the app defaults. The real Tauri/webview surface, themes and viewport layouts were not visually verified because computer control was not authorized. Shared modal timer/listener cleanup is tested; no CPU/RSS improvement is claimed. No API or persistence changes.

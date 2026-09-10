# ManualSpotlightCreator UI audit

| Line                               | Element            | Verdict          | Reason                                                                           | Suggested change |
| ---------------------------------- | ------------------ | ---------------- | -------------------------------------------------------------------------------- | ---------------- |
| `ManualSpotlightCreator.tsx:47`    | Overlay            | keep with reason | Uses the existing SpotlightShell for portal, backdrop and dismissal              | None             |
| `ManualSpotlightCreator.tsx:57`    | Title and spacing  | keep with reason | Uses theme text and standard spacing utilities; no new arbitrary colors or sizes | None             |
| `CreateProjectView/index.tsx:523`  | Project composer   | keep with reason | Reuses ManualCreateComposer and design-system Button/LaunchButton                | None             |
| `CreateWorkItemView/index.tsx:303` | Work item composer | keep with reason | Reuses the same manual composer and Cancel button in the Spotlight variant       | None             |
| `CreateComposerScaffold.tsx:123`   | Composer variation | keep with reason | Only omits page-specific glow; shared composer chrome remains authoritative      | None             |

Verdict totals: **0 fix**, **5 keep with reason**, **0 abstract**.

Reviewed only this feature diff. Automated component tests passed; native screenshots, theme/viewport inspection and keyboard interaction in Tauri were not run because computer control is not authorized.

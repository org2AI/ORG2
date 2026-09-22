# BranchSwitch UI audit

| Line                                                                     | Element                            | Verdict          | Reason                                                                                                      | Suggested change |
| ------------------------------------------------------------------------ | ---------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------- | ---------------- |
| `src/components/GitDialogs/CheckoutConflictDialog/index.tsx:50`          | Dialog shell                       | keep with reason | Shared Modal owns sizing, focus, keyboard and footer Button behavior                                        | None             |
| `src/components/GitDialogs/CheckoutConflictDialog/index.tsx:144`         | Leave/Bring rows                   | keep with reason | Reuses SelectionGrid vertical/showRadio with visible title and description                                  | None             |
| `src/components/GitDialogs/CheckoutConflictDialog/index.tsx:137`         | Busy state                         | keep with reason | Fieldset and shared controls disabled during execution; no busy dismissal                                   | None             |
| `src/components/GitDialogs/CheckoutConflictDialog/index.tsx:122`         | Changed-file disclosure            | keep with reason | Semantic details/summary with bounded scrolling; not a button substitute                                    | None             |
| `src/components/GitDialogs/SavedChangesDialog/index.tsx:86`              | Snapshot list, preview and actions | keep with reason | Shared Modal/Button, status text, demand-loaded plain-text diff with backend output cap                     | None             |
| `src/components/GitDialogs/SavedChangesDialog/SavedChangesBanner.tsx:81` | Source Control entry               | keep with reason | Shared inline ghost Button and branch-scoped availability state                                             | None             |
| `src/components/GitDialogs/BranchSwitchQuestion.tsx:29`                  | Readiness and blocked questions    | keep with reason | Shared Modal with single-settlement Promise and root cleanup                                                | None             |
| `src/components/ActionCard/index.tsx:319`                                | Existing selectable card           | keep with reason | Shared Button owns compound card layout, keyboard actions and aria-pressed; existing radio indicator reused | None             |

Verdict totals: **0 fix**, **8 keep with reason**, **0 abstract**.

Real Modal/SelectionGrid DOM tests cover descriptions, default/exclusive selection, busy disablement, cancel cleanup and actual-branch/conflict text. Source/AST review found no new native button/input or click-container bypasses. The unchanged SourceControl empty-area selection-clear container is outside this change. Copy is translated in all 13 supported locales; description lines have no terminal punctuation.

Native-window screenshots, light/dark layout and real-window keyboard/focus verification remain unrun because computer control was not authorized.

## CI follow-up

Completed translations for all supported locales, reused the existing `status.loading` key, and removed the unused detached-checkout success key. Saved-change effect refreshes now have explicit, scope-aware rejection handlers. The i18n and typed-lint baselines remain unchanged.

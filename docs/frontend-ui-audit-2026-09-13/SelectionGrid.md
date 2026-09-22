# SelectionGrid UI audit

| Line                                                                 | Element                     | Verdict          | Reason                                                                                                                                                                                                                                    | Suggested change |
| -------------------------------------------------------------------- | --------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `src/scaffold/WizardSystem/primitives/SelectionGrid.tsx:212`         | Shared selection indicators | keep with reason | Leading radios are opt-in through showRadio and reuse ActionCard. Default grids retain their existing trailing checks and surface tokens                                                                                                  | None             |
| `src/scaffold/WizardSystem/variants/Channel/ChannelSections.tsx:582` | Detected credential choices | keep with reason | Uses SelectionGrid with vertical and showRadio as a one-column description list instead of an independent button style. Uses candidate indices for DOM identifiers rather than credential contents. Duplicate-name disabling stays intact | None             |

Verdict totals: **0 fix**, **2 keep with reason**, **0 abstract**.

Only the lower detected-credential rows opt into leading radios. Top auth-method and provider grids keep their previous appearance. No new competing component or global token change was needed. ActionCard retains native button focus, Enter/Space activation and pressed-state semantics; its leading radio is a visual indicator. Credential selection now follows single-choice behavior: clicking the selected option keeps it selected.

Architecture review covers component ownership, single/multiple selection defaults and consumer callback mapping. Persistence, backend wire types, async lifecycle and initialization are unchanged. No new timer, subscription or retained cache is introduced.

Verification: `pnpm test src/scaffold/WizardSystem/primitives/__tests__/SelectionGrid.test.ts src/components/ActionCard/ActionCard.test.ts` — 10 tests passed. `pnpm typecheck:fast` passed. `pnpm exec eslint src/scaffold/WizardSystem/primitives/SelectionGrid.tsx src/scaffold/WizardSystem/primitives/__tests__/SelectionGrid.test.ts src/scaffold/WizardSystem/variants/Channel/ChannelSections.tsx --max-warnings 0` passed. No live desktop visual verification: computer control was not requested.

The independent `vertical` prop overrides column sizing with one shrinkable full-width column and defaults to content-height rows, including options without descriptions. `showRadio` remains independently optional; the default grid appearance is unchanged. Tests cover vertical layout precedence, optional radios and unchanged default pill sizing.

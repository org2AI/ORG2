# AppUpdater UI audit

Scope: update confirmation presentation, compared with SignOutConfirmationModal and the shared ModalSystem. Reviewed all five UI dimensions; no changes to updater scheduling, retained state, downloads, or installation logic.

| Line                                    | Element                                    | Verdict          | Reason                                                                                                                                                                         | Suggested change                                                                                            |
| --------------------------------------- | ------------------------------------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `src/scaffold/AppUpdater/index.tsx:66`  | Modal size and artwork                     | fix              | The previous 620px icon-and-copy layout differed from the illustrated confirmation family.                                                                                     | Applied: medium preset and shared decorative image slot with matching generated artwork.                    |
| `src/scaffold/AppUpdater/index.tsx:74`  | Footer geometry and actions                | fix              | Bespoke padding and large round buttons differed from the shared modal footer.                                                                                                 | Applied: PanelFooter container tokens and small shared Button controls, with standard secondary appearance. |
| `src/scaffold/AppUpdater/index.tsx:108` | Body typography and spacing                | fix              | Extra body padding and icon layout diverged from logout.                                                                                                                       | Applied: default modal body padding and matching text tokens.                                               |
| `src/scaffold/AppUpdater/index.tsx:73`  | Custom footer composition                  | keep with reason | The skip action and its handler are commented out at the user’s request. The two remaining shared Buttons retain the explicit primary focus marker and shared footer geometry. | None.                                                                                                       |
| `src/scaffold/AppUpdater/index.tsx:67`  | Decorative artwork and dismissal semantics | keep with reason | Empty alt avoids repeating localized dialog content. Existing explicit-choice dismissal policy and action handlers are preserved.                                              | None.                                                                                                       |

Verdict totals: **3 fix**, **2 keep with reason**, **0 abstract**. All fixes applied; no cross-file sweep candidates.

Verification:

- `pnpm exec vitest run --config config/vitest.config.ts src/scaffold/AppUpdater/index.test.ts src/scaffold/ModalSystem/ModalSystem.test.ts` — 25 tests passed, including update actions and shared modal artwork.
- `pnpm exec eslint src/scaffold/AppUpdater/index.tsx --max-warnings 0` — passed.
- `pnpm typecheck:fast` — passed.
- `git diff --check -- src/scaffold/AppUpdater/index.tsx` — passed.
- Inspected the complete changed production component and diff: both rendered action controls use shared Button; the disabled skip button remains only in a JSX comment; no native button creation, raw form fields, or clickable substitute elements.
- Visually inspected the final 3:2 artwork against the login-sharing and login-market references: three standing teammates collectively hold an update tile, with matching character rendering, texture, foliage, and palette. No desktop UI control used; live modal layout, theme, and viewport screenshots were not captured under the user's opt-in policy.

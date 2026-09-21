# Illustrated modal titles UI audit

Scope: shared ModalSystem title presentation for image and headerMedia dialogs (login, logout, quit, update), plus concise update copy in all 13 locales. Reviewed D1–D5. This is the shared change explicitly requested by the user; no site-by-site title overrides.

| Line                                     | Element                     | Verdict          | Reason                                                                                                                                                                    | Suggested change                                                                  |
| ---------------------------------------- | --------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `src/scaffold/ModalSystem/index.tsx:472` | Illustrated modal title     | fix              | Compact panel typography gave the illustration dialogs insufficient title hierarchy.                                                                                      | Applied: shared text-lg (18px), semibold title for image and headerMedia dialogs. |
| `src/scaffold/ModalSystem/index.tsx:441` | Header height override      | keep with reason | The shared PanelHeader assumes a fixed toolbar height. Illustrated titles need room to wrap in longer locales, using existing spacing tokens and its custom content slot. | None.                                                                             |
| `src/scaffold/ModalSystem/index.tsx:485` | Footer divider and controls | keep with reason | User explicitly retained the divider. Default and update-specific footer controls continue to use shared Button and footer styling.                                       | None.                                                                             |

Verdict totals: **1 fix**, **2 keep with reason**, **0 abstract**. Fix applied.

Verification:

- `pnpm exec vitest run --config config/vitest.config.ts src/scaffold/ModalSystem/ModalSystem.test.ts src/scaffold/ModalSystem/ModalSystem.status.test.ts src/scaffold/AppUpdater/index.test.ts` — 30 tests passed.
- `pnpm exec eslint src/scaffold/ModalSystem/index.tsx --max-warnings 0` — passed.
- `pnpm typecheck:fast` — passed.
- `git diff --check` — passed.
- Parsed all locale settings JSON and checked both updated descriptions retain exactly one version placeholder — passed.
- Inspected source and diff: no new native buttons, substitute clickable controls, or form fields. Existing modal backdrop click handling remains unchanged.
- Live GUI verification was not performed under the user's explicit computer-control opt-in policy. Typography and wrapping are source-verified; screenshot QA remains unperformed.

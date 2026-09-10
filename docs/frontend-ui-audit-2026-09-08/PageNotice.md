# PageNotice UI audit

| Line                                                                        | Element              | Verdict          | Reason                                                                                                                                                                                   | Suggested change |
| --------------------------------------------------------------------------- | -------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `src/components/PageNotice/index.tsx:35`                                    | Shared surface       | keep with reason | The design-system primitive owns its border, radius, typography, and neutral treatment; it cannot use itself.                                                                            | None.            |
| `src/components/PageNotice/index.tsx:253`                                   | Structured body      | keep with reason | A block container supports lists, diagnostic pre blocks, and action layouts without placing them inside a span.                                                                          | None.            |
| `src/components/PageNotice/index.tsx:151`                                   | Existing consumers   | keep with reason | All active imports, JSX uses, test mocks, identifiers, and skill examples migrate together with no compatibility alias. Existing compact, pill, close, and action APIs remain available. | None.            |
| `src/components/InlineBanner/index.tsx:43`                                  | Panel status strips  | keep with reason | Already reusable and intentionally attached to panel edges; distinct from page-content notice cards.                                                                                     | None.            |
| `src/scaffold/WizardSystem/shared/externalImport/useExternalImport.tsx:427` | Read-only tool badge | keep with reason | A compact table-cell badge with a tooltip, not a page notice. Other remaining semantic-color matches are badges, progress indicators, visualization surfaces, or control states.         | None.            |
| `src/features/Org2Cloud/ImportSharedSessionDialog.tsx:77`                   | Field validation     | keep with reason | Input-specific error linked to its field; a page card would change the form hierarchy. Other field-validation text and full-surface load placeholders retain their owning layouts.       | None.            |

Verdict totals: **0 fix**, **6 keep with reason**, **0 abstract**.

The user authorized the global sweep. Twenty-nine custom notices across 25 files now use this component. Per-consumer reports cover the migrated surfaces; the remaining consumers only change imports, identifiers, or references. Historical audits and archived source retain the name used at the time.

No desktop screenshots were captured: computer control was not requested. Theme, narrow-width, and native app visual checks remain unverified.

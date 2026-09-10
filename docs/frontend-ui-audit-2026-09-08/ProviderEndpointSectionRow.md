# ProviderEndpointSectionRow UI audit

| Line                                                                                             | Element              | Verdict          | Reason                                                                                                      | Suggested change                                |
| ------------------------------------------------------------------------------------------------ | -------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `src/scaffold/WizardSystem/variants/KeyVault/components/setup/ProviderEndpointSectionRow.tsx:64` | Endpoint options     | fix              | User requested content-width tab-pill buttons instead of full-width cards                                   | Reuse TabPill buttonStyle at 36px (implemented) |
| `src/scaffold/WizardSystem/variants/KeyVault/components/setup/ProviderEndpointSectionRow.tsx:64` | Overflow wrapper     | keep with reason | A bounded horizontal scroller keeps longer region lists accessible in narrow views                          | None                                            |
| `src/scaffold/WizardSystem/variants/KeyVault/components/setup/ProviderEndpointSectionRow.tsx:71` | Controlled selection | keep with reason | Empty string preserves no selection for custom endpoints, avoiding TabPill's uncontrolled first-tab default | None                                            |

Verdict totals: **1 fix**, **2 keep with reason**, **0 abstract**.

Only endpoint choices are converted. The shared component covers regional and product endpoint lists; other selection grids retain their established behavior. No new colors or custom button styles. Visual verification not performed because desktop control was not authorized.

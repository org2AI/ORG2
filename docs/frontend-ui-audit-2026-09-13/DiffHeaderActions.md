# DiffHeaderActions UI audit

| Line                                                           | Element                  | Verdict          | Reason                                                                                                                                                                    | Suggested change |
| -------------------------------------------------------------- | ------------------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `src/modules/WorkStation/shared/DiffFileSection/index.tsx:443` | Plain filename           | keep with reason | Navigation is now an explicit action; text clicks still reach the header disclosure                                                                                       | None             |
| `src/modules/WorkStation/shared/DiffFileSection/index.tsx:465` | Copy/open action group   | keep with reason | Shared Button soft appearance, small size, header icon token and 1px spacing; zero-width wrapper and compensated gap avoid reserved space; keyboard focus reveals actions | None             |
| `src/modules/WorkStation/shared/DiffFileSection/index.tsx:506` | Disclosure/count control | keep with reason | Custom shared Button preserves compound tooltip children and overlay geometry; screen-reader labels remain after removing native title tooltip                            | None             |
| `src/modules/WorkStation/shared/DiffSectionList/index.tsx:375` | Diff canvas              | keep with reason | Existing editor canvas token aligns virtualized container and headers                                                                                                     | None             |

Follow-up review: selected filter labels omit counts while dropdown options retain them; scope/filter selects share a 1px group, regular font weight and no intervening separator. The mode labels are Single / All. SourceControlSelectionPlaceholder uses the shared empty/detail-panel/full-height props and retains the original 72px icon size at the user’s explicit request. Empty prompts are selected by the active sidebar category (file, stash, commit, PR or issue), with all 13 locales updated. No new action primitive, timer or subscription was introduced.

Verdict totals: **0 fix**, **4 keep with reason**, **0 abstract**.

Source review: new action controls use shared Button; custom geometry is documented in reusable primitives. Native UI screenshots were not captured because computer control was not requested. Verification commands and outcomes are recorded in the PR.

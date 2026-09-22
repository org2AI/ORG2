# Market mainline integration UI audit

| Line                                                                                               | Element                          | Verdict          | Reason                                                                                                                                         | Suggested change |
| -------------------------------------------------------------------------------------------------- | -------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `src/scaffold/GlobalSpotlight/palettes/UnifiedModelPalette/useUnifiedModelPaletteSelection.ts:248` | Package selection dismissal      | keep with reason | Uses the latest anchored-menu dismissal policy, matching Account Keys; recent selection and variant edits retain their explicit close behavior | None             |
| `src/modules/MobileRemote/components/composer/MobileModelPicker.tsx:194`                           | Mobile model picker              | keep with reason | Retains the new pure ModelSelectorPillView boundary and accessible names without importing desktop credentials into mobile                     | None             |
| `src/modules/MainApp/Settings/sections/HarnessConnections/ConnectionCards.tsx:33`                  | Multiple Package selection cards | keep with reason | Uses shared Button outline variants and aria-pressed; custom layout is needed for the compound title, status and description                   | None             |
| `src/modules/MainApp/Settings/sections/HarnessConnections/AppConnectionPage.tsx:453`               | Default Package/model            | keep with reason | Uses shared Select and its ariaLabel contract, preserving duplicate-Package disambiguation                                                     | None             |

Verdict totals: **0 fix**, **4 keep with reason**, **0 abstract**.

The rebase targets the repository's development trunk, `develop` at
`9bb346483fd206ff7f196d349664e1c2ea3087d8`. The older release `main` is an ancestor.
All 27 paths changed by colleagues since the preceding integration baseline
were independently compared by Git blob hash and retained exactly. The shared
Button interface/presentation and the changed Package controls were inspected;
no raw action-control substitute or new visual component family was introduced.

Replaying commits also required preserving previous merge resolutions:
Package dismissal behavior and tests, the removal of Market-issued identity
sessions, and locale ordering. The resulting tree was compared against an
independently generated clean merge of the previous feature tip and latest
development trunk. They matched exactly before this report was added.

Verification: full `tsgo --noEmit --pretty false`; 20 relevant Vitest files with
136 passing tests; palette ESLint with zero warnings; test placement; normal
commit hooks including `market-connect` Clippy. Existing real native evidence
belongs to the preceding artifact. The rebased artifact still needs its own
build and visual/runtime acceptance; source equality is not that acceptance.

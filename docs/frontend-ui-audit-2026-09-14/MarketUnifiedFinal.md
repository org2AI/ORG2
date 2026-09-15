# Market unified connection UI audit

| Line                                                   | Element                           | Verdict          | Reason                                                                                                                          | Suggested change |
| ------------------------------------------------------ | --------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `src/features/MarketConnect/ConnectionDialog.tsx:167`  | Client connection modal           | keep with reason | Uses `ModalSystem`; busy state blocks conflicting close/configure/disconnect actions and errors use status/alert semantics      | None             |
| `src/features/MarketConnect/ConnectionDialog.tsx:221`  | Listing and model selectors       | keep with reason | Uses the shared `Select`, explicit labels and the modal popup layer; choices come from active purchased capabilities            | None             |
| `src/features/MarketConnect/ConnectionSettings.tsx:91` | Saved connection settings         | keep with reason | Reuses `SectionContainer`, `SectionRow`, shared `Select` and shared `Button`; it loads only for the selected client tab         | None             |
| `src/features/MarketConnect/Org2SessionDialog.tsx:165` | ORG2 workspace modal              | keep with reason | Uses the same modal/control family and keeps purchase loading, empty, failure and disconnect states explicit                    | None             |
| `src/features/MarketConnect/WorkspaceLaunch.tsx:58`    | Folder/client launch action       | keep with reason | Uses shared `Button`, exposes loading/error state and performs no prompt or secret input                                        | None             |
| `src/features/MarketConnect/SellerDialog.tsx:25`       | Seller authorization cancellation | keep with reason | Uses shared `Button`; cancellation remains available while provider approval is pending and is disabled during its own mutation | None             |

Verdict totals: **0 fix**, **6 keep with reason**, **0 abstract**.

The changed production UI contains no raw button, input, textarea or select
elements and introduces no arbitrary color/size values. Full lint passed; 204
targeted tests cover loading, empty, failure, conflict, cancellation,
reauthorization, configuration and launch handoff states. Existing packaged-app
screenshots predate the final develop integration, so visual light/dark,
keyboard and Windows evidence remains part of release acceptance.

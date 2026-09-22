# Mobile content labels UI audit

| Line                                                                                | Element                                                    | Verdict          | Reason                                                                                                                         | Suggested change                                                                                                                     |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `MobileToolCall.tsx:144`, `MobileProfileEntry.tsx:57`, `MobileChangeReview.tsx:113` | Content-bearing button names                               | fix              | One authorized sweep: generic labels override the visible target, current account, status or selected value                    | Include current tool summary/status and account identity; associate dropdown names with their field and rendered value (implemented) |
| `MobileToolCall.tsx:138`                                                            | Custom shared Button layout                                | keep with reason | The tool row has independent title, summary and trailing status columns; shared custom layout preserves this compound geometry | None                                                                                                                                 |
| `MobileProfileEntry.tsx:91`                                                         | Avatar-only profile button                                 | keep with reason | It has no visible text; the translated action label is the appropriate accessible name                                         | None                                                                                                                                 |
| `MobileChangeReview.tsx:108`                                                        | Review dropdown shared Button and native keyboard behavior | keep with reason | Shared Dropdown retains keyboard selection, expanded state and menu cleanup; new useId references only change naming           | None                                                                                                                                 |

Verdict totals: **1 fix**, **3 keep with reason**, **0 abstract**.

## Behavior and verification

Names are produced by the rendered control from current props and translated labels. No persisted or remote data is malformed; no data cleanup is needed. Tool names update as command/status changes; account names follow profile updates and email fallback; dropdown names follow scope/file selection and refreshed manifests. Existing activation, portal cleanup and profile focus restoration remain covered.

- `pnpm test src/modules/MobileRemote/components/transcript/MobileToolCall.test.ts src/modules/MobileRemote/components/profile/MobileProfileEntry.test.ts src/modules/MobileRemote/screens/settings/SettingsTab.test.ts src/modules/MobileRemote/components/changes/MobileChangeReview.panel.test.ts`: 55 tests passed
- Scoped ordinary ESLint passed for all three production files
- Source and diff inspection: all touched actions remain shared Button controls; no native React buttons or clickable substitutes introduced
- No colors, spacing, dimensions, protocol, persistence or background work changed
- Screenshots would not demonstrate accessible-name changes. Mounted DOM tests verify the labels and ID relationships; device VoiceOver remains unverified

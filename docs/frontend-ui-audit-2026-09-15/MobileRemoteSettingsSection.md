# MobileRemoteSettingsSection UI audit

| Line                                                                        | Element                           | Verdict          | Reason                                                                                                                                                                             | Suggested change |
| --------------------------------------------------------------------------- | --------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `src/modules/shared/layouts/SectionLayout/Container.tsx:70`                 | Collapsible section-title control | keep with reason | Delegates title interaction, chevron presentation, and disclosure state to the existing shared `CollapsibleSection` primitive while retaining `SectionContainer` title typography. | None.            |
| `src/modules/MainApp/Settings/sections/MobileRemoteSettingsSection.tsx:255` | ORG2 Cloud login-status row       | keep with reason | Uses the shared responsive `SectionRow`, so signed-in status and the signed-out action both follow the same left/right row contract without duplicating layout styles.             | None.            |
| `src/modules/MainApp/Settings/sections/MobileRemoteSettingsSection.tsx:324` | Advanced settings section         | keep with reason | Uses the new `SectionContainer` title disclosure plus shared `SectionRow`, `Switch`, `Input`, and `Button` controls; no raw control or one-off card pattern was introduced.        | None.            |

Verdict totals: **0 fix**, **3 keep with reason**, **0 abstract**.

# MobileRemoteSettingsSection UI audit

Scope: remove the phone-name input and LAN fallback controls from Mobile Remote settings.

| Line                                                                        | Element                | Verdict          | Reason                                                                                                                                 | Suggested change |
| --------------------------------------------------------------------------- | ---------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `src/modules/MainApp/Settings/sections/MobileRemoteSettingsSection.tsx:348` | Allow-actions row      | keep with reason | Uses the existing SectionRow and Switch; removing the preceding name field requires no new layout or styling                           | None             |
| `src/modules/MainApp/Settings/sections/MobileRemoteSettingsSection.tsx:356` | Relay pairing controls | keep with reason | Reuses Button and MobileRemoteOutdoorPairingDetails, including disabled/loading states; device names are generated when pairing starts | None             |
| `src/modules/MainApp/Settings/sections/MobileRemoteSettingsSection.tsx:382` | Paired-device section  | keep with reason | Existing SectionRow, Placeholder and PairedDeviceList preserve the shared settings layout after removing the trailing LAN section      | None             |

Verdict totals: **0 fix**, **3 keep with reason**, **0 abstract**.

No new raw controls, arbitrary values, colors, dimensions, or repeated UI patterns. Rendered component tests cover automatic naming, full/read-only pairing, pending state, failure/retry, confirmation, login gating, and removal of LAN controls even with a previously enabled setting. No desktop screenshot or real-phone pairing was performed.

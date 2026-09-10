# MobileRemoteSettingsSection performance review

Scope: remove LAN settings UI and its address-query lifecycle; generate phone labels on pairing requests.

| Area               | Verdict | Evidence                                                                                                      | Required change                                                                         | Verification                                                                           |
| ------------------ | ------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Background work    | fix     | The section previously owned a useAsyncData LAN-IP query enabled by mobileRemote.enabled and allowLanExposure | Removed the query, refresh control, address derivation and LAN QR rendering together    | Diff inspection confirms the section no longer calls or imports fetchMobileRemoteLanIp |
| Memory             | keep    | Removed component-local phone-label state and LAN-IP derived values; no new retained resources                | Generate the label at the existing pairInit boundary                                    | Full/read-only rendered pairing tests inspect the request label                        |
| Scope/isolation    | keep    | Existing pairing request generation and unmount invalidation remain in place                                  | No changes to relay identity, request guards, persistence, or backend LAN configuration | Diff review; existing settings tests cover local/production and login gating           |
| Rendering/hot path | keep    | Removed subscriptions to LAN exposure and port; no new timers, listeners or subscriptions                     | None                                                                                    | Rendered tests include previously enabled LAN configuration                            |

Lifecycle: the removed page-owned LAN query and QR tree cannot start on load, remount, visibility return, or identity/endpoint changes. No surviving resource was assigned a new owner or cadence. Backend LAN settings and listener behavior are outside this UI-removal scope.

Verification:

- `pnpm exec vitest run --config config/vitest.config.ts src/modules/MainApp/Settings/sections/__tests__/MobileRemoteSettingsSection.relayPreset.test.ts src/modules/MainApp/Settings/sections/__tests__/MobileRemoteOutdoorPairingDetails.test.ts src/modules/MainApp/Settings/sections/__tests__/pairedDeviceDisplay.test.ts`: 23 tests passed
- `pnpm exec eslint src/modules/MainApp/Settings/sections/MobileRemoteSettingsSection.tsx src/modules/MainApp/Settings/sections/__tests__/MobileRemoteSettingsSection.relayPreset.test.ts`: passed
- `git diff --check`: passed
- Post-rebase `node node_modules/typescript/bin/tsc --noEmit --pretty false` on the stacked activation tip: passed, covering the changed settings files
- Real Tauri/phone pairing and CPU/RSS measurements were not run; no measured performance improvement is claimed

Performance verdict: blocked — the changed resource path is removed, with no new background work, but real pairing and runtime performance measurements remain unverified.

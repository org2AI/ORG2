# Mobile device navigation refactor

## Contract and ownership

Primary navigation is Sessions / Settings. Settings opens Connection & devices with a back action. The existing session computer selector remains available. Device switching still calls `MobileRemoteContext.switchPairedDesktop`; pairing goes through `QRScanScreen` → nav pending config → `ConnectingLiveBridge.connectLive` → existing provider persistence. No new transport or persistence writer.

`screen`, `activeTab`, and `pairingReturnScreen` are reducer-owned transient navigation intent. Device inventory, selected desktop and permissions remain provider-owned facts. Returning from settings keeps the existing session-list instance mounted and inactive; switching desktops retains the existing key-based remount.

| State / event                            | Result / policy                                                                                            | Evidence                                        |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Sessions → Settings → devices → back     | Settings selected; two primary tabs; no dock in subpage                                                    | App navigation test                             |
| Open devices → return to Sessions        | Same mounted session list, inactive while away                                                             | App navigation test counts mounts               |
| Add computer → cancel scan               | Return to devices without disconnecting                                                                    | App navigation + reducer tests                  |
| Add computer → accept → connect succeeds | Return to devices, clear credential-bearing pending intent                                                 | App navigation + reducer tests                  |
| SAS → back → scanner                     | Existing parsed-config back path retained, return destination survives                                     | Reducer trace                                   |
| Switching desktop                        | Existing current row stays readable, competing switches and Add are disabled                               | Device screen tests                             |
| Switch failure → retry                   | Error shown; provider inventory/current remain authoritative                                               | Device screen tests                             |
| Empty inventory                          | Empty notice plus Add computer remain available                                                            | Device screen test                              |
| Connection failure                       | Existing global recovery screen retains retry / pair-again; successful manual recovery returns to Sessions | Existing App recovery tests; protocol unchanged |
| App reload / account replacement         | Existing bootstrap chooses Sessions; transient settings location is not persisted                          | Coordinator unchanged                           |

## Ten-layer review

1. Compilation: TypeScript no-emit and scoped ESLint.
2. Dead code: removed DevicesTab module/type/navigation branch, renamed screen/test, removed optional unwired Settings callbacks/action rows.
3. Naming: ConnectionDevicesScreen now describes a settings destination; no DevicesTab production references remain.
4. Semantics: disconnect is NOT revoke. Existing provider disconnect clears local selection but does not prove remote authorization revoked; no fake revoke control added.
5. Defaults: initial pairing returns to Sessions; adding from devices returns there; back_to_welcome resets pairing return intent.
6. Boundaries: route state stays in reducer, connection work stays in provider, permission label uses protocol tier.
7. Discoverability: one explicit Settings entry and one explicit back path; all actions reachable through production routes.
8. Wire: no API, payload, protocol, credentials or schema changes; no new serialization.
9. Init parity: native and browser consume the same App/coordinator; bootstrap untouched.
10. Resolver symmetry: device inventory/presence derivation unchanged; local permission label now uses actual full/read_only/unknown tier instead of fabricated Full remote / Active now text.

## Performance guard

| Area               | Verdict | Evidence                                                                          | Change or reason kept                                        | Verification                   |
| ------------------ | ------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------ |
| Background work    | keep    | SessionsScreen already gates search/watch by active and visibility                | Subpage passes active=false; no added timer/subscription     | Source trace + navigation test |
| Memory             | keep    | One retained SessionsScreen per current desktop; subpage mounts only on its route | No caches/registries added; nav return enum is constant-size | Mount-count test               |
| Scope/isolation    | keep    | Existing provider owns switch and identity guards                                 | No new credential writer or duplicate switch path            | Existing device switch tests   |
| Rendering/hot path | keep    | No streaming/parser changes; former tab list becomes on-demand subpage            | Existing key reset on desktop change remains                 | App route tests                |

Performance verdict: pass for the navigation lifecycle change; no CPU/RAM improvement claim or new background workload.

## Limits

No remote unpair API exists on the current mobile context. This refactor removes the already-unwired optional revoke prop rather than presenting disconnect as revocation. A remote revoke workflow remains a separate capability. Real successful pairing with another physical desktop was not performed. Simulator UI automation cannot click its window, so new subpage light/dark screenshots remain unverified; tests drive route boundaries and actual Settings/device components separately.

## Verification

- `pnpm test src/modules/MobileRemote/navigation/mobileRemoteNavigation.test.ts src/modules/MobileRemote/MobileRemoteApp.navigation.test.ts src/modules/MobileRemote/MobileRemoteApp.recovery.test.ts src/modules/MobileRemote/screens/settings/SettingsTab.test.ts src/modules/MobileRemote/screens/devices/ConnectionDevicesScreen.test.ts src/modules/MobileRemote/components/SessionDeviceTabs.test.ts src/modules/MobileRemote/screens/SessionsScreen.features.test.ts` — 7 files, 50 tests passed
- `pnpm exec tsc --noEmit --pretty false` — passed
- Scoped `pnpm exec eslint` over changed production/test TS files with `--max-warnings 0` — passed
- Prettier applied to changed TS/SCSS/locale/report files; `git diff --check` passed
- Existing dev webpack compiled successfully; actual iOS simulator app relaunched and screenshot shows Sessions / Settings dock

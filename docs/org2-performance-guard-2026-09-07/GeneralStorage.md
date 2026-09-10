# General settings lifecycle review

| Area               | Verdict | Evidence                                                                                                                                                                              | Change or reason kept                                                                                               | Verification                                        |
| ------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Background work    | fix     | Removed useMonitorMetrics (15/60-second polling, visibility listener, observer), useNetworkSectionData, and useNetworkMonitor (online/offline listeners and global fetch interceptor) | Removed the exclusive page owners and all import paths. The old interceptor did not restore global fetch on unmount | Zero-reference source sweep; typecheck; route tests |
| Memory             | fix     | Removed request records, provider map/listeners, and settings refresh/scanning atoms                                                                                                  | No replacement retained state introduced                                                                            | Source trace and typecheck                          |
| Scope/isolation    | keep    | HTTP preference stays network.httpVersion through updateSettingAtom; shared app-memory and useRegionCheck callers remain                                                              | No persisted data changes; exclusive backend command removals reviewed in SettingsSamplingCleanup.md                | Settings search tests in dev and ordinary mode      |
| Rendering/hot path | keep    | General directly lazy-mounts Storage; HTTP block reads existing settings state                                                                                                        | Storage retains its existing mount scan and cancellation guard                                                      | Storage test; no real desktop measurements          |

Lifecycle matrix: General idle mounts no monitor; Storage mount owns its existing one-time scan, and unmount discards late mount-scan results. RAM/network page listeners, timers, interceptor, and frontend request paths are deleted for visible/hidden, open/closed, and dev/non-dev states. No provider ingestion or identity behavior changed. Shared runtime monitoring remains; exclusive VPN/tool-process commands are removed as detailed in SettingsSamplingCleanup.md. Restart/reload is required to unload a fetch wrapper installed by an older running build.

Verification:

- `pnpm test src/config/mainAppPaths.test.ts src/config/settingsNavigation.test.ts src/config/settingsSearch.test.ts src/modules/MainApp/Settings/__tests__/StorageSection.browserStorage.test.ts src/scaffold/GlobalSpotlight/hooks/features/__tests__/spotlightActionDefinitions.navigation.test.ts src/scaffold/GlobalSpotlight/hooks/features/__tests__/spotlightActionDefinitions.settings.test.ts` — 26 tests passed
- `pnpm typecheck:fast` — passed
- Targeted ESLint on changed surviving TypeScript/TSX files — passed
- Scoped `git diff --check` — passed

Performance verdict: blocked for real desktop lifecycle measurements (computer control requires explicit user opt-in). Deletion and ownership verified through source and automated checks; no measured CPU/RAM improvement claimed. Live visible/hidden idle and repeated open/close checks were not run.

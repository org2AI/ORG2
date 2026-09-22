# Update localization verification

The updater notification service and download components emitted English literals directly. All application-authored check, download, install, success/failure, retry, tooltip, accessibility, and action-result messages now resolve translation keys at notification creation or render time. Added 25 keys to each of the 13 supported locales. Existing settings, sidebar, start-page, spotlight, and CLI-update-alert settings keys were checked without fallback.

Raw operating-system/plugin diagnostics, logs, protocol event names, and action discovery metadata remain intact. Known download timeouts, unsupported local installation, and unknown-error fallback are localized. No persisted data needs remediation; notification content is transient. Existing notifications acquire translated strings when next emitted/rendered, rather than through a new language listener.

## Performance guard

| Area               | Verdict | Evidence                                                                                                              | Change or reason kept                                                                                  | Verification                                                                                         |
| ------------------ | ------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Background work    | keep    | Mounted AppUpdater owns the scheduler; 10-second startup delay, existing interval/foreground/retry policy and cleanup | No timers, listeners, requests, or scheduling changes                                                  | Scheduler and service tests cover hidden/foreground/online/retry behavior and repeated mount cleanup |
| Memory             | keep    | Existing progress atom and persistent notification ID; no new retained collections                                    | Translation lookup uses the existing active-language resource store                                    | Progress notice identity and collapse tests remain green                                             |
| Scope/isolation    | keep    | No changes to coordinator, provenance cache, install ownership, or persisted reminders                                | Localization stays at the presentation boundary                                                        | Both install strategies and reminder/single-flight tests pass                                        |
| Rendering/hot path | keep    | Existing 250ms progress throttle; translation occurs after throttling                                                 | No added subscriptions or work while idle/hidden; labels computed only when already rendering/emitting | Existing progress coalescing test and localized progress rendering tests pass                        |

Lifecycle scope: startup, idle, active progress, hidden/visible transitions, offline/retry, and stop/repeated mount are covered by the existing updater suites. Account, organization, source-ingestion and cross-machine transport matrices are not applicable to this text-only change. No CPU/RSS improvement is claimed. No live GUI control or screenshots were performed under the user's opt-in policy.

Performance verdict: pass for the localization delta; existing background ownership and throttling are unchanged and remain covered by tests.

## Verification

- `pnpm exec vitest run --config config/vitest.config.ts src/scaffold/AppUpdater` — 84 tests passed before the final added automatic-retry case.
- `pnpm exec vitest run --config config/vitest.config.ts src/scaffold/AppUpdater/service.test.ts src/scaffold/AppUpdater/localization.test.ts` — 46 tests passed after adding automatic-retry coverage and start-page/spotlight locale checks (85 updater tests covered across the final runs).
- Chinese tests exercise actual check/available/download-timeout/retry/install/restart/separate-install/unsupported-install/unknown-error notification boundaries and rendered progress/accessibility labels.
- Locale tests verify all update keys without fallback in every supported language, matching interpolation placeholders and preserving versions, bytes, and paths.
- `node scripts/quality/check-missing-i18n-keys.mjs --namespace settings --prefix update` — zero missing keys.
- `pnpm typecheck:fast` — passed.
- ESLint on all changed production and test files — passed; the two subsequently amended test files rechecked.
- `git diff --check` — passed.
- Source and diff inspection found no remaining application-authored English literals in update notification titles, bodies, actions, progress labels, or tooltip/accessibility strings. Shared Button controls are retained; no native button or clickable substitute introduced. UI audit skipped under its copy/i18n-only exclusion.

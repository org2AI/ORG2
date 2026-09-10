# Onboarding discovery lifecycle review

Verdict: no new background work or unbounded retained state in the discovery feature.

| Resource                             | Start / active                                                   | Idle / hidden / offline               | Close / repeated open / shutdown                                                                     |
| ------------------------------------ | ---------------------------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Application tutorial-event listener  | Dev-only OnboardingHost opens modal                              | No polling or network request         | Effect removes listener on disabling dev mode or owner unmount                                       |
| Modal focus/overlay ownership        | Shared Modal acquires while visible                              | No new timers, scans or subscriptions | Synchronous close releases dialog before destination launch; Escape/reopen covered by rendered tests |
| Discovery cards and feature registry | Static bounded metadata; destinations run only on click          | No release-feed fetching              | No persisted completion or dismissal state                                                           |
| Retired sidebar guide                | Removed milestone selectors and writers                          | No guide work remains                 | No progress listener or delayed guide transition retained                                            |
| Login artwork                        | Existing media element behavior retained during ownership rename | Visibility behavior unchanged         | React owns media element lifetime; no new timer introduced                                           |

Identity, endpoint and organization changes are handled by existing destination owners; discovery retains no identity-specific cache. Tests cover seven modal lifecycle/action cases plus the account menu close-before-open event. Runtime CPU/RAM and real desktop focus were not measured; no measured performance improvement is claimed.

Follow-up: host transition test covers disabled → enabled → open → disabled → ignored event → re-enabled closed → open. No new polling or retained cache. Verdict unchanged.

Final cleanup removes obsolete dashboard navigation and station-mode effects belonging only to deleted steps. Remaining scheduler/listener ownership is unchanged. Credential import retains the existing hook behavior; no performance improvement is claimed.

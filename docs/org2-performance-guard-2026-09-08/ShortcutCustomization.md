# Shortcut customization lifecycle review

| Area               | Verdict | Evidence                                                                                                            | Change or reason kept                                                                                                                       | Verification                                       |
| ------------------ | ------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Background work    | keep    | Existing keyboard listeners; one shared storage listener while subscribers exist                                    | No polling/timers/workers added; recorder keydown/blur listeners are removed on cancel, save, OS switch, and unmount                        | Recorder interaction and storage unsubscribe tests |
| Memory             | keep    | Three platform maps limited to known commands; fixed default cache; native allowlists; one shared embedded snapshot | No per-session cache; native update coordinator retains one in-flight operation and one latest snapshot                                     | Ingestion validation and 30-update coalescing test |
| Scope/isolation    | keep    | Platform-keyed local profile preferences; chat focus ownership remains separate from global handlers                | Cross-window storage event refresh; no organization/session/remote data access added                                                        | Platform isolation and chat-pane ownership tests   |
| Rendering/hot path | keep    | Shortcut hook snapshots are resolved strings; static gestures do not subscribe                                      | Memoized pills update only when their displayed chord changes; ordinary unmodified typing skips the global action map; defaults parsed once | Mounted-tooltip and global-dispatch tests          |

## Lifecycle matrix

- Start/restart: local preferences read before resolution; native menu updates on global-hook mount; inline creation/page load read the same native snapshot
- Idle/hidden/offline: no scheduled work; no network dependency
- Active edits: one active recorder; IME/modifier-only/repeated keys ignored; native accelerators suspended while recording; native updates coalesced
- Cancel/blur/OS switch/unmount: recorder listeners and recording flag released; native accelerators restored
- Cross-window preference update: storage event rereads sanitized values
- Identity/session/deletion/provider ingestion: not applicable to local keyboard preferences
- Native multi-window rebuild and OS-level interception: compiled and structurally reviewed, not exercised in live Tauri

88 focused shortcut tests pass and native system_services/browser compilation passes. Actual visible/hidden CPU, RSS, native menu behavior, and all three OS runtime paths were not measured because computer control was not authorized. No runtime performance improvement is claimed.

Performance verdict: blocked — real-app lifecycle/CPU validation and Windows/Linux runtime coverage remain unverified; automated resource/dispatch checks pass.

Push-to-talk continuation: both composer surfaces use one shared hook. Listener attachment depends on container/enabled state, not voice-state renders. The active chord is bounded to one press; key release, blur, disable, and unmount release capture. A mounted React test verifies rerender retention, repeats, recording suppression, modifier release, blur, and disable cleanup. No additional polling, caches, or native work is introduced.

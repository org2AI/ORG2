# MobileTurnBody UI audit

| Line                                                                    | Element                          | Verdict          | Reason                                                                                                                                                                                                                             | Suggested change |
| ----------------------------------------------------------------------- | -------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `src/modules/MobileRemote/components/transcript/MobileTurnBody.tsx:107` | Work summary disclosure          | keep with reason | Shared Button supplies keyboard and button semantics. Custom layout is required for the full-width label with a trailing chevron; ghost appearance reuses theme colors. Expanded state and controlled content are named with ARIA. | None             |
| `src/modules/MobileRemote/mobileViewport.scss:18`                       | Summary spacing and touch target | keep with reason | Uses existing mobile spacing, typography and 44px touch tokens; divider and text use shared semantic colors.                                                                                                                       | None             |
| `src/modules/MobileRemote/components/transcript/MobileTurnBody.tsx:28`  | Duration formatting              | keep with reason | Reads authoritative round metadata and reuses Desktop's duration formatter. Missing timing shows work details without inventing a duration.                                                                                        | None             |

Verdict totals: **0 fix**, **3 keep with reason**, **0 abstract**.

## Behavior and ownership

The existing mobile round index supplies status, duration and timestamps. SessionChatScreen forwards the selected round, not the latest round. No network, persistence or wire format changes are required. Completed rounds default to folded work with the final agent reply retained; failed/interrupted rounds default to expanded. After the 2026-09-17 correction, manual collapse hides all work rows, including failed tools; expanding restores the full ordered transcript. Active, unknown and legacy multi-round snapshots remain expanded. An answer-only round has a static timing label because there is nothing to expand.

Expansion is local component state keyed by authenticated resource, session and selected round. It survives updates to that round and resets on scope change. Manual toggles pause existing tail-follow frames so expanding details does not jump the reader to the bottom. Existing scroll input, a new submitted turn and the scroll-to-bottom control retain their original resume behavior.

## Lifecycle / performance review

| Area               | Verdict | Evidence                                                      | Change or reason kept                                                                                             | Verification                                                                 |
| ------------------ | ------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Background work    | keep    | No new polling, network calls, observers or timers            | Reuses the mounted transcript's resize observer; pending follow and measure frames are cancelled on manual toggle | Rendered scroll-anchor regression                                            |
| Memory             | keep    | One optional boolean per mounted selected round               | No growing collapse map or retained hidden React rows                                                             | Session/round switch tests                                                   |
| Scope/isolation    | keep    | Authenticated image resource scope plus session and round key | Old expansion intent does not carry into another scope                                                            | Selected-round parent plumbing and scope-switch regressions                  |
| Rendering/hot path | keep    | Linear projection over the existing bounded transcript        | Hidden work rows are not mounted; no extra history fetch                                                          | Streaming/completion, tool details, failed work and tool-only rendered tests |

## Verification

Targeted ChatTranscript, SessionChatScreen and mobile browser-boundary suites; TypeScript, changed-file ESLint, Prettier and diff checks. Actual iOS app connected to the real desktop and rendered a completed historical reply. Full chevron/light-theme visual verification was interrupted by the simulator UI automation returning `noWindowsAvailable`; this is an outstanding manual check, not evidence of a passing visual audit.

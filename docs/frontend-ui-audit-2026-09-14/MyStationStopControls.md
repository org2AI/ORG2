# My Station stop controls UI audit

Scope: requested stop-icon and terminal danger presentation changes across the three controls below. Reviewed shared Button props/presentation and the changed controls for D1–D5; existing surrounding layout is outside this presentation-only change.

| Line                                                                                           | Element                              | Verdict          | Reason                                                                                                                                                        | Suggested change |
| ---------------------------------------------------------------------------------------------- | ------------------------------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `src/components/ProcessStopButton/index.tsx:27`                                                | Shared terminal and port stop action | keep with reason | Uses shared Button danger/soft presentation and StopCircleIcon; preserves sizes, accessible label, tooltip, loading/disabled state and propagation guard      | None             |
| `src/modules/shared/layouts/FocusedChatWorkstationRail/WorkstationItemRow.tsx:145`             | My Station terminal row stop         | keep with reason | Uses shared Button danger/soft presentation matching Source Control discard and StopCircleIcon with existing focus/hover visibility, menu semantics and label | None             |
| `src/modules/shared/layouts/FocusedChatWorkstationRail/WorkstationTrailTerminalHeader.tsx:101` | Docked terminal stop                 | keep with reason | Uses shared Button danger/soft presentation matching Source Control discard and StopCircleIcon; preserves active-session handler and accessible label         | None             |

Verdict totals: **0 fix**, **3 keep with reason**, **0 abstract**.

All requested changes are applied. No new raw button, native button creation, substitute clickable control, form field, hardcoded color, or repeated styling abstraction was introduced. Compact stop controls retain 14px icons; the large terminal header control uses HEADER_ICON_SIZE.md (16px), matching its adjacent info icon. Source and diff inspection only; desktop visual verification was not performed because computer control was not requested.

Follow-up: shared `BUTTON_VARIANT.danger` and `dangerNoDrop` now use `text-danger-6` at rest, preserving their existing hover/focus fills. This intentionally also updates Source Control discard and other consumers of these semantic tokens. Button regression coverage checks the resting class for both appearances and preserves disabled behavior. No new control or per-site style override was added.

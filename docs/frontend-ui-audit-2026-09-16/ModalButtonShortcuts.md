# Modal button shortcuts UI audit

| Line                                                    | Element                    | Verdict          | Reason                                                                                                                                                                               | Suggested change |
| ------------------------------------------------------- | -------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| `src/components/Button/presentation.tsx:350`            | Trailing shortcut hint     | keep with reason | Uses shared KeyboardShortcut and hides decorative hints from assistive technology; the button exposes aria-keyshortcuts separately. Empty hints and icon-only actions omit the hint. | None.            |
| `src/components/KeyboardShortcut/index.tsx:372`         | Inline shortcut dimensions | keep with reason | The shared primitive owns the 11px text and 12px glyph dimensions; the inline variant removes cap padding and inherits the action color.                                             | None.            |
| `src/modules/shared/layouts/blocks/PanelFooter.tsx:116` | Footer action hints        | keep with reason | Both footer action paths pass shared Button props without introducing native controls or duplicated shortcut rendering.                                                              | None.            |
| `src/scaffold/ModalSystem/variants/Quit/index.tsx:68`   | Quit and Cancel actions    | keep with reason | Uses the shared modal footer, declares Enter/Escape metadata, and leaves keyboard ownership with the existing composition-aware capture handler.                                     | None.            |

Verdict totals: **0 fix**, **4 keep with reason**, **0 abstract**.

Source inspection of changed production controls found no new raw buttons, native button creation, or clickable substitutes. The existing native button in Button is the shared primitive itself. No form fields were introduced.

## Lifecycle review

| Area               | Verdict | Evidence                                                                                              | Change or reason kept                                                                          | Verification                                                                         |
| ------------------ | ------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Background work    | keep    | Quit owns a capture keydown listener only while open; Modal owns its optional bubble Escape listener. | Disable the latter for Quit so composition handling has one owner; no polling or timers added. | Quit tests cover Enter/Escape exactly once, composition, close, reopen, and unmount. |
| Memory             | keep    | Effect removes the same handler on close/unmount.                                                     | No new retained collections or asynchronous work.                                              | Three reopen cycles and post-unmount dispatch remain inert.                          |
| Scope/isolation    | keep    | Local open-state atom and existing quit/cancel commands.                                              | No network, identity, provider ingestion, or cross-instance state changes.                     | Existing command routing verified by mocked Tauri invocation.                        |
| Rendering/hot path | keep    | Optional hint renders only for nonempty shortcuts on non-icon-only actions.                           | Shared shortcut renderer owns presentation; no new event handling in Button.                   | Button and KeyboardShortcut tests.                                                   |

Lifecycle matrix: closed/idle has no Quit listener; open/active owns one; close and unmount remove it; reopening does not accumulate handlers. The existing open listener is event-driven in visible/hidden states and introduces no recurring idle work. Network, account, session ingestion, and transport dimensions are not changed.

Verification: 58 tests passed across Button, KeyboardShortcut, ModalSystem, modal status, and Quit suites. Desktop rendering, hidden-window behavior, CPU/RSS measurements, and real Tauri execution were not run because computer control was not authorized. Performance verdict: blocked for those real-app checks; automated listener lifecycle checks passed. No runtime performance improvement is claimed.

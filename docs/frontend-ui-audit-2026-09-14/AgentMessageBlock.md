# AgentMessageBlock UI audit

| Line                                                                    | Element                | Verdict          | Reason                                                                                                                                                            | Suggested change |
| ----------------------------------------------------------------------- | ---------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `src/engines/ChatPanel/blocks/AgentMessageBlock/index.tsx:192`          | Existing ExpandOverlay | keep with reason | Same component, existing expand/collapse translations, chat-pane fade, geometry and shared FloatingExpandPill/Button; the callback now loads an unloaded response | None             |
| `src/engines/ChatPanel/blocks/AgentMessageBlock/index.tsx:170`          | Overlay availability   | keep with reason | Only explicitly truncated response text forces the existing load/expand control; complete responses retain the original 480px height rule                         | None             |
| `src/engines/ChatPanel/ChatHistory/renderers/GroupItemRenderer.tsx:433` | Stable turn context    | keep with reason | Session/turn identity preserves expansion across the preview-to-full-event replacement without adding visible UI                                                  | None             |

Verdict totals: **0 fix**, **3 keep with reason**, **0 abstract**.

No new action controls, labels, hint text, or input elements were introduced. Source inspection confirms the action still renders through ExpandOverlay → FloatingExpandPill → shared Button; no raw button or clickable-element substitute was added. Both ActivityRouter's assistant shortcut and the registered agent-message renderer pass the unloaded-turn metadata into the same block.

Rendered DOM tests cover the original overlay, its existing labels, one-click load/expansion, ordinary loaded-message expansion, collapse, and retry. Real Tauri visual QA was not run because desktop control was not authorized.

Simplification follow-up: both assistant renderers now pass `truncatedResponseTurn`, parsed by `readTruncatedResponseTurn`. The shared shape is `MessageTurnIdentity`, since it also identifies a hydrated reply. Reply-key serialization is owned by the expansion hook. Overlay JSX, presentation props, labels, and shared Button ownership are unchanged; verdict totals remain 0 fix / 3 keep with reason / 0 abstract.

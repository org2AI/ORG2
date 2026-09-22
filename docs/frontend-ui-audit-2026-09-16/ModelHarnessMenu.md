# Model harness menu UI audit

| Line                                                           | Element                              | Verdict          | Reason                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Suggested change |
| -------------------------------------------------------------- | ------------------------------------ | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `src/components/ModelSelectorPill/ModelSettingsMenu.tsx:176`   | Current harness and trailing chevron | keep with reason | Uses the same shared tertiary Button as Switch model, with a vertically centered 14px harness icon before the name and the same right chevron as Switch model after it. Compact actions share one row separated by a decorative border-token divider. The panel and action buttons use content width, keeping full labels visible without ellipsis; native disabled behavior and translated accessible labels remain. Reused in compact and advanced views. | None             |
| `src/components/ModelSelectorPill/index.tsx:299`               | Shared model-menu entry              | keep with reason | Enabled model pills consistently open ModelSettingsMenu; unsupported effort controls are omitted. Disabled controls preserve prerequisite messaging. No new per-caller popup implementation.                                                                                                                                                                                                                                                                | None             |
| `src/engines/ChatPanel/InputArea/components/ModelPill.tsx:409` | Harness action ownership             | keep with reason | Existing conversation binding and picker own switching. Removing the standalone pill is an explicit user request; the replacement menu action uses the same handler and a stable model-pill anchor.                                                                                                                                                                                                                                                         | None             |

Verdict totals: **0 fix**, **3 keep with reason**, **0 abstract**.

Reviewed shared controls, spacing/color tokens, accessibility, and duplication. No raw production buttons or substitute clickable elements were introduced. Model selection and harness selection retain separate authoritative write paths. No persistence or wire format changes.

## Lifecycle review

| Area               | Verdict | Evidence                                                                                                      | Change or reason kept                                                                                  | Verification                                                          |
| ------------------ | ------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| Background work    | keep    | Existing dropdown engine gates resize/scroll/pointer listeners on open and cancels frames/timeouts on cleanup | One compact menu per enabled pill; harness action closes it before opening the existing harness picker | Repeated open/close listener and overlay test                         |
| Memory             | keep    | Menu retains only bounded open, advanced-view, and preview state                                              | No cache, poll, worker, or growing collection added                                                    | Test teardown checks zero pending timers and overlays                 |
| Scope/isolation    | keep    | Pending harness selection remains owned by session ID in ModelPill                                            | Existing session-change reset and authoritative resolved-target projection retained                    | Conversation-switch and pending-runtime resolution tests              |
| Rendering/hot path | keep    | Shared ModelSettingsMenu replaces inconsistent direct-picker entry                                            | No new streaming subscriptions; optional slider only for editable effort                               | Empty-model, non-editable model, speed-only, and harness-switch tests |

Performance verdict: pass for the changed menu lifecycle. No CPU/RAM improvement claim or provider/sync behavior change.

## Verification

- Targeted ESLint over the five changed model-menu/component test files passed
- `pnpm exec vitest run --config config/vitest.config.ts src/components/ModelSelectorPill/ModelSelectorPill.test.ts src/engines/ChatPanel/InputArea/components/ModelPill.test.ts src/engines/ChatPanel/InputArea/components/ModelPill.memberOwnership.test.ts`
- `pnpm typecheck:fast` passed
- Targeted suite: 21 tests passed
- In-app visual verification was not run; computer control was not authorized

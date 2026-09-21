# Effort control UI audit

| Line                                                          | Element           | Verdict          | Reason                                                                                                                                                                                    | Suggested change |
| ------------------------------------------------------------- | ----------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `src/components/ModelPropertiesDropdown/EffortSlider.tsx:134` | Two-level tabs    | keep with reason | Reuses SegmentedTextPill and its shared Buttons, pressed-state semantics, theme tokens, and keyboard activation. The existing onChange callback remains the sole commit path.             | None             |
| `src/components/ModelPropertiesDropdown/EffortSlider.tsx:184` | Multi-level range | keep with reason | Native range is the existing browser-specific input boundary for pointer capture and accessible slider semantics. Lowest-level decoration is removed without changing selection behavior. | None             |

Verdict totals: **0 fix**, **2 keep with reason**, **0 abstract**.

## Performance guard

| Area               | Verdict | Evidence                                                                                                     | Change or reason kept                                                                                                      | Verification                                                   |
| ------------------ | ------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Background work    | keep    | shouldAnimate requires more than two levels, non-first selected/preview index, and the existing animate flag | No particles or visibility listener at the first level or in tab mode; hidden documents retain the existing pause behavior | Lowest-to-higher-to-lowest transition and hidden/visible tests |
| Memory             | keep    | Bounded particle list and one scoped visibility listener                                                     | Removes the listener when motion becomes ineligible and on unmount                                                         | Cleanup and repeated-reopen tests                              |
| Scope/isolation    | keep    | Level changes still use the caller-owned value and onChange                                                  | No persistence, identity, provider, or sync changes                                                                        | Existing pointer/keyboard commit and cancellation tests        |
| Rendering/hot path | keep    | Existing local drag preview selects the animation gate                                                       | First-level preview suppresses particles immediately; tab presses commit only changed levels                               | Shared effort and menu tests                                   |

Performance verdict: pass for the changed lifecycle; no CPU/RAM measurements or improvement claim.

Verification: targeted ESLint passed; 28 tests passed across EffortSlider and ModelSelectorPill. No desktop visual verification was performed because computer control was not authorized.

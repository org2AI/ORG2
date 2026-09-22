# PortsStatusMenu UI audit

Scope: port-row buttons in the workspace and external sections. Fixes applied in this implementation pass.

| Line                                                               | Element                 | Verdict          | Reason                                                                                                                                                                              | Suggested change                                                  |
| ------------------------------------------------------------------ | ----------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `src/modules/WorkStation/shared/StatusBar/PortsStatusMenu.tsx:133` | Open-in-browser button  | fix              | Inline button duplicated shared sizing and hover treatment                                                                                                                          | Applied: shared `Button`, tertiary/soft-no-drop, mini, icon-only  |
| `src/modules/WorkStation/shared/StatusBar/PortsStatusMenu.tsx:153` | Copy-address button     | fix              | Same inline presentation; decorative icon lacked explicit aria-hidden                                                                                                               | Applied: shared `Button` with matching props and aria-hidden icon |
| `src/modules/WorkStation/shared/StatusBar/PortsStatusMenu.tsx:174` | Stop-process button     | keep with reason | Already uses reusable `ProcessStopButton`, which owns loading, disabled state, and event propagation; its port instance selects no-drop hover while retaining the danger foreground | None                                                              |
| `src/modules/WorkStation/shared/StatusBar/PortsStatusMenu.tsx:148` | Action icon sizing      | keep with reason | Uses the shared dropdown icon-size token                                                                                                                                            | None                                                              |
| `src/modules/WorkStation/shared/StatusBar/PortsStatusMenu.tsx:138` | Accessible action names | keep with reason | Both shared buttons retain translated aria-label/title and native keyboard semantics                                                                                                | None                                                              |

Verdict totals: **2 fix**, **3 keep with reason**, **0 abstract**.

No new abstraction or global token change is needed: both sections already reuse `PortRow`. No lifecycle or data-flow changes in this button conversion. Visual verification was not run because computer control was not authorized.

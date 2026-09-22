# PortsStatusMenu UI audit

Scope: port-row action presentation. Reviewed shared Button props and presentation plus changed production controls across D1–D5. No lifecycle, polling, or retained-state changes.

| Line                                                               | Element                               | Verdict          | Reason                                                                                                                                        | Suggested change |
| ------------------------------------------------------------------ | ------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `src/modules/WorkStation/shared/StatusBar/PortsStatusMenu.tsx:133` | Open browser and copy address actions | keep with reason | Shared Button tertiary/soft-no-drop props provide the requested lighter hover fill, with existing mini geometry and accessible labels         | None             |
| `src/modules/WorkStation/shared/StatusBar/PortsStatusMenu.tsx:174` | Stop process action                   | keep with reason | ProcessStopButton forwards soft-no-drop appearance to shared Button; removed forced hover/focus class overrides so danger tokens own the fill | None             |
| `src/components/ProcessStopButton/index.tsx:16`                    | Shared stop appearance prop           | keep with reason | Restricts callers to the two supported compact appearances and retains the existing soft default for other callers                            | None             |

Verdict totals: **0 fix**, **3 keep with reason**, **0 abstract**.

No raw buttons, native button creation, substitute clickable controls, form fields, or new hardcoded geometry/colors were introduced. Existing process loading, click propagation and accessibility behavior remain intact. Desktop visual verification was not performed because computer control was not requested.

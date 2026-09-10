# Component dependency helpers UI audit

| Line                                                                           | Element                         | Verdict          | Reason                                                                                                                           | Suggested change |
| ------------------------------------------------------------------------------ | ------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `QueuedMessages.tsx:40`                                                        | Shared drag signal              | keep with reason | Only the ownership/import boundary moves; existing dnd-kit handlers, queue rows and composer chrome are preserved                | None             |
| `ForkSessionSetupDialog/index.tsx:20`, `ForkCheckoutPickerDialog/index.tsx:20` | Fork dialog request state       | keep with reason | Both dialogs keep the same Modal, Select, buttons, form state and request resolution behavior; requests are now owned outside UI | None             |
| `WebUrlBar/index.tsx:34`, `WebViewportContent/index.tsx:16`                    | URL focus helper                | keep with reason | Existing URL toolbar and double-animation-frame focus timing are retained; no new controls, layout or theme values               | None             |
| `unifiedCustomFlatExtras.tsx:23`                                               | Custom model row naming helpers | keep with reason | Input/ModelIcon presentation and placeholder naming semantics are unchanged; only pure naming functions moved                    | None             |

Verdict totals: **0 fix**, **4 keep with reason**, **0 abstract**.

No screenshots were taken: these four changes preserve the rendered JSX and only relocate non-visual dependencies. Desktop UI control was not authorized. Loading/error UI for the separate hover-card change is covered in its own report.

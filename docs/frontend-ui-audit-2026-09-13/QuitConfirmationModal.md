# QuitConfirmationModal UI audit

| Line                                                  | Element               | Verdict          | Reason                                                                                                             | Suggested change |
| ----------------------------------------------------- | --------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------- |
| `src/scaffold/ModalSystem/variants/Quit/index.tsx:59` | Modal shell and image | keep with reason | Uses the same shared medium Modal and bounded decorative image slot as logout; no custom image sizing or new shell | None             |
| `src/scaffold/ModalSystem/variants/Quit/index.tsx:67` | Confirmation footer   | keep with reason | Uses Modal's shared PanelFooter for localized Cancel and Quit actions; standard non-danger primary treatment       | None             |
| `src/scaffold/ModalSystem/variants/Quit/index.tsx:71` | Body typography       | keep with reason | Uses text-sm and text-text-2 tokens matching logout, without arbitrary font size                                   | None             |
| `src/scaffold/ModalSystem/variants/Quit/index.tsx:31` | Keyboard behavior     | keep with reason | Existing Enter/Escape behavior is preserved; shared Modal owns focus trapping, artwork has empty alt text          | None             |

Verdict totals: **0 fix**, **4 keep with reason**, **0 abstract**.

Artwork was visually inspected against the existing logout and login sharing images. No desktop UI control was used. Shared modal tests cover image placement, decorative alt text, confirmation actions and focus behavior; native app appearance was not manually verified.

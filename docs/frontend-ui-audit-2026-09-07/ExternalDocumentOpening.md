# External document opening UI audit

| Line                             | Element            | Verdict          | Reason                                                                          | Suggested change |
| -------------------------------- | ------------------ | ---------------- | ------------------------------------------------------------------------------- | ---------------- |
| `DocumentOpenMenu/index.tsx:116` | Placeholder action | keep with reason | Reuses SplitButton and the Placeholder ButtonProps API, default medium size     | None             |
| `DocumentOpenMenu/index.tsx:68`  | Dropdown           | keep with reason | Uses shared Dropdown, bottom-start anchor and minimum width equal to the button | None             |
| `DocumentOpenSubmenu.tsx:1`      | Header menu        | keep with reason | Reuses ActionSubmenu; unavailable actions are omitted as explicitly requested   | None             |
| `ApplicationIcon.tsx:1`          | App artwork        | keep with reason | Shared mapping with decorative images and ExternalLinkIcon fallback             | None             |

Verdict totals: **0 fix**, **4 keep with reason**, **0 abstract**.

Source and jsdom review only. Desktop screenshots, theme/viewport checks and native app launches were not performed because Computer Use was not authorized.

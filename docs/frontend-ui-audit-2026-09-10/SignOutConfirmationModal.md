# SignOutConfirmationModal UI audit

Scope: shared desktop logout confirmation and its sidebar/settings entry points. Reviewed D1–D5; no new arbitrary sizes, colors, or custom modal scaffolding.

| Line                                                                      | Element                       | Verdict          | Reason                                                                                                                                                                                                                 | Suggested change |
| ------------------------------------------------------------------------- | ----------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `src/features/Org2Cloud/SignOutConfirmationModal.tsx:14`                  | Confirmation shell and footer | keep with reason | Uses the current Modal API: visible, medium size preset, onCancel/onOk, localized okText/cancelText, and danger status through okButtonProps. Inherits focus trapping, Escape dismissal, and accessible dialog naming. | None.            |
| `src/features/Org2Cloud/SignOutConfirmationModal.tsx:29`                  | Explanation                   | keep with reason | Semantic paragraph uses shared text size and theme color tokens; all 13 desktop locales include the copy.                                                                                                              | None.            |
| `src/scaffold/NavigationSidebar/blocks/SidebarSettingsMenuButton.tsx:260` | Sidebar logout action         | keep with reason | Closes the menu and opens the shared confirmation; authentication stays unchanged until confirmation.                                                                                                                  | None.            |
| `src/features/Org2Cloud/Org2CloudSection.tsx:147`                         | Settings confirmation         | keep with reason | Reuses the same dialog and logout behavior as the sidebar. Mobile settings already has its own platform confirmation.                                                                                                  | None.            |

Verdict totals: **0 fix**, **4 keep with reason**, **0 abstract**.

Verification: rendered jsdom interaction tests cover sidebar/settings cancellation and confirmed auth persistence clearing; sidebar also covers Escape. No desktop UI control or screenshot capture performed, per user preference.

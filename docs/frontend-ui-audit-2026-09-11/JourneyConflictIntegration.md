# Journey conflict integration UI audit

Scope: UI changes needed to reconcile PR #827 with develop; existing Journey surfaces retain their earlier audit. D1–D5 reviewed for these integration sites.

| Line                                                                         | Element                 | Verdict          | Reason                                                                                                                                  | Suggested change |
| ---------------------------------------------------------------------------- | ----------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `src/engines/ChatPanel/components/SessionHeaderActionsMenu.tsx:472`          | Link to Project action  | keep with reason | Uses the current DropdownItem inside the shared project-links ActionSubmenu, retaining keyboard navigation and disabled semantics.      | None.            |
| `src/engines/ChatPanel/ChatView.tsx:590`                                     | Journey controls slot   | keep with reason | Noninteractive layout wrapper retains the current live-region provider and existing Journey controls.                                   | None.            |
| `src/engines/ChatPanel/ChatHistory/components/ChatHistoryList.tsx:380`       | Exact transcript target | keep with reason | Noninteractive outline uses semantic primary tokens and aria-current; this is evidence highlighting, not a competing control primitive. | None.            |
| `src/engines/ChatPanel/ChatHistory/components/PinnedTurnHeader.tsx:101`      | Exact pinned header     | keep with reason | Retains exact-target semantics on the real pinned row and adopts develop's canonical z-70 utility.                                      | None.            |
| `src/modules/WorkStation/shared/TabBar/components/WorkstationTabIcon.tsx:67` | Journey tab icons       | keep with reason | Registers FolderTree and GitFork with the shared tab/recently-closed icon owner.                                                        | None.            |

Verdict totals: **0 fix**, **5 keep with reason**, **0 abstract**.

Visual screenshots and native-app verification were not run: desktop UI control was not authorized. Automated DOM contracts cover target routing, highlighting, and menu keyboard behavior; they do not establish native layout fidelity.

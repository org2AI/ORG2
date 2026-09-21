# ChatPanelStartPage UI audit

| Line                                                               | Element              | Verdict          | Reason                                                                                                                                                                                                     | Suggested change |
| ------------------------------------------------------------------ | -------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `src/engines/ChatPanel/ChatPanelStartPage.tsx:111`                 | Utility action cards | keep with reason | Only import, API key and quota actions remain. They reuse LaunchpadActionCard and retain existing responsive presentation. The duplicate update notice and its controls are removed at the user's request. | None.            |
| `src/scaffold/NavigationSidebar/blocks/SidebarUpdateButton.tsx:18` | Sidebar update entry | keep with reason | Existing update subscription and install action remain the entry point; this component is unchanged.                                                                                                       | None.            |

Verdict totals: **0 fix**, **2 keep with reason**, **0 abstract**.

Changed action sites were inspected: no new native buttons, substitute clickable elements or form fields. Start-page tests assert that an available update does not create a start-page notice or card. No desktop visual validation was run because computer control was not requested.

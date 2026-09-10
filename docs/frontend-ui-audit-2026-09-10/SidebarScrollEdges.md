# Sidebar scroll edges UI audit

| Line                                                       | Element              | Verdict          | Reason                                                                                                                                                                                                   | Suggested change |
| ---------------------------------------------------------- | -------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `src/scaffold/NavigationSidebar/blocks/SidebarList.tsx:87` | Edge fade            | keep with reason | Reuses the compact 12px scroll fade token and shared alpha mask, revealing either a solid or translucent sidebar background without painting a background overlay                                        | None             |
| `src/scaffold/NavigationSidebar/blocks/SidebarList.tsx:95` | Divider              | keep with reason | Uses border-border-2, stays outside the mask, occupies no layout space, and is noninteractive and hidden from assistive technology                                                                       | None             |
| `src/scaffold/NavigationSidebar/blocks/SidebarList.scss:1` | Edge state selectors | keep with reason | Component-owned selectors disable masks at reached boundaries and align the mask inset with the divider using the same spacing token; the shared mask defaults its new inset to zero for other consumers | None             |

Verdict totals: **0 fix**, **3 keep with reason**, **0 abstract**.

Visual Tauri verification was not run because computer control is not authorized. Automated DOM tests cover scroll boundaries, content resizing, reveal ref preservation, and loading/unmount cleanup; they do not verify rendered transparency or theme contrast.

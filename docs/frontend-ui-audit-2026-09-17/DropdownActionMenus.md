# Dropdown action menus UI audit

| Line                                                | Element              | Verdict          | Reason                                                                                                                                                                                                                                                        | Suggested change |
| --------------------------------------------------- | -------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `src/components/Dropdown/DropdownActionItem.tsx:56` | Shared action row    | keep with reason | The row is a compound control with caller-supplied leading content plus shared shortcut and suffix slots, so `Button`'s custom layout is the documented design-system escape hatch. It still renders the shared native `Button` and consumes dropdown tokens. | None.            |
| `src/components/RecentTabsMenuSection/index.tsx:51` | Recent-tab title cap | keep with reason | Recent tab labels come from user-controlled titles and need a bounded intrinsic width so a long unbroken title cannot widen the menu beyond the viewport-friendly action-menu proportions.                                                                    | None.            |

Verdict totals: **0 fix**, **2 keep with reason**, **0 abstract**.

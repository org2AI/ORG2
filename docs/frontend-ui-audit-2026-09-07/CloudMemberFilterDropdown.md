# CloudMemberFilterDropdown UI audit

| Line                                              | Element              | Verdict          | Reason                                                                                                                                                         | Suggested change |
| ------------------------------------------------- | -------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| cloudSessionsSection.MemberFilterDropdown.tsx:182 | Dropdown options API | keep with reason | Shared showSearch/filterOption provides input, keyboard navigation, selection and empty state; custom labels retain presence details                           | None             |
| cloudSessionsSection.MemberFilterDropdown.tsx:190 | Menu height          | keep with reason | Uses DROPDOWN_PANEL.maxHeight (256px), flex layout and the shared min-h-0 scrolling options container                                                          | None             |
| cloudSessionsSection.MemberFilterDropdown.tsx:175 | Positioned anchor    | keep with reason | Header button lives outside this hook; existing click coordinates anchor the shared dropdown; the outer fixed stacking context uses the shared overlay z-index | None             |

Verdict totals: **0 fix**, **3 keep with reason**, **0 abstract**.

## Lifecycle review

| Area               | Verdict | Evidence                                                                                                                  | Change or reason kept                                        | Verification                                          |
| ------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------- |
| Background work    | keep    | Dropdown mounts only while memberMenu exists; shared focus timeout and outside-click/resize listeners clean up on unmount | Removed custom Escape listener; no polling or requests added | Dismissal/reopen tests and shared Dropdown tests pass |
| Memory             | keep    | Query and filtered options belong to mounted Dropdown                                                                     | Closing unmounts query state; reopening starts empty         | Search/reset test with 40 roster members              |
| Scope/isolation    | keep    | Existing org-scoped roster, presence and hidden-row inputs retained                                                       | No new data source, cache or persistence format              | Typecheck; no cloud transport changes                 |
| Rendering/hot path | keep    | Option labels built only while open; shared search filters current options                                                | No recurring work while closed                               | Targeted rendered DOM tests; no runtime speed claim   |

Performance verdict: blocked for desktop measurement; user instructions disallow computer control. Automated behavior checks pass. Actual desktop viewport layout, visible/hidden CPU and RSS were not measured. Network/provider/multi-instance scenarios are outside this local menu change.

## Verification

- Targeted member-filter, cloud header, org selector, NavigationSidebar and shared Dropdown suites: 17 tests passed
- Scoped ESLint and pnpm run typecheck:fast: passed
- Visual desktop validation: not run under the user's computer-control preference

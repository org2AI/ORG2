# SettingsSearchDropdown UI audit

| Line                                                                     | Element                                | Verdict          | Reason                                                                                                                                                                                                   | Suggested change |
| ------------------------------------------------------------------------ | -------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `src/modules/shared/layouts/blocks/SettingsSearchDropdown/index.tsx:171` | Breadcrumb selector panel              | keep with reason | Keeps DropdownPanel and the existing positioning engine for the breadcrumb's floating selector. The sidebar-only input variant is removed after migrating its sole production caller.                    | None.            |
| `src/modules/shared/layouts/blocks/SettingsSearchDropdown/index.tsx:188` | Search field, options and panel height | keep with reason | Retains DropdownSearch and DropdownItem semantics. Existing computed available-height arithmetic is a positioning constraint, not a missing design token. Six trigger/dropdown interaction tests remain. | None.            |

Verdict totals: **0 fix**, **2 keep with reason**, **0 abstract**.

# General Storage UI audit

Scope: General Storage/HTTP consolidation and removal of resource/network settings. Existing unrelated working-tree changes are excluded.

| Line                                                           | Element         | Verdict          | Reason                                                                                                               | Suggested change |
| -------------------------------------------------------------- | --------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `src/modules/MainApp/Settings/sections/GeneralSection.tsx:124` | Storage tab     | keep with reason | Reuses StorageSection and existing Suspense/Placeholder convention, with no custom controls or interaction semantics | None             |
| `src/modules/MainApp/Settings/sections/GeneralSection.tsx:430` | HTTP version    | keep with reason | Reuses HttpVersionSettingsBlock, SectionContainer, SectionRow, Select, and control sizing token                      | None             |
| `src/modules/MainApp/Settings/sections/StorageSection.tsx:1`   | Storage content | keep with reason | Existing layout and cleanup controls retained; removed obsolete monitor refresh wiring only                          | None             |

Verdict totals: **0 fix**, **3 keep with reason**, **0 abstract**.

D1–D5 reviewed on changed sites. No new raw controls, arbitrary values, literal dimensions/colors, accessibility handlers, or repeated visual pattern. Desktop visual QA was not run: user requires explicit computer-control opt-in.

# Sidebar unification architecture review

| Line                                                                             | Element                     | Verdict          | Reason                                                                                                   | Suggested change |
| -------------------------------------------------------------------------------- | --------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------- | ---------------- |
| `src/components/TreeRow/config.ts:7`                                             | Shared geometry and surface | keep with reason | Ordinary, sticky and history row renderers share indentation and row gap; virtual pitch includes the gap | None             |
| `src/components/SidebarRow/index.tsx:24`                                         | Presentation boundary       | keep with reason | Generic label, metadata and decoration slots contain no Git or session ownership                         | None             |
| `src/modules/WorkStation/shared/PrimarySidebarLayout/SectionHeaderActions.tsx:8` | Portal ownership            | keep with reason | Existing mounted content owns actions; provider host is local to its section                             | None             |
| `src/modules/WorkStation/CodeEditor/SessionReplay/shellStatusBadge.ts:1`         | Remaining shell helper      | keep with reason | Live simulator tree consumes the extracted helper; unused ShellSidebar renderer is removed               | None             |

Verdict totals: **0 fix**, **4 keep with reason**, **0 abstract**.

Layers 1–7 reviewed: compile checks, duplicate renderers and removed symbols, naming, separation of row pitch from content height, explicit selected/interactive defaults, presentation-only shared boundaries and ownership comments. Layer 9 reviewed for section mount/action-host parity. Layers 8 and 10 are not applicable: no wire format or multi-source resolver changes. No Rust or persistence changes. Runtime visual and CPU/RSS measurements were not performed; no runtime performance improvement is claimed.

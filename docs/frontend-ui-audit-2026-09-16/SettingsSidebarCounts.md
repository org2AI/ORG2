# Settings sidebar counts UI audit

| Line                                                                  | Element               | Verdict          | Reason                                                                                                                  | Suggested change |
| --------------------------------------------------------------------- | --------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `src/scaffold/NavigationSidebar/variants/SettingsSidebarCount.tsx:25` | Count badge           | keep with reason | Matches Inbox's labelBadge geometry and token colors; static text is part of the parent navigation label, not an action | None             |
| `src/scaffold/NavigationSidebar/variants/SettingsSidebar.tsx:264`     | Navigation item badge | keep with reason | Uses existing NavigationMenu labelBadge slot, preserving shared button behavior and positioning                         | None             |

Verdict totals: **0 fix**, **2 keep with reason**, **0 abstract**.

D1–D5 checked. No new action controls, raw buttons, clickable substitutes, or inputs. The badge duplicates the single Inbox presentation intentionally to match the requested style; no third pattern or sweep found. Zero counts render nothing. UI component tests verify count transitions; no native visual validation was performed because computer control was not authorized.

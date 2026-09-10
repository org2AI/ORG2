# Spotlight multi-repo details UI audit

| Line                         | Element                    | Verdict          | Reason                                                                                                                    | Suggested change |
| ---------------------------- | -------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `SpotlightDetailPane.tsx:74` | Stacked repository details | keep with reason | Passive layout uses standard spacing tokens; each repository follows the existing individual card name/path structure     | None             |
| `SpotlightDetailPane.tsx:78` | Repository icon            | keep with reason | Uses AnyIcon, ICONS.repo, and the shared Spotlight icon size                                                              | None             |
| `SpotlightDetailPane.tsx:85` | Repository path            | keep with reason | Matches individual card text styling and truncation; title preserves access to the full path                              | None             |
| `SpotlightDetailPane.tsx:68` | Card container             | keep with reason | Existing HoverCardBase owns interaction; the section retains its accessible workspace label and viewport width constraint | None             |

Verdict totals: **0 fix**, **4 keep with reason**, **0 abstract**.

Verification: focused SpotlightDetailPane Vitest suite passed (5 tests). Desktop visual verification was not run because computer control was not requested.

# Replay layout composition UI audit

| Line                                                            | Element                    | Verdict          | Reason                                                                                                                                     | Suggested change                                                       |
| --------------------------------------------------------------- | -------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| Browser, CodeEditor and Diff SessionReplay roots                | Repeated shell composition | abstract         | Same chrome and panel wrapper assembly appears in three domains; the existing helper was unused and lacked editor double-click forwarding. | Completed: migrate to ReplayShellLayout with the real chrome contract. |
| ReplayShellLayout                                               | Wrapper elements/classes   | keep with reason | Matches the existing reachable wrapper structure; no geometry or styling redesign.                                                         | None.                                                                  |
| Browser trailing action / editor tab actions / diff empty state | Domain-specific controls   | keep with reason | Selection, loading and creation remain domain-owned; shared layer only forwards slots and callbacks.                                       | None.                                                                  |

Verdict totals: **0 fix**, **2 keep with reason**, **1 abstract**.

No intended visual change. Screenshots would help native regression review but were not captured because computer control was not authorized. Automated component tests cover composition and dispatch, not full visual parity.

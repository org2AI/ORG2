# Mobile roster lifecycle UI audit

| Line                                                                                                         | Element                                       | Verdict          | Reason                                                                                                                                                       | Suggested change |
| ------------------------------------------------------------------------------------------------------------ | --------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| `src/modules/MobileRemote/screens/SessionsScreen.tsx:349`                                                    | Loading, empty and failed roster notice       | keep with reason | Reuses `mobile-discovery-notice`; state comes from the roster request owner, independently of presence. Existing rows remain visible after a refresh failure | None             |
| `src/modules/MobileRemote/screens/SessionsScreen.tsx:372`                                                    | Retry action                                  | keep with reason | Shared `Button`, secondary/soft/large presentation, existing mobile touch and typography tokens, localized visible label; no native button bypass            | None             |
| `src/modules/MobileRemote/screens/SessionsScreen.tsx:356`                                                    | Async announcement                            | keep with reason | Loading/empty use `status`; failure uses `alert`. A failed request provides a recovery action rather than a blank page                                       | None             |
| `src/scaffold/NavigationSidebar/connectors/WorkstationSidebarConnector/DesktopSessionRosterProvider.tsx:329` | Shared section dialog and cloud member filter | keep with reason | Existing reusable controls render once under the shared owner, rather than once for each docked/hover consumer. No new dialog styling                        | None             |

Verdict totals: **0 fix**, **4 keep with reason**, **0 abstract**.

Scope: changed rendered controls in `SessionsScreen`, sidebar connector, shared provider and AppShell. Inspected JSX and callbacks after searching for raw button/input elements, native button creation and substitute clickable elements; no new bypasses. The extraction retains existing shared controls. No new color, spacing, radius or typography literals were added.

Behavioral evidence: the integrated 69-file suite passed 614 tests, including loading, ready-empty, retained-data error, retry, real provider route teardown and duplicate sidebar consumers. Runtime visual verification is recorded in the accompanying lifecycle report; these tests alone do not establish visual or performance parity.

## Isolated PR validation after rebase

See [`MobileRosterBatch.md`](../verification-2026-09-18/MobileRosterBatch.md) for the current branch results and remaining runtime/visual gaps. Earlier counts and simulator notes above describe the original integrated worktree.

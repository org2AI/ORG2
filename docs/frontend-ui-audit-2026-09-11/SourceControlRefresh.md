# SourceControlRefresh UI audit

| Line                                    | Element                | Verdict          | Reason                                                                                                                                                   | Suggested change |
| --------------------------------------- | ---------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `useSourceControlActions.tsx:38`        | Sidebar header actions | keep with reason | Keeps shared search/view actions and removes the duplicate refresh as explicitly requested                                                               | None             |
| `useSourceControlPaneActions.ts:79`     | Top refresh action     | keep with reason | Existing header button and spin primitive call the mounted sidebar's scoped refresh; shared status is the fallback only when no pane handles the request | None             |
| `SourceControlTabSidebarContent.tsx:64` | Handler registration   | keep with reason | One per-store handler delegates through the current pane ref and removes its own registration on unmount; no new UI primitive                            | None             |

Verdict totals: **0 fix**, **3 keep with reason**, **0 abstract**.

D1–D5 reviewed. No added colors, sizes, or raw interactive HTML. History, PR, and issue refresh actions are separate domain operations and remain available.

## Architecture review

Layers 1–7 and 9: source-control-specific handler type, one publisher/consumer path, explicit missing-pane fallback, current ref lookup after scope changes, and cleanup reviewed. Existing backend handlers continue owning Git status and stash refreshes. Layers 8 and 10 are not applicable: no wire/serialization changes or multi-field resolvers. Typecheck has an unrelated error in `src/components/Dropdown/index.test.ts:54`; no changed-file errors were reported.

## Performance guard

| Area               | Verdict | Evidence                                                                                        | Change or reason kept                                                           | Verification                                                                     |
| ------------------ | ------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Background work    | keep    | Only an explicit header click calls refresh; no timer, watcher, or retry added                  | Delegate to the existing pane refresh without an additional primary-repo scan   | Routing test checks exactly one call and no fallback call when handled           |
| Memory             | keep    | One nullable handler per Jotai store                                                            | Registration cleanup checks ownership; current ref avoids retaining an old pane | Unmount test verifies null registration                                          |
| Scope/isolation    | keep    | Pane ref resolves selected repo/worktree; existing shared Git store keys status by repo id/path | Scope switches use the latest imperative handle                                 | Routing test switches main repo to worktree; existing pane behavior suite passes |
| Rendering/hot path | keep    | Removed sidebar refresh spin hook; existing top spin remains                                    | No new high-frequency work                                                      | Source inspection and lint; no measured CPU/RSS claim                            |

Lifecycle matrix: startup has no handler until sidebar mounts; idle/hidden causes no new work; click invokes the current pane; missing pane falls back; scope change follows current ref; unmount releases registration. Network failures, cache bounds, backend generation handling, and multi-root refresh concurrency remain owned by existing implementations. No new network/provider/session lifecycle was introduced.

Verification: 5 tests passed across `useSourceControlPaneActions.test.ts` and `SourceControlTabPanels.behavior.test.ts`; targeted ESLint, test placement, and diff whitespace checks pass. Desktop visual checks and CPU/RSS measurements were not run because computer control was not authorized.

Performance verdict: blocked for desktop measurement; routing and cleanup checks pass. Visible/hidden idle, active refresh, and post-close runtime measurements remain unverified.

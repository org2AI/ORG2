# Inbox loading sections UI audit

| Line                                                             | Element                         | Verdict          | Reason                                                                                                                                                                        | Suggested change |
| ---------------------------------------------------------------- | ------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `src/modules/MainApp/TeamInbox/components/TeamInboxList.tsx:170` | Titled loading sections         | keep with reason | Reuses TeamInboxListSection, its shared Button disclosure, existing translated titles, and static ListPanelSkeletonRows; two rows per pending section bounds placeholder size | None             |
| `src/modules/MainApp/TeamInbox/components/TeamInboxList.tsx:166` | Independent source placeholders | keep with reason | Completed notifications and PRs remain visible beside placeholders for the pending source; no new action-control or input bypasses                                            | None             |
| `src/modules/MainApp/TeamInbox/TeamInboxView.tsx:175`            | Independent result presentation | keep with reason | Each source retains its own initial-load guard and list-mode isolation; ready results no longer wait for the other source                                                     | None             |

Verdict totals: **0 fix**, **3 keep with reason**, **0 abstract**.

## Performance review

| Area               | Verdict | Evidence                                                                                                                                                                                       | Change or reason kept                                           | Verification                                                           |
| ------------------ | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Background work    | keep    | ConnectedTeamInboxView starts notification and PR hooks together; coordinator uses Promise.all for local/cloud; GitHub lifecycle parallelizes permissions and list requests with concurrency 4 | No additional requests, polling, listeners, or retries          | Existing coordinator and GitHub lifecycle tests                        |
| Memory             | keep    | No new cache or retained collection; two static skeleton rows per pending section                                                                                                              | Existing bounded coordinator cache retained                     | Coordinator tests; source inspection                                   |
| Scope/isolation    | keep    | Per-source initial-load guards and list-mode guard remain; fetch owners and cancellation are untouched                                                                                         | Remove only cross-source presentation barrier                   | Layout tests cover both completion orders and pending source snapshots |
| Rendering/hot path | fix     | Combined initial-load flag previously suppressed both result sets                                                                                                                              | Publish each ready source and label pending-source placeholders | Layout and list rendering tests                                        |

Lifecycle scope: clean load, partial completion, cached revalidation, explicit refresh, and source failure use existing owners. Hidden/visible, unmount, identity and scope cancellation, cache bounds, and retry behavior are unchanged. No backend or transport changes.

Performance verdict: blocked for live latency measurement: desktop control was not authorized. Deferred-promise tests verify independent visibility, but no live WebView timing, CPU/RSS measurement, or screenshot was collected.

Final isolated-branch verification: 105 tests passed across 11 targeted suites; `pnpm typecheck:fast`, ESLint over all changed TypeScript files, and `git diff --check` passed.

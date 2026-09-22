# Lifecycle review

The SourceControlWithWorktrees component remains the entry point with or without discovered worktrees; loading notification runs in a layout effect before paint.

| Area               | Verdict | Evidence                                      | Change or reason kept                                      | Verification                                           |
| ------------------ | ------- | --------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------ |
| Background work    | keep    | No new polling or workers                     | Existing data hooks own loading; no new recurring activity | Source inspection and targeted component tests         |
| Memory             | keep    | Component-local state and refs                | Unmount owns disposal; no new app-lifetime cache           | Source inspection; tests cover relevant mount behavior |
| Scope/isolation    | keep    | Repository scope remains with existing caller | No account, endpoint or remote data-key change             | Typecheck and behavior tests                           |
| Rendering/hot path | keep    | Stable component/row presentation boundaries  | Preserve lifecycle owners and measured row geometry        | Targeted tests; no CPU/RSS benchmark                   |

Lifecycle scope: mounted/closed and initial loading transitions reviewed; hidden/visible idle, repeated real-app open/close and CPU/RSS measurements were not run. Network, authentication, provider ingest and multi-machine transport are not changed by this diff.

Performance verdict: blocked — real-app lifecycle and CPU/RSS measurements were not run because computer control was not requested. This is a verification limitation, not a claim of a measured regression or improvement.

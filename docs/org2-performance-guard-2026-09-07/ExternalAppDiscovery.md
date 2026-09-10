# External app discovery lifecycle review

The source of recent directories remains the eight existing Tauri recent-path APIs. Both picker entry points previously disabled discovery when more than five repositories were saved. This PR removes that presentation gate without changing provider parsing, IPC contracts, persisted data, normalization, or the 12-result display cap. The “Used in other apps” locale text is already in the base branch.

| Area               | Verdict | Evidence                                                                     | Change or reason kept                                                               | Verification                                   |
| ------------------ | ------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------- |
| Background work    | fix     | One pending provider batch shared by concurrent pickers                      | Load only for enabled visible pickers; no polling; search filters loaded results    | Hook and picker regression tests               |
| Memory             | keep    | One in-flight promise cleared on settle; each source requested with limit 12 | No app-lifetime result cache; mounted hooks retain results                          | Source inspection and duplicate filtering test |
| Scope/isolation    | keep    | Current webview/backend local history                                        | Closed-consumer guard prevents stale completion writes; no account cache            | Late completion and reopen test                |
| Rendering/hot path | keep    | Query changes only recompute bounded results                                 | No per-keypress scans; partial failures are logged and do not hide successful peers | Search and partial-failure tests               |

Native IPC already in progress can finish after closing; it cannot be cancelled by this hook. No retries or recurring timers are added. Provider raw transitions, parsing, cloud transport, and secondary-instance identity mechanisms are unchanged and are not claimed as tested.

Performance verdict: blocked — live native CPU/RSS measurements were not performed; desktop control requires explicit opt-in. Automated lifecycle checks are reported in the PR.

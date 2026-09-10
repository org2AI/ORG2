# PR hover metadata lifecycle

Production path: MarkDownImpl → LinkHoverCard → HoverCardBase singleton portal → mounted LinkHoverCardContent → useLinkPullRequest → getPRLocal → github_get_pr. Existing Rust credential resolution remains authoritative.

| Area               | Verdict | Evidence                                                                           | Change or reason kept                                                                        | Verification                                     |
| ------------------ | ------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Background work    | keep    | Effect belongs to mounted hover content; no interval, retry loop or listener added | Existing hover delay gates fetching; preview and Open PR share one promise per mounted panel | StrictMode replay and pending-open tests         |
| Memory             | keep    | One request ref and one result per panel; no module cache                          | Closing releases ownership; reopening fetches fresh data                                     | Close/reopen test                                |
| Scope/isolation    | keep    | Request scoped to URL; effect cleanup rejects late results                         | No cross-panel retained cache                                                                | URL race test; live account switch not exercised |
| Rendering/hot path | keep    | State lives in portal content, not markdown link list                              | Non-PR links do not fetch; skeletons are static                                              | Ordinary URL and summary tests                   |

Unopened links do no I/O. Open panels read once. Closing or changing URL makes the previous effect inactive. A dispatched IPC request can finish after closing but cannot update the removed panel. Offline/auth failures settle as unknown without automatic retries; explicit Open PR can retry. Hidden panels start no periodic work. Reopening obtains a new snapshot. Updated age is formatted on render without a timer. Author/avatar and changed-file count come from the same response; the mounted loaded card may fetch one avatar image.

Tests cover request sharing, failure/retry, state/title projection, stale URL completion, reopening freshness, non-PR URLs and zero file count. Summary tests check skeleton row tokens, title wrapping, content order, mini pill and 14px icon. No CPU/RSS, desktop pixel layout, or live authentication-switch measurements were performed because computer control was not requested.

Performance verdict: blocked for live verification; no runtime performance improvement is claimed. The change adds one on-demand metadata read per card opening, with no polling or persistent cache.

# External document opening lifecycle audit

| Area               | Verdict | Evidence                                                  | Change or reason kept                                                   | Verification                   |
| ------------------ | ------- | --------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------ |
| Background work    | keep    | Existing app discovery runs on mount/submenu expansion    | No timers or polling; Pages subprocess conversion removed               | Lookup and submenu tests       |
| Memory             | keep    | Existing discovery cache caps 32 paths with 60-second TTL | Reuses bounded cache and pending single-flight requests                 | documentApplications tests     |
| Scope/isolation    | fix     | Cached binary load failed to mark loaded path             | Restore loaded path; stale lookup completions are ignored after unmount | Hook and menu tests            |
| Rendering/hot path | keep    | Lookup completes before default-app label/icon rendered   | Bundled assets, no render-time network fetch                            | ApplicationIcon and menu tests |

Cold mount, tab return, remount and stale path completion have automated coverage. Hidden/visible native idle CPU/RSS, real app launches and post-close process measurements were not run: Computer Use is not authorized. No runtime performance improvement is claimed. Account/sync topology is inapplicable to local document opening.

Performance verdict: blocked for native measurements; automated lifecycle checks pass.

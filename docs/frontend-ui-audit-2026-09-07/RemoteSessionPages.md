# Remote session pages audit

| Line                  | Element           | Verdict          | Reason                                                         | Suggested change |
| --------------------- | ----------------- | ---------------- | -------------------------------------------------------------- | ---------------- |
| SessionsScreen.tsx:61 | Load more / retry | keep with reason | Shared Button exposes loading and disables offline interaction | None             |
| SessionsScreen.tsx:57 | Limit message     | keep with reason | Explicit bound disclosure; no grouping/filter UI is restored   | None             |

Totals: fix 0; keep with reason 2; abstract 0. Light/dark/physical-device screenshots were not captured.

## Architecture review corrections

Snapshot offsets now address the filtered roster: filter first, skip offset, take limit; nextOffset advances by the returned row count, and hasMore compares with filtered total. Writable-Codex capability lookup uses the same filtered page. The RPC response builder owns the invariant; the UI does not hide duplicate producer rows.

A backend regression exercises [idle,A-running,idle,B-running,C-running] with a page size of two, verifies A/B then C, checks the exhausted page, and verifies unfiltered offsets. Optional metadata remains additive and old clients can ignore pagination fields. No persisted data was modified; no historical cleanup is necessary.

| Area               | Verdict | Evidence                                            | Change or reason kept                               | Verification                         |
| ------------------ | ------- | --------------------------------------------------- | --------------------------------------------------- | ------------------------------------ |
| Background work    | keep    | Parent #1380 coalesces roster reads                 | One flight plus trailing intent                     | Parent burst/reset/retry tests       |
| Memory             | keep    | UI offset ceiling and server page-size cap retained | Demand-driven loading                               | Pagination tests; no RSS measurement |
| Scope/isolation    | keep    | Client and generation guards retained               | Old transport results cannot overwrite a new roster | Parent stale-client regression       |
| Rendering/hot path | keep    | Flat list unchanged                                 | No grouping/filter UI restored                      | SessionsScreen test                  |

Verification: `cargo test --locked --manifest-path src-tauri/Cargo.toml -p org2 --lib sidebar_snapshot_list -- --nocapture` compiled the Desktop library and passed both backend tests (1294 filtered out). The first attempt lacked the process-manager sidecar; the isolated worktree then reused the existing local sidecar and the rerun passed. Frontend session/roster tests passed, as did typecheck, scoped ESLint and git diff --check. Physical-device measurements and screenshots were not run.

Performance verdict: blocked on physical-device measurements; filtered producer correctness and overlapping parent roster requests are corrected and regression-tested. Provider raw history ingestion is unchanged.

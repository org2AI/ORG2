# Workstation pull request architecture review

Scope: session-scoped PR summary, existing GitHub branch lookup, shared rail composition.

| Layer                     | Review and outcome                                                                                                                                                                            |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 Compilation             | Frontend typecheck and integrations all-targets warnings-denied Clippy pass                                                                                                                   |
| 2 Ownership/deduplication | Existing branch-status hook owns requests/cache; rail projects one PR section and removes previous duplicate entries                                                                          |
| 3 Naming                  | includeClosed explicitly opts into historical PR lookup; existing callers remain open-only                                                                                                    |
| 4 Semantics               | PR lifecycle (open/draft/closed/merged) is distinct from CI checks                                                                                                                            |
| 5 Defaults                | Omitted backend include_closed defaults false; absent title/draft from older native responses remain compatible in TypeScript                                                                 |
| 6 Boundaries              | Native integration selects and normalizes GitHub data; UI owns presentation and shared detail-tab navigation                                                                                  |
| 7 Readability             | Session scope is resolved explicitly, with no fallback to an unrelated active workspace                                                                                                       |
| 8 Wire                    | Additive title/draft response fields and optional includeClosed request field; no storage migration. Producer tests assert encoded branch query, bounded requests and merged_at normalization |
| 9 Entry points            | Tauri command delegates to the same lookup function exercised by producer tests; client/auth construction stays unchanged. Full packaged-app/live authenticated lookup is not exercised       |
| 10 Resolver symmetry      | Title, number, URL, lifecycle and navigation context derive from the same session PR; same-environment compare action reuses its query                                                        |

Rollback: revert the feature; existing open-only callers and saved data remain compatible. The new section's existing local disclosure preference is harmless if the section is removed. No session data, database schema or mutation endpoint changes.

Validation limits: tests use response fixtures and rendered component fixtures, not a packaged native end-to-end GitHub flow. No dual-machine behavior or runtime CPU/RSS improvement is claimed.

## Explicit conversation attachments correction

Branch lookup alone cannot discover PRs created on separate worktrees. Codex's provider-owned `thread_attachments` table is the authoritative association: resolve the actual rollout's `session_meta.id` and provider home, then read only that thread's explicit `pull_request` attachments. Do not infer association from prose, shell output, generic source links or the active workspace.

The additive `session_pull_requests` command performs a read-only blocking-store read on the blocking executor, bounded to 100 records and 16 KB payloads. Missing legacy attachment storage yields no attachments; genuine read failures remain errors. No historical cleanup or database writes are needed. Codex storage schema changes may require an adapter update; non-Codex sessions retain the existing branch-based fallback.

The frontend carries session identity and update revision from the parent rail, merges attached PRs before the branch result, and deduplicates canonical URLs. Metadata loading uses up to three workers and the existing shared head-check reader; hiding/unmounting/switching scope stops queued work and rejects old results. Failed metadata retains the explicit URL with retry. Native navigation requires a confirmed matching repository; otherwise open the attached PR URL.

Production-reader readback against the current Codex rollout returned #2153 then #2152. Producer fixtures cover thread/provider isolation, removed attachments, absent/corrupt stores, URL validation and limits. Native GUI inspection was unavailable in this correction; the earlier single-row synthetic screenshots do not verify this missing-association case.

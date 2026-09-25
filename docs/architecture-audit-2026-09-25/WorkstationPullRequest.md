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

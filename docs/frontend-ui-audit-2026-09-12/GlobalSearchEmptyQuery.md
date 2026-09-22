# Global search empty-query UI audit

Product requirement: the user explicitly requested no content/results area in global searches before typing, matching file search. This is presentation behavior, not malformed domain-data remediation.

| Line                                                                            | Element               | Verdict          | Reason                                                                                                                                                                                              | Suggested change |
| ------------------------------------------------------------------------------- | --------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `src/scaffold/GlobalSpotlight/palettes/AllSessionsSearchPalette/index.tsx:227`  | Full-text search body | keep with reason | Uses PaletteBody's existing contentOverride contract to omit the list for empty/whitespace queries. Its keyboard items are also empty immediately, including while the previous search is clearing. | None             |
| `src/scaffold/GlobalSpotlight/palettes/AgentSessionSearchPalette/index.tsx:225` | Session search body   | keep with reason | Uses the same existing body contract, preserving the input and navigation. No cached session results can be selected while hidden.                                                                  | None             |

Verdict totals: **0 fix**, **2 keep with reason**, **0 abstract**.

Verification: ESLint for both changed files passed; `git diff --check` passed. `pnpm test -- src/scaffold/GlobalSpotlight/palettes/AllSessionsSearchPalette src/scaffold/GlobalSpotlight/hooks/features/__tests__/spotlightSessionSearch.test.ts` passed 13 existing tests. These tests cover search runners and item builders, not the rendered empty-query layout. Desktop visual verification was not run, per the user's computer-control preference.

Lifecycle review: no changes to timers, requests, subscriptions, cache ownership or search runner generation handling. Omitting SpotlightItemList also avoids mounting its empty-state timers before a query exists. Runtime measurements are not claimed.

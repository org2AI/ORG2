# Search submission UI audit

| Line                                   | Element                 | Verdict          | Reason                                                                                                                                                      | Suggested change |
| -------------------------------------- | ----------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `SearchEditorContent/index.tsx:272`    | Enter-to-search prompt  | keep with reason | Uses the same shared detail-panel Placeholder, icon size, stroke and opacity as SourceControlSelectionPlaceholder; new copy is translated in all 15 locales | None             |
| `SearchEditorContent/SearchBar.tsx:45` | Search field submission | keep with reason | Existing shared SearchInput owns Enter handling and native clear ×; composition Enter does not submit                                                       | None             |
| `SearchEditorContent/index.tsx:170`    | Results projection      | keep with reason | Serializes the submitted query/options rather than the live draft; pending edits display the explicit Enter prompt                                          | None             |

Verdict totals: **0 fix**, **3 keep with reason**, **0 abstract**.

No new raw action buttons, native form controls, or substitute clickable elements. Existing header controls and file filters remain shared components.

## Cause and ownership

Previously every query change scheduled the shared debounced search, and the result serialization memo depended on the draft query. Existing results could therefore be serialized on every keystroke as well as replaced by automatic search responses.

The tab hook now owns draft query/options separately from the submitted snapshot. Only Enter or explicit Refresh executes search. The sidebar retains the existing automatic default. Results are projected from their submitted snapshot, and pending draft edits display a prompt without serializing result text. The bounded session cache stores the optional snapshot, restoring drafts without automatically starting searches or restoring a stale loading indicator. No persistent format or IPC schema changes were made.

## Performance guard

| Area               | Verdict | Evidence                                                                                 | Change or reason kept                                                                                                             | Verification                                                                                          |
| ------------------ | ------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Background work    | fix     | Per-keystroke automatic search was enabled on the tab                                    | Automatic execution disabled only for search tabs; Enter/Refresh remain explicit                                                  | 50 draft updates with 500ms timer advances produced zero backend calls; first submission produced one |
| Memory             | keep    | Existing cache remains capped at 20 tabs; snapshot references existing immutable options | No second result copy or new timer/cache                                                                                          | Cache suite and remount test                                                                          |
| Scope/isolation    | fix     | In-flight responses can outlive a newer submission                                       | Request ownership claimed before listener setup; stale callbacks/completions ignored; unmount invalidates and cancels the request | Stale completion, replacement-listener and unmount tests                                              |
| Rendering/hot path | fix     | Serialization depended on draft query                                                    | Depends on submitted snapshot and pending-state boolean instead                                                                   | Source dependency trace; no native frame-time claim                                                   |

Lifecycle coverage: initial seed, repeated draft edits, explicit submission, another draft while a request is active, newer submission, stale completion, filter edit, unmount/remount and blank submission. IME composition and plain Enter are covered by input tests. Document-hidden and real-app CPU/RSS/keystroke latency measurements were not run because desktop UI control was not authorized.

Performance verdict: blocked for native timing/CPU/RSS measurements; deterministic request-count and lifecycle checks passed.

## Verification

- Targeted Vitest: `useSearchTabContent.test.ts`, `SearchEditorContent.test.ts`, `useSearchExecution.refresh.test.ts`, `SearchInput.test.ts`, `searchTabSessionCache.test.ts` — 19 tests passed; the updated placeholder/Enter and IME assertions were rerun (3 tests passed)
- `pnpm typecheck:fast` — passed
- Targeted ESLint on changed TypeScript files — passed
- `pnpm check:i18n-keys` — no new findings; zero locale gaps or placeholder mismatches
- `git diff --check` — passed
- Native desktop visual/performance verification not run

## Architecture review

Reviewed compilation, deleted title-update plumbing, draft/submitted naming, state ownership, default automatic behavior, shared sidebar/tab execution boundaries, initialization from seed/cache, and result projection from the submitted snapshot (layers 1–7, 9–10). Layer 8 has no wire change: the optional submission snapshot is confined to the existing bounded in-memory cache. Rust/backend compilation was skipped because no backend code or protocol changed.

Post-pull verification on the isolated PR branch: 95 tests across 15 files passed, along with full frontend typechecking and localization validation. No screenshots were captured because desktop control was not authorized.

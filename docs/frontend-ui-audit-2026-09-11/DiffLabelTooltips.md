# Diff label tooltips UI audit

| Line                                                           | Element                   | Verdict          | Reason                                                                                                                              | Suggested change |
| -------------------------------------------------------------- | ------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `src/components/DiffStatsBadge/index.tsx:94`                   | Added/deleted line counts | keep with reason | Shared Tooltip supplies the requested 500 ms delay; localized copy explains each count; existing typography and color tokens remain | None             |
| `src/modules/WorkStation/shared/DiffFileSection/index.tsx:448` | Git status letter         | keep with reason | Shared Tooltip explains the displayed letter using translations for every GitStatusLetter, including unknown status                 | None             |

Verdict totals: **0 fix**, **2 keep with reason**, **0 abstract**.

Checked shared-component use, token consistency, colors/sizes, tooltip semantics, and duplication. This requested change uses the existing shared badge for count tooltips across consumers.

Performance verdict: bounded, interaction-driven tooltip work. Existing Tooltip starts its one-shot delay on hover, cancels pending entry on pointer exit, and clears both timers on unmount. Scroll/resize listeners exist only while open and are removed on close/unmount. No polling, network, persistent cache, or identity-dependent resource was added. An already scheduled hover timeout may finish if the document becomes hidden; it is one-shot and does not initiate continuous work. Source inspection covers idle, hover, leave, close, hidden, and unmount; no runtime CPU claim is made. Network, account, transport, and machine topology are inapplicable to this presentation change.

Verification: `pnpm test src/components/Tooltip/index.test.ts src/components/DiffStatsBadge` passed 23 tests; targeted ESLint passed; `git diff --check` passed. The original working-tree typecheck reported an unrelated Dropdown test error; PR verification is rerun on its isolated branch. No desktop visual verification was performed.

## All Changes hover correction

The full diff header has a `pointer-events-none` presentation layer over an expand/collapse button. Tooltips nested in that layer did not receive pointer events, despite passing isolated badge tests. A `pointer-events-auto` button now owns the count/status group, preserving expansion clicks and keyboard semantics. Deleted-file headers use `aria-disabled` without suppressing hover, and do not toggle.

`pnpm test src/modules/WorkStation/shared/DiffFileSection/index.test.ts` passed 8 tests. New full-header cases verify the pointer-enabled target inside the passive layer, 499/500 ms timing, the visible tooltip class after positioning, all three badges, expansion clicks, and deleted-file behavior. Targeted ESLint and `git diff --check` passed. This is automated DOM verification; no desktop visual check was performed.

# Dead-export sweep 2026-09-16 — follow-up

Companion to the PR that landed the safe batch from this sweep. Method,
what shipped, and what's left for a future scoped pass.

## Method

1. `npx knip --reporter json` in a clean worktree off `origin/develop`
   (repo's `knip.json` already uses the fixed, non-substring `ignore` glob
   from PR #1178 — no need to re-narrow it). `"ignoreExportsUsedInFile":
true` means every candidate below is already confirmed unused within its
   own declaring file; the open question per candidate was only "used
   anywhere else in the repo, in a way knip can't see (namespace import,
   dynamic `import()`, string-literal command-name match, test-only
   reference)?"
2. Every candidate identifier was re-verified with `git grep -w` across the
   whole `src/` tree, keeping only names with **zero references outside
   their own declaring file**. This is the same gate from the
   `unused-exports-exclusion-trap` memory that cut false positives to zero
   last time.
3. `"exports in used namespace"` / `"types in used namespace"` (39 items)
   were excluded from verification entirely — those ARE used, via
   `import * as ns`.

## What shipped in this PR

- **Round 1** (script-verified, AST-based removal): 66 standalone dead
  exports/types across 51 files. Two were downgraded to "drop the `export`
  keyword, keep the declaration" rather than deleted outright, because a
  second, more precise check (does the identifier appear anywhere else in
  its own file, including inside a _different_ statement like a separate
  `export default name;`) found they're still used internally —
  `unifiedSessionApi` (`src/api/http/session/unified.ts`) and
  `getImportedHistoryCliResume` (`src/api/tauri/externalHistory/imported/index.ts`,
  referenced only from a JSDoc `{@link}` on a neighboring function, which
  isn't real usage but was kept out of caution).
- **Rounds 2–5** (cascade): deleting round 1 exposed 34 more declarations
  that had _stopped_ having any caller at all only once their sole
  consumer was removed — most of them (30) a chain inside
  `src/api/realtime/websocket/schemas.ts`, where an entire legacy
  WebSocket message-schema tree (superseded by
  `CodeEditorWebSocketMessageSchema`) unraveled one `tsc`/`eslint` pass at
  a time down to its base types. Each round was re-verified with the same
  `git grep -w` zero-external-reference gate before removal — including
  catching one same-named-but-unrelated `PendingQuestionSchema` in a
  different file, so it was correctly left alone.
- Excluded from all of this: `src/contracts/mobile-relay/v1/relay.ts` (13
  candidates — 8 consts + 5 types). The file's own header says
  `// Generated from mobile-relay-protocol. Do not edit; run
scripts/mobile-relay/generate-contract.mjs.` — it's a wire-protocol
  contract, and the "unused" portion is very plausibly still consumed by
  the mobile client (a different repo/target knip can't see). Hand-editing
  a generated contract file is wrong regardless of the unused-export
  finding; if this protocol surface really is dead, the fix is to remove
  it from the generator's source of truth, not from the generated output.

## What's left (verified candidates, not touched this pass)

**214 `default`-export candidates**, not attempted this pass at all —
verifying a default export needs a different check (is the file's path
ever the target of a default import anywhere?, i.e. file-level orphan
analysis) than a named-identifier grep, and a "yes it's dead" almost always
means the _whole file_ should go, which is a bigger, per-file-reviewed
change than this batch's "drop a redundant export" scope. Breakdown by
top-level area (grep the raw knip JSON — categories in `default-exports.json`
in this PR's originating session — for the full per-file list):

| Area                         | Count |
| ---------------------------- | ----: |
| `src/modules/WorkStation`    |    79 |
| `src/engines/ChatPanel`      |    25 |
| `src/engines/SessionCore`    |     8 |
| `src/modules/ProjectManager` |     8 |
| `src/hooks/ui`               |     7 |
| `src/engines/DatabaseCore`   |     7 |
| `src/api/http`               |     6 |
| `src/features/GitDialogs`    |     6 |
| `src/hooks/keyVault`         |     5 |
| `src/hooks/git`              |     5 |
| (14 more areas, 1–4 each)    |    58 |

Recommended method for the next pass, per the `dead-frontend-modules-2026-09-11`
memory: for each candidate file, confirm the file itself has zero importers
of its default export anywhere (not just knip's own file check, which only
catches _zero-importer files_, not files kept alive by an unrelated named
export while their default export rots) — group by directory the same way
this table does, since `src/modules/WorkStation` alone is over a third of
the list and likely shares a common cause (a factory/registry pattern where
several tab or panel modules stopped being wired into a switch statement).

**761 raw knip hits that failed verification** (referenced elsewhere in the
repo in a way knip's own report didn't show) — not a to-do list, just
confirms the false-positive rate here is real (about 72% of the raw
"unused exports" report). No action needed; re-running the same
`git grep -w` gate on a future knip snapshot is cheap and catches drift
automatically.

**233 unused-exported-types report, only 14 converted to real deletions**
here (9 in round 1, 5 from `relay.ts` which were excluded). The remaining
~219 weren't individually re-verified against the _types_ category the
same way the _exports_ category was on this pass — worth a follow-up run
of the same method scoped to `types`.

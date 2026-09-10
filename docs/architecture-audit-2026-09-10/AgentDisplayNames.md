# Agent display-name consistency

Acceptance: frontend fallback labels match the existing backend CLI registry; Kanban and local-session labels use the same fallback; imported history and resume labels agree with the registry; internal identifiers and App history distinctions remain intact.

Covered layers: 2 (formatter callers and redundant model override), 3 (registry name parity), 4 (display names versus wire IDs and App provenance), 5 (unknown-ID fallback), 6 (pure formatter remains independent of store/loading state), 7 (consistent brand spellings), and 10 (model, session, and filter fallback parity). Layers 1, 8, and 9 were skipped because type contracts, wire serialization, and initialization are unchanged.

Findings and resolution:

- The shared snake-case formatter lost brand capitalization and specific registry names. A source comparison verified all 29 CLI registry spellings in the combined working tree. This follow-up retains the Cursor fallback from companion PR #1526; that PR separately updates its backend registry name from Cursor CLI to Cursor.
- Kanban introduced Claude CLI, Codex CLI, and OpenCode CLI independently. It now uses the shared formatter.
- Local session metadata independently renamed Claude Code to Claude CLI. It now uses the same fallback while preserving explicit display names and imported history precedence.
- The model formatter repeated the Cursor override. It now delegates directly to the shared formatter.
- Imported Kimi, Copilot, and Mimo labels differed from their existing registry names. Frontend descriptors and affected Rust source labels now agree.

Verification: targeted ESLint and `pnpm typecheck:fast` passed; sessionToKanbanTask, sessionDisplayMetadata, and imported sources suites passed (35 tests). Existing Kanban expectations were updated for Claude Code. No Rust build or GUI verification was run for the label-only Rust changes. No persistence, subscriptions, lifecycle, or runtime execution changes were introduced.

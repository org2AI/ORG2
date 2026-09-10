# Type-aware lint gate

`pnpm check:typed-lint` adds three type-aware checks alongside the existing syntax/editor lint. It builds one production TypeScript graph; tests and declarations are excluded. CI runs the gate on every PR and develop push with a 15-minute ceiling and cancellation of superseded runs.

Rules: no-floating-promises, no-misused-promises, switch-exhaustiveness-check. Floating promises require actual handling: `void` alone does not handle a rejection. Await, return, or attach an appropriate rejection handler. Inline disable comments cannot bypass this separate gate.

## Existing backlog

The baseline contains 1,386 allowed occurrences across 1,248 fingerprints: 1,007 floating promises, 372 misused promise callbacks, and seven incomplete switches. Removed findings are retained as historical allowances until a reviewed pruning pass. This is a grandfathered backlog, not certification that the code is correct. Representative review found unhandled service initialization and async store writes, promise-returning UI callbacks supplied to void slots, and switches missing current union members. Fixes need owner-specific error behavior; this PR deliberately does not insert empty catches or bulk `void` casts.

`config/typed-lint-baseline.json` records file, rule, message, source expression, and occurrence count. Identity uses a hash of those fields (except count), with whitespace normalized and line numbers excluded. Moving lines does not invalidate the baseline; changing the expression, moving it to another file, or duplicating it fails the gate. Removed findings are allowed so independent cleanup PRs can land. Parser/configuration failures cannot enter the baseline.

## Maintenance

Run `pnpm test:typed-lint` for the fingerprint and real-rule fixtures. After intentionally fixing existing findings, run `node scripts/quality/typed-lint/check.mjs --write-baseline` and review the diff. Baseline additions require explicit review and justification; never regenerate it just to make a new violation pass. The snapshot is inspectable debt, not a file-wide suppression. Identical expressions within the same file are counted, but replacing one identical occurrence with another is an inherent fingerprint limitation.

The current installed ESLint/parser versions are reused: no dependency or application behavior change. The full scan has a material CI memory/time cost (CI allows a 6 GiB Node heap); it is separate from fast editor/pre-commit lint. Revert the workflow, script/config, baseline and package scripts to roll back. No runtime performance improvement is claimed.

Architecture coverage: compiler-assisted validation and error boundaries at the lint runner; no wire, persistence, session initialization, domain ownership or application lifecycle changes.

Integration baseline review: four fingerprints (five occurrences) were added from already-merged shortcut and tray code on develop. Two dynamic-import shortcut actions have no rejection handlers; tray `openPending` and `flush` handle errors internally but still use explicitly disallowed `void` calls. The three source files were verified byte-for-byte against develop. This records pre-gate debt without changing rules or application behavior.

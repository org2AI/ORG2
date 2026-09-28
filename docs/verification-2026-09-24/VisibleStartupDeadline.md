# Visible startup deadlines

The five-second React watchdog used wall time while first-paint completion depended on requestAnimationFrame. A hidden native WebView could mount correctly but suspend paint, causing a false fatal log and forced splash dismissal. The pre-bundle watchdog had the same hidden-time assumption. A microtask also marked React rendered without proving any DOM commit.

Both deadlines now share one pre-bundle visibility-aware timer factory. A hidden document has no active deadline timer. Visible elapsed time consumes the budget across hide/show transitions. Success, failure, timeout and HMR cleanup dispose the timer and visibility listener. The React failure decision inspects actual root content; scheduling a render is no longer treated as a committed frame. First-paint hook cleanup now cancels both queued frames as well as its observer.

Architecture layers reviewed: ownership, naming/semantics, default behavior, bootstrap/bundle boundary, init parity and lifecycle resolution. No persistent schema, provider wire, history parser or auth changes. The shared implementation lives in inline bootstrap code because it must operate when the bundle itself fails; the bundle calls that same owner.

| Area            | Verdict | Evidence                             | Change or reason kept                                     | Verification                                  |
| --------------- | ------- | ------------------------------------ | --------------------------------------------------------- | --------------------------------------------- |
| Background work | fix     | wall-clock deadline vs suspended rAF | no deadline timer while hidden; cumulative visible budget | VM executes actual bootstrap script           |
| Memory          | fix     | pending nested paint frames          | cancel both on unmount                                    | source check; real hidden/visible WebView run |
| Scope/isolation | keep    | per-window timer closures            | no process/global app state                               | independent harness contexts                  |
| Rendering       | fix     | microtask did not prove commit       | use root children and real paint signal                   | bootstrap tests and startup graph             |

Verification: `node --test scripts/dev/startup-watchdog.test.cjs` (11 passed), `vitest run --config config/vitest.config.ts src/app/root/__tests__/startupGraph.test.ts` (3 passed), `tsgo --noEmit --pretty false`, changed-file ESLint, `git diff --check`. Two stale native source-location assertions in the existing script were updated to the current setup/lifecycle files and bounded-shutdown contract.

Real macOS debug Tauri/WebKit acceptance also passed in an isolated profile with the storage-isolation patch integrated. The WDIO scenario hid the main window, refreshed the document, asserted `visibilityState === "hidden"`, waited seven seconds, and verified that no fatal startup screen appeared. After showing/focusing the window, the root had committed content and the splash disappeared. The test used the exact startup implementation at `28e73d41da`; the combined snapshot scenario passed (1 spec, 108.8 seconds). No model or cloud operations were used. Command: `python3 /tmp/org2-bounded-snapshot-runtime/run.py` (private temporary harness; not a committed reproducible suite).

No visual styles or action controls changed. This runtime assertion verifies hidden-startup behavior, not a visual-layout claim; no screenshot evidence is asserted. Other operating systems and production builds remain unmeasured. Performance verdict: pass for the changed visibility/timer lifecycle on this macOS debug runtime; cross-platform acceptance remains uncovered. No history/data migration or remediation is needed; rollback restores the prior deadline implementation.

# Hook lifecycle contracts

`createHookLifecycleHarness` builds on the existing real React DOM smoke harness. It mounts under StrictMode, exposes only committed values, rerenders without replacing the component, and creates a fresh root/container after unmount. Reading after disposal fails explicitly. Tests restore spies and fake clocks even on assertion failure.

The production contracts cover useMouseMoved and useKeepAliveWindow. Three repeated cycles exercise mount, unchanged rerender, visible/inactive state, unmount and remount. These are not mocked hook implementations. Async keyed-request behavior remains covered separately by the existing useAsyncData tests; this PR does not claim a generic proof for all hooks.

| Area               | Verdict | Evidence                                                                                         | Change or reason kept                                                        | Verification                      |
| ------------------ | ------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- | --------------------------------- |
| Background work    | keep    | Mouse listener registrations paired with the same callback removals, including StrictMode replay | Assert one active registration while visible and zero after inactive/unmount | Three lifecycle cycles            |
| Memory             | keep    | Warm state capped at two entries; deactivated entries expire                                     | Assert eviction and zero residual fake timers                                | Three scope/expiry/unmount cycles |
| Scope/isolation    | keep    | Each remount uses a new root and container                                                       | Assert fresh state after prior disposal                                      | Repeated mounts                   |
| Rendering/hot path | keep    | Test-only helper reads committed values via layout effect                                        | No production logic changed                                                  | Targeted lint and typecheck       |

Performance verdict: pass for the two tested lifecycle contracts. These are deterministic resource-count tests, not CPU/RSS measurements. Native Tauri, account/network transitions and unrelated hooks are outside this test-only change. No UI screenshots or computer control are needed.

Verification: `pnpm exec vitest run --config config/vitest.config.ts src/test/hookLifecycleHarness.test.ts` (two tests passed); targeted ESLint; `pnpm typecheck:fast`; `git diff --check`. Tests are discovered by the existing CI unit suite; no new dependency or runner is required.

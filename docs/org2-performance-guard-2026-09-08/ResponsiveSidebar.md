# Responsive sidebar

| Area               | Verdict | Evidence                                                                      | Change or reason kept                                                                                   | Verification                                |
| ------------------ | ------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Background work    | keep    | AppShell owns the existing useViewportWidth resize listener and pending frame | Reuse listener; no polling or additional listeners; existing cleanup removes listener and cancels frame | useViewportWidth.test.ts passed             |
| Memory             | keep    | Two fixed-size atoms per store                                                | No collections or retained resources                                                                    | Source inspection                           |
| Scope/isolation    | keep    | Responsive state belongs to each Jotai store                                  | Automatic transitions do not write localStorage; existing preference key unchanged                      | Separate-store and persistence tests passed |
| Rendering/hot path | keep    | Existing viewport updates coalesce per animation frame                        | Responsive atom writes only on breakpoint crossings                                                     | Same-side resize notification test passed   |

Lifecycle: initialize collapse from window width; idle/hidden windows add no scheduled work; resize events use the existing frame; returning to a wide window restores the saved preference. AppShell unmount retains no new resources. Network, account, session, and transport lifecycles are unaffected. Manual narrow-window choices last until the next crossing.

Verification: `pnpm test src/store/ui/__tests__/sidebarAtom.test.ts src/engines/ChatPanel/hooks/useViewportWidth.test.ts` passed (12 tests); `pnpm typecheck:fast` passed; targeted ESLint passed. `git diff --check` passed on the isolated PR branch based on current develop. Native visual/CPU verification was not run because computer control was not authorized; no runtime performance improvement is claimed.

# Spotlight sticky section titles

| Area               | Verdict | Evidence                                                      | Change or reason kept                                                             | Verification                                          |
| ------------------ | ------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Background work    | keep    | Existing virtualizer owns scrolling                           | No new listeners, timers, requests, or polling                                    | Source inspection                                     |
| Memory             | keep    | Header indices scoped to current items and component lifetime | Memoized indices; virtual window retains at most one additional row               | Range extractor inspection                            |
| Scope/isolation    | keep    | No shared mutable state or persisted changes                  | Each mounted picker owns its indices; replaced with items and released on unmount | Source inspection                                     |
| Rendering/hot path | keep    | Binary search selects the current header; CSS pins it         | Existing virtualization and overscan preserved                                    | Two boundary tests pass; four existing row tests pass |

Lifecycle: mounting derives header indices; active scrolling uses the existing virtualizer; idle/hidden states add no autonomous work; changing results replaces indices; unmount releases component-owned data. Network, identity, provider ingestion, and machine topology are unaffected.

Verification: targeted Vitest run (6 tests), `pnpm run typecheck:fast`, targeted ESLint, and `git diff --check` passed. No runtime CPU/RSS measurements or visual scrolling checks were performed: desktop control requires explicit user opt-in. No runtime performance improvement is claimed.

Performance verdict: blocked for real-app scrolling and lifecycle measurement; static boundedness checks pass.

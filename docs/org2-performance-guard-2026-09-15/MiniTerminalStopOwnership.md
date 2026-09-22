# Mini terminal stop ownership

## Root cause and authoritative source

`terminalSessionsAtom` is the canonical local session list. `miniTerminalClaimedIdsAtom` identifies sessions owned by the dock. The workstation trail's existing open-tab projection excludes claimed sessions and includes eligible initialized ordinary terminal sessions.

The Stop writer, `closeMiniTerminalSessionAtom`, released its claim before calling `closeTerminalSessionAtom`. The latter awaits native `close_pty` before removing the session from the canonical list and persisting it. That asynchronous gap exposed a real, still-listed terminal as unclaimed, making its workstation row briefly appear and allowing the workstation terminal host to remount it.

A deferred-native-close regression reproduced this at the producing atom boundary: both successful and rejected native replies failed the assertion that the session remained claimed while the request was pending. The existing canonical close logs native errors and still removes the local session; this behavior is unchanged.

## Fix and invariant

Stop now awaits canonical session removal before releasing the claim. At every observed store transition during a dock-owned Stop, the target session is either still claimed or already absent from the canonical list. There is no transient handoff to the workstation host.

An operation-scoped, per-store set prevents repeated Stop clicks from issuing duplicate native kills while the tab remains visible. A stale callback for an unclaimed session is ignored. Entries are removed in `finally`; a reused ID can be stopped again. Completion reads current claims, preserving a different terminal opened while the earlier kill was pending.

The UI adapts the async close action through one synchronous handler shared by the Stop control and TerminalCore close callback. It catches and logs failures, preserving the void-returning callback contracts without dropping Promise rejections.

No UI filter, label rule, timer, persistence format, or native protocol was added. Hiding/releasing a dock without killing remains an intentional handoff. No historical remediation is needed: this was a transient ownership transition, not malformed saved session data. Existing unrelated workspace changes were left intact.

## Lifecycle evidence

| Area               | Verdict | Evidence                                                                                     | Change or reason kept                                                    | Verification                                                                                        |
| ------------------ | ------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Background work    | fix     | Release preceded an awaited native kill                                                      | Await session removal before release; duplicate Stop is ignored          | Deferred native completion, duplicate-click, and native-error tests                                 |
| Memory             | keep    | Pending IDs exist only for outstanding close operations, with one entry per target per store | Remove each entry in `finally`; no app-lifetime cache or polling         | ID reuse after completion succeeds                                                                  |
| Scope/isolation    | fix     | Pending operations must not interfere across stores or affect new dock claims                | Immutable per-store set; release against current claims after completion | Two stores closing the same ID and opening another terminal during close                            |
| Rendering/hot path | fix     | Unclaimed-but-live state made a trail row eligible and lifted PTY suppression                | Correct writer ordering; leave rendering predicates unchanged            | Store subscriptions observe no live/unclaimed intermediate target; existing dock control tests pass |

Relevant states covered: pending native close, successful completion, logged native failure, duplicate Stop, ID reuse, two stores, a newly opened dock terminal, multiple/single terminal controls, and ordinary hide/release behavior. No new work runs during visible or hidden idle. Native request lifetime and canonical error handling are unchanged. Network/auth/provider lifecycle matrices are not applicable.

## Verification

- Before the fix: `pnpm test src/store/ui/__tests__/miniTerminalAtom.test.ts` reproduced **2 failing claim-retention regressions**.
- After the fix: `pnpm test src/store/ui/__tests__/miniTerminalAtom.test.ts src/store/workstation/codeEditor/terminal/__tests__/terminalAtoms.close.test.ts src/modules/shared/layouts/FocusedChatWorkstationRail/WorkstationTrailTerminal.test.ts`: **27 tests passed across 3 files**.
- `pnpm exec eslint src/store/ui/miniTerminalAtom.ts src/store/ui/__tests__/miniTerminalAtom.test.ts --max-warnings 0`: passed.
- `git diff --check -- src/store/ui/miniTerminalAtom.ts src/store/ui/__tests__/miniTerminalAtom.test.ts`: passed.
- CI follow-up: `NODE_OPTIONS=--max-old-space-size=6144 pnpm check:typed-lint` passed with **1097 existing findings, 0 new or increased findings**; `pnpm test:typed-lint` passed **6 tests**. The 27 close/dock tests, changed-file regular and type-aware ESLint, and TypeScript checking were rerun and passed. No rule or baseline was weakened.
- `pnpm typecheck:fast`: passed on the isolated PR branch. Earlier checks in the shared checkout encountered unrelated BranchPalette test errors.
- The CI follow-up changes only the shared close handler in WorkstationTrailTerminal.tsx; action controls still use the existing shared header and Button primitives. No Rust code changed. Native desktop visual and CPU/RSS measurements were not run because computer control was not authorized.

Performance verdict: blocked — ownership, cleanup, duplicate suppression, and store isolation are covered by passing tests; native desktop measurement remains unverified. No measured CPU/RAM improvement is claimed.

# Terminal startup sizing

## Source and invariant

A clean interactive zsh emits an inverse `%`, width-dependent spaces, and carriage returns before its prompt. Capturing real zsh output on a 64-column PTY and replaying it through the installed xterm parser erased the marker at 64 columns but left it visible at 62 columns. The authoritative source is the shell's PTY byte stream; this is terminal geometry, not malformed persisted data.

The shared TerminalInteractive startup previously fitted the DOM renderer before selecting WebGL, captured dimensions before asynchronous listener registration and the existence probe, and delayed native resizing by another 50 ms after xterm had resized. Startup now fits the selected renderer, reads the live grid at each resize/create IPC boundary, and dispatches native resizing immediately. Existing container/window debounce still coalesces fits before xterm changes dimensions.

A fit during native creation can send resize before the session is registered. The create continuation reconciles any changed dimensions before releasing the queued stream, guarded by live terminal ownership. This corrects subsequent shell sizing; it does not rewrite output already emitted at another width. Existing scrollback is preserved and no percent filtering is added.

Launch-option and banner helpers moved unchanged into terminalPtyLaunch.ts to keep the connection module below 700 lines. There are no dependency, shell configuration, IPC schema, or persistence changes. The shared startup correction also applies to other TerminalInteractive hosts. The 12px right inset is scoped to the docked trail panel and matches its existing left inset outside FitAddon's measurement area.

## Lifecycle review

| Area               | Verdict | Evidence                                                                       | Change or reason kept                                            | Verification                                                                          |
| ------------------ | ------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Background work    | fix     | Native resize waited 50 ms after the grid changed                              | Remove that timer; retain upstream event-driven fit coalescing   | Real xterm resize dispatches IPC synchronously; unchanged dimensions dispatch nothing |
| Memory             | keep    | Startup adds local size snapshots only                                         | No new registry, queue, listener, or recurring work              | Existing ownership and cleanup tests pass                                             |
| Scope/isolation    | keep    | Existing terminal identity and pane ownership guard asynchronous continuations | Check live ownership around resize reconciliation                | Aborted creation does not reconcile a disposed connection                             |
| Rendering/hot path | fix     | Renderer selection and captured grid could disagree with shell launch          | Fit selected renderer and read live dimensions at IPC boundaries | Delayed-listener/probe tests replay zsh bytes through the actual xterm parser         |

Relevant states: visible startup, hidden startup without repeated frame polling, active resize, unchanged-size fit, dispose/remount, reconnect, and native creation with a lost resize. Network/auth/provider transitions are not changed. Actual Tauri visible/hidden CPU and RSS were not measured because desktop computer control was not authorized.

## Verification

- Real local `/bin/zsh -f -i` output on a 64-column PTY reproduced the highlighted marker when parsed at 62 columns and erased it when parsed at 64 columns.
- `pnpm test src/engines/TerminalCore/components/TerminalInteractive/__tests__ src/store/ui/__tests__/miniTerminalAtom.test.ts src/store/workstation/codeEditor/terminal/__tests__/terminalAtoms.close.test.ts src/modules/shared/layouts/FocusedChatWorkstationRail/WorkstationTrailTerminal.test.ts src/modules/shared/layouts/blocks/WorkstationTrailSurface.test.ts`: **18 files, 177 tests passed** on the isolated PR branch.
- `pnpm typecheck:fast`: passed on the isolated PR branch.
- Compiled TerminalInteractive/index.scss using the installed Sass compiler and checked the scoped 12px right inset: passed.
- No Rust implementation changed. Real GPU/font and desktop visual verification were not run.

Performance verdict: blocked — lifecycle tests pass, but actual Tauri visible/hidden measurements remain unverified. No measured CPU/RAM improvement is claimed.

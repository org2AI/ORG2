# Canonical terminal ownership

Architecture coverage: compilation, production reachability, naming, semantic
axes, defaults, state boundaries, developer clarity, and initialization parity.
No backend wire protocol or provider resolver changes.

AppShell mounted TerminalProvider, but its private context had no reader.
Its independent sessions only fed the legacy sidebar mirror, and its unmount
closed each PTY twice through separate paths. Actual terminal UI and services
already use the Jotai terminal store. Delete that provider and its terminal-only
mirror hooks/actions. Preserve browser sync and the stored legacy payload;
there is no persisted data deletion or migration.

Session records no longer retain mutable selection flags. The public session
view derives `isActive` from `activeTerminalIdAtom`, including on hydration and
direct ID writes. Persistence serializes the same compatible projected shape.
Mini-terminal release uses the existing persisted selection action. Workspace
targets and chat-panel claims remain independent host-selection axes.

| Area               | Verdict | Evidence                                                                             | Change or reason kept                                    | Verification                                                             |
| ------------------ | ------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------- | ------------------------------------------------------------------------ |
| Background work    | fix     | Unread provider owned mirror effects and duplicate close paths                       | Delete legacy owner; canonical PTY close paths unchanged | Production reachability sweep; terminal lifecycle and browser hook tests |
| Memory             | keep    | No new app-lifetime registry; projected arrays replace prior mutable arrays          | Existing sessions/claims keep their lifecycle            | Add, close, last-session fallback, claim-cap and release tests           |
| Scope/isolation    | keep    | Jotai state belongs to each store; host claims and workspace targets remain separate | Do not merge different host scopes                       | Store-isolation, workspace target, and mini-terminal tests               |
| Rendering/hot path | keep    | Flags derive from one ID; metadata unchanged no-op remains                           | Remove duplicate writes, not terminal rendering          | Terminal atom tests and full typecheck                                   |

Lifecycle coverage: initialization, create, select, rename, close inactive,
close active, last-session fallback, mini-host hide/unmount and release, and
browser sync removal/remount. No timer, retry, network, or auth policy changed.
Runtime PTY shutdown, visible/hidden CPU/RSS and real desktop remount behavior
were not measured: computer control was not authorized. No measured speedup is
claimed. No visual change, so screenshots would not add useful evidence.

Verification: targeted terminal, mini-terminal, and browser-sync suites passed
38 tests in 6 files; `pnpm typecheck:fast` passed.

Performance verdict: blocked for real desktop PTY lifecycle/CPU/RSS measurement;
automated state and lifecycle checks pass.

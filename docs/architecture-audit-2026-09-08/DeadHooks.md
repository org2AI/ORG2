# Dead hook cleanup

Removed 18 hooks after tracing desktop, mobile web, and mobile native entrypoints, aliases, barrels, same-file calls, and test-only references.

- No callers: useLogger, useStickyMount, useScrollToBottom; four MobileRemote wrapper hooks.
- Test-only wrappers: useScopedRequestMachine, useChatGroups. Grouping/collapse regression coverage now calls the production projectChatGroups implementation; only adapter-parity coverage is removed.
- Unused wrappers: useReplayShell and useConflictMarkers. Shared replay helpers and conflict parsing utilities remain.
- Disconnected simulator chain: useSimEventRenderer, useSimulatorAdapter, useUnifiedEventRenderer, useEventIndex, useSpecIndex. ActivitySimulator and the shared rendering registry remain.
- Disconnected launcher chain: AgentLauncherSection -> useRepoSetup -> useSetupRepoAutoLaunch. Removed the exclusively used setup prompt builder; the canonical repo-setup marker remains.

Architecture layers covered: 1 (typecheck), 2 (production reachability), 3 (stale exported names), 7 (comments and misleading wrappers). Layers 4–6 and 8–10 are unchanged: no domain semantics, branch defaults, core boundaries, wire contracts, initialization paths, or resolver fallback behavior changed. No persisted data remediation is needed.

| Area               | Verdict | Evidence                                                        | Change or reason kept                                  | Verification                              |
| ------------------ | ------- | --------------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------- |
| Background work    | fix     | Removed hooks have no production invocation                     | Remove dead listener/effect owners; retain live owners | Reference tracing and typecheck           |
| Memory             | fix     | Removed renderer/index structures were owned only by dead chain | Remove dead maps and hooks; shared registry retained   | Production Knip rescan                    |
| Scope/isolation    | keep    | No live identity/session paths changed                          | No runtime behavior change claimed                     | Projection regression suite               |
| Rendering/hot path | keep    | Chat uses projectChatHistory/projectChatGroups                  | Preserve pure grouping and parsing behavior            | Grouping and projection regression suites |

Performance verdict: pass for removal-only lifecycle invariants. No CPU/RSS improvement is claimed: dead hooks were never mounted. Native UI measurement and screenshots are not applicable to unreachable code removal; computer control was not used. No retained component JSX changed, so a UI consistency sweep is not applicable.

Verification: pnpm typecheck:fast; targeted ESLint; grouping/logger tests (37 tests); projection tests (28 tests); production Knip before/after; git diff --check. Knip still reports unrelated pre-existing unused exports/files and is not a zero-issue claim. Full app/E2E and Rust checks were not run because no live runtime or Rust path changed.

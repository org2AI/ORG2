# Canvas creation entry

The replay toolbar publishes New Canvas even when no render event exists. The
click creates a structured composer draft, then delegates navigation to
`goToNewSession({ draftId })`. Existing draft promotion and snapshot hydration
remain owned by the Session Creator. No message is sent by this action.

| Area               | Verdict | Evidence                                                                                                 | Change or reason kept                                                           | Verification                                                                            |
| ------------------ | ------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Background work    | keep    | The new hook has one synchronous click callback and no effect, timer, listener, scan, or network request | Idle, hidden, offline, and unmounted launchers introduce no background resource | Mount/rerender test asserts no draft writes or navigation                               |
| Memory             | keep    | Drafts live in the existing persisted creator draft store, with existing user deletion lifecycle         | One small draft per deliberate click; no second cache or runtime registry       | Repeated clicks create distinct drafts without replacing previous snapshots             |
| Scope/isolation    | keep    | New draft has a fresh ID; previous active draft is promoted by existing navigation                       | Current replay session and existing draft content are not rewritten             | Test checks previous text, sidebar promotion, new active ID, and cleared active session |
| Rendering/hot path | keep    | New hook uses setter-only access to draft storage                                                        | No subscription to all draft changes and no work on streamed canvas deltas      | Existing CanvasApp interaction and sharing tests pass                                   |

Lifecycle: empty/selected replay -> explicit click -> saved new draft -> creator
snapshot restoration. Remount restores the same pill. There is no request or
pending/error/retry state in the new action. Storage uses the existing best-effort
localStorage policy; disk-quota recovery is unchanged. No historical data cleanup,
backend schema, IPC, or wire changes are needed. Existing CLI Canvas capability
restrictions remain; this change does not add Canvas tools to Codex App sessions.

Verification:

- `pnpm test src/engines/Simulator/apps/canvas/CanvasApp.test.ts src/engines/Simulator/apps/canvas/CanvasApp.share.test.ts src/engines/Simulator/apps/canvas/useNewCanvasDraft.test.ts src/engines/SessionCore/hooks/session/useSessionCreator/useDraftManagement.test.ts src/engines/ChatPanel/hooks/useInputArea/__tests__/canvasSlashCommand.test.ts src/hooks/navigation/useAppNavigation.test.ts`: 6 files, 33 tests passed
- `pnpm test src/engines/Simulator/apps/canvas/CanvasApp.test.ts`: 7 passed after making the header test honor the production enabled gate
- ESLint over all five changed TypeScript/TSX files: passed
- TypeScript AST inspection of both changed production files: zero native or substitute action controls; the new control uses shared Button and NoDragRegion
- `git diff --check`: passed
- `pnpm exec tsc --noEmit --pretty false`: stopped at the default Node heap limit
- `pnpm exec tsgo --noEmit --pretty false`: passed with no diagnostics

Architecture boundaries reviewed: live call chain, draft ownership, Canvas-create
versus preview naming, empty header gate, persisted snapshot serialization, and
shared navigation/hydration initialization. Backend resolvers, external wire
protocol, and Rust compilation are unchanged and were not audited.

No real desktop run, light/dark/narrow-layout screenshots, CPU/RSS measurement,
or model-generation test was performed. The rendered regression uses jsdom,
including the real composer and draft restoration hook. No runtime performance
improvement is claimed.

Performance verdict: blocked on desktop lifecycle measurement; source inspection
and automated lifecycle regressions found no new background resource.

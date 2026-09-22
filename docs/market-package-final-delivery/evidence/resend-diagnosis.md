# Why Resend on a canonical-root failed message shows no footer and no reply

Observed 2026-09-17 on build `f006d33b6`; traced in source (paths relative to repo root).

**Which branch ran.** `useEditUserMessage` (src/engines/ChatPanel/ChatHistory/hooks/useEditUserMessage.ts)
only takes the failed-intent retry branch (146-299, calls `onFailedUserIntentRetry`) when the row is
`displayStatus === "failed" && result.syntheticUserInput === true` (136-140). A turn that the execution
child accepted and whose failure Claude Code reported as an *agent* row completes the queue row
(`settleTerminal`, src/features/ConversationContinuation/canonicalConversationDispatcher.ts:110-127 only
throws when `agentTail.length === 0`); the optimistic row is then replaced by the landed child user row,
re-stamped `id: runlanded-<childEventId>, sessionId: <root>` by `projectVerifiedLocalExecutionTail`
(src/engines/SessionCore/conversations/localConversationExecutionTail.ts:406-439) with no
`syntheticUserInput`. Resend on that row therefore runs the edit/rewind branch (301-434) against the ROOT.

**What the rewind branch does to the root.** `cancelTurnForTimelineBoundary(root)`,
`beginOptimisticTurn(root)`, `truncateBeforeId("runlanded-…", root)` (no-op: id not in the root store),
`invokeTauri("cli_agent_truncate_after_chunk", {sessionId: root})` (kills the root runner, file-history
rewind, clears the root's `cli_session_id` so the next turn is a fresh provider conversation:
src-tauri/src/agent_sessions/cli/commands/transcript.rs:461-468, chunk_ops.rs:264-287,
resume_state.rs:326-355), `deleteCachedSession(root)` + `evictSession(root)` with no reload, then
`submitUserIntent({sessionId: root, source: "dispatch"})` without a `conversationDispatch` descriptor →
direct `cli_agent_message(root)` (`run.rs:752-769`, the logged `dispatching rerun`).

**Why nothing rendered.** The canonical surface derives liveness from the durable queue's active
deliveries (`useConversationActiveRunners` → `planningIndicatorScope`, ConversationStreamProvider.tsx:56-70;
PlanningIndicatorBridge.tsx:133-137 falls back to the global scope when none). A direct root dispatch
registers no delivery, so there is no "Agent working" scope; the root store had just been evicted and
not reloaded, so the anchor collapsed to the new synthetic row until a session switch remounted the
view and reloaded root history.

**Normal send path for comparison.** Composer submit → `useConversationSubmitRouter.enqueueCanonical`
→ `submitUserIntent({conversationDispatch: {kind: "canonical_conversation", …}})` → durable queue →
execution child with `onRunnerReady`/`onAccepted` → scoped footer, live ingestion.

**Tests.** `__tests__/useEditUserMessage.test.ts` exercises only synthetic failed rows; no test drives the
rewind branch with a canonical root + landed `runlanded-` row, and `cli_agent_truncate_after_chunk` is never
asserted.

**Fix (this branch).** In the rewind branch, when the surface is canonical and the row is a landed
execution-tail row, do not truncate/rewind/evict the root; route the resend through the canonical router
(`onFailedUserIntentRetry`) so it runs on an execution child with a registered runner; trigger a reload
after any remaining evict; add the missing test.

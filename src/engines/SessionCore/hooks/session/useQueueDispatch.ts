/**
 * useQueueDispatch Hook — the single queue dispatcher.
 *
 * WINDOW-STORE SINGLETON — mount exactly once for each Jotai/window store.
 * The main window mounts it from GlobalSessionSync; a detached SessionWindow
 * mounts its own instance because its durable queue is keyed by window label.
 * Cross-window turns for the same canonical root are serialized by the
 * injected executor's process-wide root lock.
 *
 * Drains `messageQueueAtom` strictly against the turn-lifecycle FSM
 * (`turnLifecycle.ts`). There is exactly one rule set:
 *
 *   - "now" priority (Send Now / post-Stop explicit submit):
 *       · session idle      → dispatch immediately.
 *       · session active    → request ONE timeline-boundary interrupt for it,
 *                             then dispatch when the provider terminal lands.
 *       · session stopping  → wait for the terminal (bounded by the FSM
 *                             stopping dead-man).
 *   - "next" priority (natural follow-ups):
 *       · dispatched FIFO, only when the session FSM is idle and the message
 *         is not held (`requiresExplicitDispatch` — set by a user Stop).
 *       · held messages are NEVER drained naturally; only Send Now can
 *         dispatch them.
 *
 * No runtime-status reads, no rendered-event heuristics, no timestamps or
 * stabilization windows: turn finality is exactly what the FSM says.
 */
import { useStore } from "jotai";
import { useCallback, useEffect, useRef } from "react";

import { getSession } from "@src/api/tauri/agent";
import { Message } from "@src/components/Message";
import {
  type AgentExecMode,
  resolveSessionAgentExecMode,
} from "@src/config/sessionCreatorConfig";
import { cancelTurnForTimelineBoundary } from "@src/engines/SessionCore/control/sessionTimelineBoundary";
import {
  beginTurnDispatch,
  beginTurnStopping,
  clearTurnLifecycleSession,
  confirmTurnRunning,
  getTurnGeneration,
  getTurnPhase,
  markTurnTerminal,
  restoreTurnWorkingAfterInterruptFailure,
} from "@src/engines/SessionCore/control/turnLifecycle";
import {
  QueuedConversationBusyError,
  type QueuedConversationExecutor,
} from "@src/engines/SessionCore/conversations/queuedConversationExecutor";
import { queueDispatchSyncInputsAtom } from "@src/engines/SessionCore/derived/queueDispatchSyncInputsAtom";
import {
  dispatchUserIntent,
  isUserIntentSendError,
} from "@src/engines/SessionCore/services/userIntentDispatch";
import { createLogger } from "@src/hooks/logger";
import {
  closePostStopDispatchEpisodeAtom,
  lastUserMessageAtom,
} from "@src/store/session/cliSessionStatusAtom";
import {
  type LastModelSelection,
  creatorDefaultModelSelectionAtom,
} from "@src/store/session/creatorDefaultModelAtom";
import { sessionMapAtom } from "@src/store/session/sessionAtom";
import {
  type QueuedMessage,
  messageQueueAtom,
  messageQueueHydratedAtom,
  queueEditingAtom,
  queuedMessageScopeKey,
} from "@src/store/ui/messageQueueAtom";
import { persistDurableMessageQueue } from "@src/store/ui/messageQueueRepository";
import { resolveModelForMessage } from "@src/util/session/resolveModelForMessage";
import { selectionFromSession } from "@src/util/session/selectionFromSession";
import {
  isAgentSession,
  isCliSession,
} from "@src/util/session/sessionDispatch";

import {
  type BackendDispatchVerdict,
  classifyBackendSessionStatus,
} from "./backendDispatchVerdict";
import {
  disposeMessageQueuePersistence,
  hydrateMessageQueue,
} from "./messageQueuePersistence";

const log = createLogger("useQueueDispatch");

/** Re-check cadence while the backend reports the session still busy. */
const QUEUE_BACKEND_RECHECK_MS = 3_000;
const CANONICAL_RECOVERY_RETRY_MAX_MS = 60_000;

function canonicalRecoveryDelayMs(attempt: number): number {
  return Math.min(
    QUEUE_BACKEND_RECHECK_MS * 2 ** Math.max(0, attempt - 1),
    CANONICAL_RECOVERY_RETRY_MAX_MS
  );
}

/**
 * Authoritative pre-dispatch gate for the natural FIFO drain.
 *
 * The turn-lifecycle FSM can be forced idle without a real provider terminal
 * (planning watchdog, dispatching dead-man, rewind boundary, stray
 * session-status broadcasts). Dispatching on a falsely-idle FSM injects the
 * queued message into the middle of a still-running turn — or into a session
 * that already died. This asks the backend — the only authority on execution
 * — before letting a natural drain proceed. Fail closed ("unknown") on RPC
 * errors: a status-read failure does not prove that a turn is idle, so keep
 * the durable queue row visible and retry instead of risking overlap.
 */
async function getBackendDispatchVerdict(
  sessionId: string
): Promise<BackendDispatchVerdict> {
  try {
    if (isCliSession(sessionId)) {
      // CLI finality is push-owned by CliTurnLifecycleCoordinator. Re-reading
      // status here would reintroduce one polling RPC per queued turn.
      return "ready";
    }
    if (isAgentSession(sessionId)) {
      const meta = await getSession(sessionId);
      return classifyBackendSessionStatus(meta?.status);
    }
    return "ready";
  } catch {
    return "unknown";
  }
}

export function useQueueDispatch(
  executeCanonicalConversation?: QueuedConversationExecutor
): void {
  const store = useStore();

  useEffect(() => {
    void hydrateMessageQueue(store);
    return () => disposeMessageQueuePersistence(store);
  }, [store]);

  // ── Dispatch lock ─────────────────────────────────────────────────────────
  // One dispatch at a time in this window store. The in-flight id additionally
  // guards the window between a successful send and the dequeue write.
  const dispatchLockRef = useRef(false);
  const inFlightMessageIdRef = useRef<string | null>(null);

  // A canonical root can execute in a different native Session after each
  // runtime switch. Keep only the currently running Session id so Send Now
  // can address the ordinary interrupt path. Busy/idle ownership remains in
  // turnLifecycle; this transient handle is never consulted as a queue gate.
  const canonicalRunnerByScopeRef = useRef<
    Map<string, { generation: number; sessionId: string }>
  >(new Map());
  // Send Now interrupt bookkeeping: one boundary interrupt per message.
  const interruptRequestedByMessageIdRef = useRef<Set<string>>(new Set());

  const acceptQueuedMessage = useCallback(
    (messageId: string) => {
      interruptRequestedByMessageIdRef.current.delete(messageId);
      store.set(messageQueueAtom, (current) =>
        current.filter((candidate) => candidate.id !== messageId)
      );
    },
    [store]
  );

  const persistCanonicalDelivery = useCallback(
    async (
      messageId: string,
      update: Pick<
        QueuedMessage,
        | "status"
        | "runnerSessionId"
        | "runnerEventStartIndex"
        | "retryAt"
        | "retryAttempt"
      >
    ) => {
      store.set(messageQueueAtom, (current) =>
        current.map((candidate) =>
          candidate.id === messageId ? { ...candidate, ...update } : candidate
        )
      );
      // This is the crash-recovery boundary: provider dispatch may proceed
      // only after the same durable queue row knows its concrete native
      // Session. The ordinary queue subscription remains the coalesced writer
      // for non-critical reorder/edit mutations.
      await persistDurableMessageQueue(store.get(messageQueueAtom));
    },
    [store]
  );

  const settleQueuedMessageFailure = useCallback(
    (message: QueuedMessage, error: unknown) => {
      // Once dispatchUserIntent has created a durable failed user row, that
      // row is the only retry owner. Failures before that boundary keep the
      // queue copy parked so the user's payload is never lost.
      store.set(messageQueueAtom, (current) =>
        isUserIntentSendError(error)
          ? current.filter((candidate) => candidate.id !== message.id)
          : current.map((candidate) =>
              candidate.id === message.id
                ? {
                    ...candidate,
                    status: "queued",
                    runnerSessionId: undefined,
                    runnerEventStartIndex: undefined,
                    retryAt: undefined,
                    retryAttempt: undefined,
                    priority: "next",
                    requiresExplicitDispatch: true,
                  }
                : candidate
            )
      );
      interruptRequestedByMessageIdRef.current.delete(message.id);
      const detail = error instanceof Error ? error.message : String(error);
      Message.error({
        content: `Failed to send message: ${detail}`,
        duration: 5000,
      });
    },
    [store]
  );

  // Pending wake-up for backend-busy retries.
  const wakeTimerRef = useRef<number | null>(null);
  const canonicalRecoveryWakeTimerRef = useRef<number | null>(null);
  const canonicalRecoveryWakeAtRef = useRef<number | null>(null);
  const tryDispatchNextRef = useRef<() => void>(() => {});
  const armCanonicalRecoveryWake = useCallback(
    function armRecoveryWake(retryAt: number) {
      if (
        canonicalRecoveryWakeAtRef.current !== null &&
        canonicalRecoveryWakeAtRef.current <= retryAt
      ) {
        return;
      }
      if (canonicalRecoveryWakeTimerRef.current !== null) {
        window.clearTimeout(canonicalRecoveryWakeTimerRef.current);
      }
      canonicalRecoveryWakeAtRef.current = retryAt;
      canonicalRecoveryWakeTimerRef.current = window.setTimeout(
        () => {
          canonicalRecoveryWakeTimerRef.current = null;
          canonicalRecoveryWakeAtRef.current = null;
          tryDispatchNextRef.current();
          const now = Date.now();
          const nextRetryAt = store
            .get(messageQueueAtom)
            .reduce<number | undefined>((earliest, message) => {
              const candidate = Date.parse(message.retryAt ?? "");
              if (candidate <= now || !Number.isFinite(candidate))
                return earliest;
              return earliest === undefined || candidate < earliest
                ? candidate
                : earliest;
            }, undefined);
          if (nextRetryAt !== undefined) armRecoveryWake(nextRetryAt);
        },
        Math.max(0, retryAt - Date.now())
      );
    },
    [store]
  );

  const dispatchMessage = useCallback(
    (msg: QueuedMessage, onDone: () => void) => {
      const { sessionId, content, displayContent, imageDataUrls } = msg;

      // Snapshot-first model/mode resolution: the QueuedMessage carries the
      // selection frozen at enqueue time; the session-row + creator-default
      // chain only covers legacy entries enqueued before snapshots existed.
      const sessionMap = store.get(sessionMapAtom);
      const session = sessionMap.get(sessionId);
      const lastModelSelection: LastModelSelection | null =
        msg.modelSelection ??
        selectionFromSession(
          session,
          store.get(creatorDefaultModelSelectionAtom)
        );
      const agentExecMode: AgentExecMode =
        msg.agentExecMode ??
        resolveSessionAgentExecMode(session?.agentExecMode);
      const { model, accountId } = resolveModelForMessage(lastModelSelection);

      // Capture the payload for Stop-restore before the async append.
      store.set(lastUserMessageAtom, {
        sessionId,
        displayContent,
        imageDataUrls,
      });

      void (async () => {
        try {
          // Pass displayContent as displayText when it differs from content
          // (i.e. skill pills were expanded) so the persisted event stores
          // the pill format and re-editing shows the pill, not the YAML.
          const displayTextForDispatch =
            content !== displayContent ? displayContent : undefined;
          await dispatchUserIntent({
            sessionId,
            visibleText: displayContent,
            imageDataUrls,
            runtimeStatusSource: "queue",
            queueMessageId: msg.id,
            send: {
              content,
              displayText: displayTextForDispatch,
              model,
              accountId,
              mode: agentExecMode,
              clientMessageId: `queued:${sessionId}:${msg.id}`,
              turnIntentId: msg.turnIntentId,
              turnIntentSource: msg.priority === "now" ? "force_send" : "queue",
              directUserIntent: true,
            },
          });
          acceptQueuedMessage(msg.id);
          onDone();
        } catch (err) {
          log.error("[useQueueDispatch] dispatch failed:", err);
          settleQueuedMessageFailure(msg, err);
          onDone();
        }
      })();
    },
    [acceptQueuedMessage, settleQueuedMessageFailure, store]
  );

  const dispatchCanonicalMessage = useCallback(
    (msg: QueuedMessage, onDone: () => void) => {
      if (!msg.conversationDispatch) {
        onDone();
        return;
      }
      const scopeKey = queuedMessageScopeKey(msg);
      const dispatchGeneration = beginTurnDispatch(scopeKey);
      // Loading and materializing a native transcript is already owned work.
      // It can legitimately outlive the dispatching dead-man before the
      // provider accepts the user turn, so enter the ordinary working phase.
      confirmTurnRunning(scopeKey);
      let accepted = false;
      let releasedDispatchLock = false;
      let runnerSessionId: string | null = null;
      const releaseDispatchLock = () => {
        if (releasedDispatchLock) return;
        releasedDispatchLock = true;
        onDone();
      };
      const rememberRunner = (sessionId: string) => {
        if (getTurnGeneration(scopeKey) !== dispatchGeneration) return;
        runnerSessionId = sessionId;
        canonicalRunnerByScopeRef.current.set(scopeKey, {
          generation: dispatchGeneration,
          sessionId,
        });
      };

      const execution = (async () => {
        await persistCanonicalDelivery(msg.id, {
          status: "preparing",
          runnerSessionId: msg.runnerSessionId,
          runnerEventStartIndex: msg.runnerEventStartIndex,
          retryAt: undefined,
          retryAttempt: msg.retryAttempt,
        });
        if (!executeCanonicalConversation) {
          throw new Error("canonical conversation executor is unavailable");
        }
        const persistedMessage =
          store
            .get(messageQueueAtom)
            .find((candidate) => candidate.id === msg.id) ?? msg;
        return await executeCanonicalConversation(store, persistedMessage, {
          onAccepted: async (sessionId) => {
            if (accepted) return;
            accepted = true;
            rememberRunner(sessionId);
            await persistCanonicalDelivery(msg.id, {
              status: "accepted",
              runnerSessionId: sessionId,
              runnerEventStartIndex:
                store
                  .get(messageQueueAtom)
                  .find((candidate) => candidate.id === msg.id)
                  ?.runnerEventStartIndex ?? msg.runnerEventStartIndex,
              retryAt: undefined,
              retryAttempt: msg.retryAttempt,
            });
            releaseDispatchLock();
          },
          onRunnerReady: async (sessionId, eventStartIndex) => {
            rememberRunner(sessionId);
            await persistCanonicalDelivery(msg.id, {
              status: "preparing",
              runnerSessionId: sessionId,
              runnerEventStartIndex: eventStartIndex,
              retryAt: undefined,
              retryAttempt: msg.retryAttempt,
            });
          },
        });
      })();

      void execution
        .then(
          (result) => {
            acceptQueuedMessage(msg.id);
            markTurnTerminal(scopeKey, result.terminalStatus, {
              generation: dispatchGeneration,
            });
          },
          async (error: unknown) => {
            if (error instanceof QueuedConversationBusyError) {
              // Another window owns this root. Persist the same bounded
              // recovery backoff as any accepted retry; a fixed 250 ms poll
              // burned CPU for the complete duration of a long provider turn.
              const current = store
                .get(messageQueueAtom)
                .find((candidate) => candidate.id === msg.id);
              if (current) {
                const attempt = (current.retryAttempt ?? 0) + 1;
                await persistCanonicalDelivery(msg.id, {
                  status: current.status,
                  runnerSessionId: current.runnerSessionId,
                  runnerEventStartIndex: current.runnerEventStartIndex,
                  retryAttempt: attempt,
                  retryAt: new Date(
                    Date.now() + canonicalRecoveryDelayMs(attempt)
                  ).toISOString(),
                });
              }
              markTurnTerminal(scopeKey, "cancelled", {
                generation: dispatchGeneration,
              });
              return;
            }
            if (!accepted) {
              settleQueuedMessageFailure(msg, error);
            } else {
              log.error(
                "[useQueueDispatch] canonical provider turn failed after acceptance:",
                error
              );
              const current = store
                .get(messageQueueAtom)
                .find((candidate) => candidate.id === msg.id);
              if (current) {
                const attempt = (current.retryAttempt ?? 0) + 1;
                await persistCanonicalDelivery(msg.id, {
                  status: current.status,
                  runnerSessionId: current.runnerSessionId,
                  runnerEventStartIndex: current.runnerEventStartIndex,
                  retryAttempt: attempt,
                  retryAt: new Date(
                    Date.now() + canonicalRecoveryDelayMs(attempt)
                  ).toISOString(),
                });
              }
            }
            markTurnTerminal(scopeKey, "failed", {
              generation: dispatchGeneration,
            });
          }
        )
        .finally(() => {
          const currentRunner = canonicalRunnerByScopeRef.current.get(scopeKey);
          if (
            currentRunner?.generation === dispatchGeneration &&
            currentRunner.sessionId === runnerSessionId
          ) {
            canonicalRunnerByScopeRef.current.delete(scopeKey);
          }
          // Canonical scope ids are virtual and do not participate in normal
          // Session deletion cleanup. Drop now-idle state eagerly.
          if (getTurnPhase(scopeKey) === "idle") {
            clearTurnLifecycleSession(scopeKey);
          }
          releaseDispatchLock();
          tryDispatchNextRef.current();
          const retryAt = Date.parse(
            store
              .get(messageQueueAtom)
              .find((candidate) => candidate.id === msg.id)?.retryAt ?? ""
          );
          if (Number.isFinite(retryAt)) {
            armCanonicalRecoveryWake(retryAt);
          }
        });
    },
    [
      acceptQueuedMessage,
      armCanonicalRecoveryWake,
      executeCanonicalConversation,
      persistCanonicalDelivery,
      settleQueuedMessageFailure,
      store,
    ]
  );

  const tryDispatchNext = useCallback(() => {
    if (wakeTimerRef.current !== null) {
      window.clearTimeout(wakeTimerRef.current);
      wakeTimerRef.current = null;
    }
    if (dispatchLockRef.current) return;
    if (!store.get(messageQueueHydratedAtom)) return;
    if (store.get(queueEditingAtom)) return;

    const queue = store.get(messageQueueAtom);
    if (queue.length === 0) return;

    const now = Date.now();
    const candidates = queue.filter(
      (msg) =>
        msg.id !== inFlightMessageIdRef.current &&
        (Number.isNaN(Date.parse(msg.retryAt ?? "")) ||
          Date.parse(msg.retryAt ?? "") <= now)
    );
    const earliestDeferredRetry = queue.reduce<number | undefined>(
      (earliest, message) => {
        const candidate = Date.parse(message.retryAt ?? "");
        if (!Number.isFinite(candidate) || candidate <= now) return earliest;
        return earliest === undefined || candidate < earliest
          ? candidate
          : earliest;
      },
      undefined
    );
    if (earliestDeferredRetry !== undefined) {
      armCanonicalRecoveryWake(earliestDeferredRetry);
    }

    // ── Explicit "now" dispatches take absolute precedence per session ───────
    // A blocked Send Now for session A must not freeze an idle session B. Scan
    // every explicit candidate, dispatch the first idle one, and request at
    // most one interrupt for each active message while continuing the pass.
    const explicitMessages = candidates.filter((msg) => msg.priority === "now");
    for (const explicitMsg of explicitMessages) {
      const scopeKey = queuedMessageScopeKey(explicitMsg);
      const phase = getTurnPhase(scopeKey);
      if (phase === "idle") {
        // One shared admission/dispatch policy owns the Stop episode for both
        // ordinary Sessions and canonical runtime continuations.
        store.set(closePostStopDispatchEpisodeAtom, explicitMsg.sessionId);
        dispatchLockRef.current = true;
        inFlightMessageIdRef.current = explicitMsg.id;
        const dispatch = explicitMsg.conversationDispatch
          ? dispatchCanonicalMessage
          : dispatchMessage;
        dispatch(explicitMsg, () => {
          if (inFlightMessageIdRef.current === explicitMsg.id) {
            inFlightMessageIdRef.current = null;
          }
          dispatchLockRef.current = false;
          tryDispatchNextRef.current();
        });
        return;
      }
      if (
        (phase === "working" || phase === "dispatching") &&
        !interruptRequestedByMessageIdRef.current.has(explicitMsg.id)
      ) {
        const interruptSessionId = explicitMsg.conversationDispatch
          ? canonicalRunnerByScopeRef.current.get(scopeKey)?.sessionId
          : explicitMsg.sessionId;
        // The canonical root may still be preparing its native Session. Until
        // onRunnerReady publishes an addressable Session there is nothing the
        // ordinary timeline-boundary interrupt can target.
        if (!interruptSessionId) continue;
        // Send Now against an active turn: interrupt it once. The provider's
        // cancelled terminal flips the FSM idle, which re-triggers this pass.
        interruptRequestedByMessageIdRef.current.add(explicitMsg.id);
        if (explicitMsg.conversationDispatch) {
          beginTurnStopping(scopeKey);
        }
        const interruptGeneration = getTurnGeneration(interruptSessionId);
        const scopeGeneration = getTurnGeneration(scopeKey);
        let interruptFailureHandled = false;
        const handleInterruptFailure = (detail: string) => {
          if (interruptFailureHandled) return;
          interruptFailureHandled = true;
          restoreTurnWorkingAfterInterruptFailure(interruptSessionId, {
            generation: interruptGeneration,
          });
          if (scopeKey !== interruptSessionId) {
            restoreTurnWorkingAfterInterruptFailure(scopeKey, {
              generation: scopeGeneration,
            });
          }
          settleQueuedMessageFailure(explicitMsg, new Error(detail));
          log.warn("[useQueueDispatch] force-send interrupt failed:", detail);
        };
        void cancelTurnForTimelineBoundary(interruptSessionId, "force-send", {
          queueSessionId: explicitMsg.sessionId,
          onError: handleInterruptFailure,
        }).catch((error) => {
          handleInterruptFailure(
            error instanceof Error ? error.message : String(error)
          );
        });
      }
      // `stopping` and already-requested interrupts wait for their own
      // terminal, but do not block dispatchable work in another session.
    }

    // ── Natural FIFO drain ──────────────────────────────────────────────────
    for (const msg of candidates) {
      if (msg.priority === "now") continue;
      if (msg.requiresExplicitDispatch) continue; // held by a user Stop
      const scopeKey = queuedMessageScopeKey(msg);
      if (getTurnPhase(scopeKey) !== "idle") continue; // turn active
      if (msg.conversationDispatch) {
        dispatchLockRef.current = true;
        inFlightMessageIdRef.current = msg.id;
        dispatchCanonicalMessage(msg, () => {
          if (inFlightMessageIdRef.current === msg.id) {
            inFlightMessageIdRef.current = null;
          }
          dispatchLockRef.current = false;
          tryDispatchNextRef.current();
        });
        return;
      }
      dispatchLockRef.current = true;
      inFlightMessageIdRef.current = msg.id;
      // Authoritative gate: the FSM can be forced idle without a real
      // provider terminal (watchdog / dead-man / rewind). Confirm with the
      // backend before injecting a natural follow-up into the session.
      void getBackendDispatchVerdict(msg.sessionId).then((verdict) => {
        if (inFlightMessageIdRef.current !== msg.id) return;
        if (verdict === "busy" || verdict === "unknown") {
          // Still executing or backend state is unknown — back off and
          // re-check. Never infer idle from a failed status read.
          inFlightMessageIdRef.current = null;
          dispatchLockRef.current = false;
          if (wakeTimerRef.current === null) {
            wakeTimerRef.current = window.setTimeout(() => {
              wakeTimerRef.current = null;
              tryDispatchNextRef.current();
            }, QUEUE_BACKEND_RECHECK_MS);
          }
          return;
        }
        if (verdict === "dead") {
          // The session terminated as failed/killed — a natural dispatch
          // would be accepted by the IPC layer and then silently swallowed
          // (no scheduler turn ever runs in a dead session). Park the
          // message visibly instead: it stays in the queue UI flagged for
          // explicit dispatch, so the user can Send Now (restart attempt),
          // edit it, or move it elsewhere. Never silently drop it.
          inFlightMessageIdRef.current = null;
          dispatchLockRef.current = false;
          store.set(messageQueueAtom, (prev) =>
            prev.map((item) =>
              item.id === msg.id
                ? { ...item, requiresExplicitDispatch: true }
                : item
            )
          );
          Message.warning({
            content: `Session has ended — queued message was kept on hold. Use Send Now to dispatch it explicitly.`,
            duration: 6000,
          });
          tryDispatchNextRef.current();
          return;
        }
        if (getTurnPhase(msg.sessionId) !== "idle") {
          // FSM re-busied while we were checking (a real dispatch won).
          inFlightMessageIdRef.current = null;
          dispatchLockRef.current = false;
          tryDispatchNextRef.current();
          return;
        }
        dispatchMessage(msg, () => {
          if (inFlightMessageIdRef.current === msg.id) {
            inFlightMessageIdRef.current = null;
          }
          dispatchLockRef.current = false;
          tryDispatchNextRef.current();
        });
      });
      return;
    }
  }, [
    dispatchCanonicalMessage,
    dispatchMessage,
    armCanonicalRecoveryWake,
    settleQueuedMessageFailure,
    store,
  ]);

  useEffect(() => {
    tryDispatchNextRef.current = tryDispatchNext;
  }, [tryDispatchNext]);

  useEffect(() => {
    const unsubscribe = store.sub(queueDispatchSyncInputsAtom, tryDispatchNext);
    tryDispatchNext();
    return () => {
      unsubscribe();
      if (wakeTimerRef.current !== null) {
        window.clearTimeout(wakeTimerRef.current);
        wakeTimerRef.current = null;
      }
      if (canonicalRecoveryWakeTimerRef.current !== null) {
        window.clearTimeout(canonicalRecoveryWakeTimerRef.current);
        canonicalRecoveryWakeTimerRef.current = null;
        canonicalRecoveryWakeAtRef.current = null;
      }
    };
  }, [store, tryDispatchNext]);
}

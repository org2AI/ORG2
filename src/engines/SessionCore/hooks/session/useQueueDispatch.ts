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

import { Message } from "@src/components/Message";
import { cancelTurnForTimelineBoundary } from "@src/engines/SessionCore/control/sessionTimelineBoundary";
import {
  getTurnGeneration,
  getTurnPhase,
  restoreTurnWorkingAfterInterruptFailure,
} from "@src/engines/SessionCore/control/turnLifecycle";
import { conversationRootKey } from "@src/engines/SessionCore/conversations/conversationTypes";
import type { QueuedConversationDispatcher } from "@src/engines/SessionCore/conversations/queuedConversationContract";
import { queueDispatchSyncInputsAtom } from "@src/engines/SessionCore/derived/queueDispatchSyncInputsAtom";
import { createLogger } from "@src/hooks/logger";
import { closePostStopDispatchEpisodeAtom } from "@src/store/session/cliSessionStatusAtom";
import {
  type QueuedMessage,
  activeMessageDeliveriesAtom,
  messageQueueAtom,
  messageQueueHydratedAtom,
  queueEditingAtom,
  queuedMessageScopeKey,
} from "@src/store/ui/messageQueueAtom";

import {
  QUEUE_BACKEND_RECHECK_MS,
  getBackendDispatchVerdict,
} from "./queueDispatchHelpers";
import { useQueueActiveDeliveries } from "./useQueueActiveDeliveries";
import {
  useQueueDeliveryHydration,
  useQueueDeliveryRefresh,
} from "./useQueueDeliveryHydration";
import { useQueueMessageDispatch } from "./useQueueMessageDispatch";

const log = createLogger("useQueueDispatch");

export function useQueueDispatch(
  executeCanonicalConversation?: QueuedConversationDispatcher
): void {
  const store = useStore();
  const messageQueueOwnerKeyRef = useRef<string | null>(null);

  useQueueDeliveryHydration(store, messageQueueOwnerKeyRef);
  useQueueDeliveryRefresh(store);

  // ── Dispatch lock ─────────────────────────────────────────────────────────
  // One dispatch at a time in this window store. The in-flight id additionally
  // guards the window between a successful send and the dequeue write.
  const dispatchLockRef = useRef(false);
  const inFlightMessageIdRef = useRef<string | null>(null);

  // Send Now interrupt bookkeeping: one boundary interrupt per message.
  const interruptRequestedByMessageIdRef = useRef<Set<string>>(new Set());

  // One bounded wake-up owner for backend-busy and accepted-delivery retries.
  const wakeTimerRef = useRef<number | null>(null);
  const wakeAtRef = useRef<number | null>(null);
  const tryDispatchNextRef = useRef<() => void>(() => {});

  const {
    settleQueuedMessageFailure,
    dispatchMessage,
    dispatchCanonicalMessage,
  } = useQueueMessageDispatch({
    store,
    interruptRequestedByMessageIdRef,
    tryDispatchNextRef,
  });

  const scheduleWakeAt = useCallback((wakeAt: number) => {
    if (wakeAtRef.current !== null && wakeAtRef.current <= wakeAt) return;
    if (wakeTimerRef.current !== null) {
      window.clearTimeout(wakeTimerRef.current);
    }
    wakeAtRef.current = wakeAt;
    wakeTimerRef.current = window.setTimeout(
      () => {
        wakeTimerRef.current = null;
        wakeAtRef.current = null;
        tryDispatchNextRef.current();
      },
      Math.max(0, wakeAt - Date.now())
    );
  }, []);

  const startRunnableActiveDeliveries = useQueueActiveDeliveries({
    store,
    executeCanonicalConversation,
    messageQueueOwnerKeyRef,
    scheduleWakeAt,
    tryDispatchNextRef,
  });

  const tryDispatchNext = useCallback(() => {
    if (!store.get(messageQueueHydratedAtom)) return;
    startRunnableActiveDeliveries();
    if (dispatchLockRef.current) return;
    if (store.get(queueEditingAtom)) return;

    const queue = store.get(messageQueueAtom);
    if (queue.length === 0) return;

    const candidates = queue.filter(
      (msg) => msg.id !== inFlightMessageIdRef.current
    );
    const activeCanonicalExecution = (message: QueuedMessage) => {
      const descriptor = message.conversationDispatch;
      if (!descriptor) return undefined;
      const rootKey = conversationRootKey(descriptor.root);
      return store
        .get(activeMessageDeliveriesAtom)
        .find(
          (delivery) =>
            conversationRootKey(delivery.conversationDispatch.root) === rootKey
        );
    };

    // ── Explicit "now" dispatches take absolute precedence per session ───────
    // A blocked Send Now for session A must not freeze an idle session B. Scan
    // every explicit candidate, dispatch the first idle one, and request at
    // most one interrupt for each active message while continuing the pass.
    const explicitMessages = candidates.filter((msg) => msg.priority === "now");
    for (const explicitMsg of explicitMessages) {
      const canonicalExecution = activeCanonicalExecution(explicitMsg);
      const canonicalRunnerSessionId = canonicalExecution?.runnerSessionId;
      const phase = explicitMsg.conversationDispatch
        ? canonicalRunnerSessionId
          ? getTurnPhase(canonicalRunnerSessionId)
          : canonicalExecution
            ? "dispatching"
            : getTurnPhase(explicitMsg.sessionId)
        : getTurnPhase(queuedMessageScopeKey(explicitMsg));
      // An execution row is the canonical root's accepted/recovery barrier.
      // Even when its concrete runner is already terminal, the next turn must
      // wait for tail publication and owner removal instead of racing recovery.
      if (phase === "idle" && !canonicalExecution) {
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
          ? canonicalExecution
            ? canonicalRunnerSessionId
            : explicitMsg.sessionId
          : explicitMsg.sessionId;
        // The canonical root may still be preparing its native Session. Until
        // onRunnerReady publishes an addressable Session there is nothing the
        // ordinary timeline-boundary interrupt can target.
        if (!interruptSessionId) continue;
        // Send Now against an active turn: interrupt it once. The provider's
        // cancelled terminal flips the FSM idle, which re-triggers this pass.
        interruptRequestedByMessageIdRef.current.add(explicitMsg.id);
        const interruptGeneration = getTurnGeneration(interruptSessionId);
        let interruptFailureHandled = false;
        const handleInterruptFailure = (detail: string) => {
          if (interruptFailureHandled) return;
          interruptFailureHandled = true;
          restoreTurnWorkingAfterInterruptFailure(interruptSessionId, {
            generation: interruptGeneration,
          });
          void settleQueuedMessageFailure(explicitMsg, new Error(detail)).catch(
            (error: unknown) =>
              log.error("Force-send failure settlement failed", error)
          );
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
    // A Stop-held head is still the FIFO head. A definitive pre-acceptance
    // failure is different: its failed bubble remains independently
    // retryable/editable, but it never entered provider history and therefore
    // must not freeze later natural messages in the same scope.
    const naturalHeadIds = new Set<string>();
    const naturalScopes = new Set<string>();
    for (const candidate of candidates) {
      if (candidate.priority === "now") continue;
      if (candidate.requiresExplicitDispatch && candidate.deliveryError)
        continue;
      const scopeKey = queuedMessageScopeKey(candidate);
      if (naturalScopes.has(scopeKey)) continue;
      naturalScopes.add(scopeKey);
      naturalHeadIds.add(candidate.id);
    }
    for (const msg of candidates) {
      if (msg.priority === "now") continue;
      if (!naturalHeadIds.has(msg.id)) continue;
      if (msg.requiresExplicitDispatch) continue; // held by a user Stop
      if (msg.conversationDispatch) {
        if (activeCanonicalExecution(msg)) continue;
        // Before the queue owns a canonical execution, the visible/source
        // Session may still be running its initial or preceding native turn.
        // Reuse the ordinary concrete-session FSM gate instead of treating the
        // absence of an execution receipt as proof that the root is idle.
        if (getTurnPhase(msg.sessionId) !== "idle") continue;
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
      const scopeKey = queuedMessageScopeKey(msg);
      if (getTurnPhase(scopeKey) !== "idle") continue; // turn active
      dispatchLockRef.current = true;
      inFlightMessageIdRef.current = msg.id;
      // Authoritative gate: the FSM can be forced idle without a real
      // provider terminal (watchdog / dead-man / rewind). Confirm with the
      // backend before injecting a natural follow-up into the session.
      void getBackendDispatchVerdict(msg.sessionId)
        .then((verdict) => {
          if (inFlightMessageIdRef.current !== msg.id) return;
          if (verdict === "busy" || verdict === "unknown") {
            // Still executing or backend state is unknown — back off and
            // re-check. Never infer idle from a failed status read.
            inFlightMessageIdRef.current = null;
            dispatchLockRef.current = false;
            scheduleWakeAt(Date.now() + QUEUE_BACKEND_RECHECK_MS);
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
        })
        .catch((error: unknown) => {
          if (inFlightMessageIdRef.current !== msg.id) return;
          inFlightMessageIdRef.current = null;
          dispatchLockRef.current = false;
          log.error("Backend queue verdict handling failed", error);
          scheduleWakeAt(Date.now() + QUEUE_BACKEND_RECHECK_MS);
        });
      return;
    }
  }, [
    dispatchCanonicalMessage,
    dispatchMessage,
    scheduleWakeAt,
    settleQueuedMessageFailure,
    startRunnableActiveDeliveries,
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
        wakeAtRef.current = null;
      }
    };
  }, [store, tryDispatchNext]);
}

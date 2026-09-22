/**
 * Pure helpers and timing constants shared by the useQueueDispatch hook and
 * the per-concern hooks it composes.
 */
import { getSession } from "@src/api/tauri/agent";
import type {
  ActiveMessageDelivery,
  QueuedMessage,
} from "@src/store/ui/messageQueueAtom";
import {
  isAgentSession,
  isCliSession,
} from "@src/util/session/sessionDispatch";

import {
  type BackendDispatchVerdict,
  classifyBackendSessionStatus,
} from "./backendDispatchVerdict";

/** Re-check cadence while the backend reports the session still busy. */
export const QUEUE_BACKEND_RECHECK_MS = 3_000;
const CANONICAL_RECOVERY_RETRY_MAX_MS = 60_000;
export const CANONICAL_HYDRATION_RETRY_MAX_MS = 30_000;

export function canonicalRecoveryDelayMs(attempt: number): number {
  return Math.min(
    QUEUE_BACKEND_RECHECK_MS * 2 ** Math.max(0, attempt - 1),
    CANONICAL_RECOVERY_RETRY_MAX_MS
  );
}

export function queuedRetryFromDelivery(
  delivery: ActiveMessageDelivery,
  error?: unknown
): QueuedMessage {
  const {
    originQueueKey: _originQueueKey,
    runnerSessionId: _runnerSessionId,
    runnerEventStartIndex: _runnerEventStartIndex,
    retryAt: _retryAt,
    retryAttempt: _retryAttempt,
    ...message
  } = delivery;
  return {
    ...message,
    priority: "next",
    requiresExplicitDispatch: true,
    status: "queued",
    ...(error
      ? {
          deliveryError: error instanceof Error ? error.message : String(error),
        }
      : {}),
  };
}

export function optimisticDeliveryProjectionParams(
  message: QueuedMessage | ActiveMessageDelivery
) {
  return {
    sessionId: message.sessionId,
    visibleText: message.displayContent,
    imageDataUrls: message.imageDataUrls,
    turnIntentId: message.turnIntentId,
    queueMessageId: message.id,
    createdAt: message.createdAt,
  };
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
export async function getBackendDispatchVerdict(
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

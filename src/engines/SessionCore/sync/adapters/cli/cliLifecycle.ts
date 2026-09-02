import {
  type TurnTerminalStatus,
  markTurnRunning,
} from "@src/engines/SessionCore/control/turnLifecycle";
import { isTurnBlockingRuntimeEvent } from "@src/engines/SessionCore/core/runningEventGate";
import { eventStoreProxy } from "@src/engines/SessionCore/core/store/EventStoreProxy";
import { createLogger } from "@src/hooks/logger";
import { setSessionRuntimeStatusAtom } from "@src/store/session/cliSessionStatusAtom";
import type { CliSessionStatus } from "@src/types/session/session";
import {
  getInstrumentedStore,
  isStoreInitialized,
} from "@src/util/core/state/instrumentedStore";

const log = createLogger("CliAdapter");

const CLI_TERMINAL_STATUSES = new Set<CliSessionStatus>([
  "completed",
  "failed",
  "error",
  "cancelled",
  "abandoned",
  "timeout",
  "archived",
]);

export function isCliTerminalStatus(
  status: CliSessionStatus | undefined
): status is CliSessionStatus {
  return status !== undefined && CLI_TERMINAL_STATUSES.has(status);
}

async function closeObservedCliTerminalEvents(
  sessionId: string,
  status: CliSessionStatus
): Promise<void> {
  const events = await eventStoreProxy.getEvents(sessionId);
  const closableEvents = events.filter((event) => {
    if (event.sessionId && event.sessionId !== sessionId) return false;
    return isTurnBlockingRuntimeEvent(event);
  });
  if (closableEvents.length === 0) return;
  const displayStatus =
    status === "failed" || status === "error" ? "failed" : "completed";
  await Promise.all(
    closableEvents.map((event) => {
      const unresolvedToolCall =
        event.actionType === "tool_call" ||
        Boolean(event.callId && event.functionName);
      return eventStoreProxy.upsert(
        {
          ...event,
          displayStatus,
          activityStatus: "processed",
          // A visible assistant stream is useful partial conversation text,
          // so terminalize it into a portable message. A running tool call is
          // different: no provider may receive it without a paired result.
          // Keep it in ORG2 as interrupted diagnostics, but leave a pending
          // result fence so native projection drops it until a real result
          // arrives and replaces this row.
          result: unresolvedToolCall
            ? { ...event.result, status: "pending", interrupted: true }
            : { ...event.result, status: displayStatus },
          isDelta: false,
        },
        sessionId
      );
    })
  );
}

export function markCliRuntimeRunning(
  sessionId: string,
  generation?: number
): void {
  markTurnRunning(sessionId, { generation });
  if (!isStoreInitialized()) return;
  getInstrumentedStore().set(setSessionRuntimeStatusAtom, {
    sessionId,
    status: "running",
    source: "sync",
  });
}

export function markObservedCliTerminalStatus(
  sessionId: string,
  status: CliSessionStatus | undefined
): Promise<void> {
  if (!isCliTerminalStatus(status) || !isStoreInitialized()) {
    return Promise.resolve();
  }
  getInstrumentedStore().set(setSessionRuntimeStatusAtom, {
    sessionId,
    status,
    source: "sync",
  });
  return closeObservedCliTerminalEvents(sessionId, status).catch((error) => {
    log.warn("[cliAdapter] failed to close terminal CLI events:", error);
  });
}

export function cliTerminalStatus(
  status: CliSessionStatus
): TurnTerminalStatus {
  if (status === "failed" || status === "error" || status === "timeout") {
    return "failed";
  }
  if (status === "cancelled" || status === "abandoned") return "cancelled";
  return "completed";
}

/**
 * One non-React direct user-intent dispatch boundary.
 *
 * UI hooks still decide whether a prompt queues, how duplicate clicks are
 * suppressed, and which runtime/model/account to use. Once a concrete Session
 * is ready, every direct path comes through this module so the synthetic user
 * row, turn generation, optimistic footer, backend acceptance, and rollback
 * cannot drift between ordinary sends and conversation continuations.
 */
import {
  beginOptimisticTurn,
  failOptimisticTurn,
} from "@src/engines/SessionCore/control/optimisticTurnStatus";
import { publishTurnIntentDispatch } from "@src/engines/SessionCore/control/turnIntentDispatchLifecycle";
import {
  beginTurnDispatch,
  confirmTurnRunning,
  markTurnTerminal,
} from "@src/engines/SessionCore/control/turnLifecycle";
import {
  pendingSyntheticEventAtom,
  sessionIdAtom,
} from "@src/engines/SessionCore/core/atoms/metadata";
import { eventStoreProxy } from "@src/engines/SessionCore/core/store/EventStoreProxy";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import { SessionService } from "@src/engines/SessionCore/services/SessionService";
import { deliverOptimisticOutgoing } from "@src/engines/SessionCore/services/optimisticOutgoingDelivery";
import type { SessionSendMessageParams } from "@src/engines/SessionCore/services/types";
import { createSyntheticUserEvent } from "@src/engines/SessionCore/sync/adapters/shared/eventFactories";
import { createLogger } from "@src/hooks/logger";
import { markSessionActive } from "@src/store/session";
import {
  type SessionRuntimeStatusSource,
  setSessionRuntimeStatusAtom,
} from "@src/store/session/cliSessionStatusAtom";
import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";
import { isCursorIdeSession } from "@src/util/session/sessionDispatch";

const log = createLogger("UserIntentDispatch");

export type UserIntentPendingPolicy =
  | "none"
  | "visible"
  | "across_session_switch";

export interface UserIntentPreparation {
  sessionId: string;
  userEvent: SessionEvent;
  generation: number;
  turnIntentId: string;
  runtimeStatusSource: SessionRuntimeStatusSource;
  pendingPolicy: UserIntentPendingPolicy;
}

interface PrepareUserIntentParams {
  sessionId: string;
  visibleText: string;
  imageDataUrls?: string[];
  turnIntentId: string;
  runtimeStatusSource?: SessionRuntimeStatusSource;
  pendingPolicy?: UserIntentPendingPolicy;
  /** Preserve the durable queue identity on a newly created optimistic row. */
  queueMessageId?: string;
  /** Runs after the synchronous lifecycle reserve and before EventStore I/O. */
  beforeAppend?: () => void | Promise<void>;
}

type UserIntentSendParams = Omit<
  SessionSendMessageParams,
  "sessionId" | "imageDataUrls" | "turnIntentId"
> & {
  turnIntentId: string;
};

export interface DispatchUserIntentParams extends Omit<
  PrepareUserIntentParams,
  "turnIntentId"
> {
  preparation?: UserIntentPreparation;
  send: UserIntentSendParams;
}

export interface DispatchUserIntentResult {
  preparation: UserIntentPreparation;
  userEvent: SessionEvent;
}

/**
 * A dispatch attempt failed after the optimistic row was durably appended.
 * Queue callers use this boundary to transfer retry ownership from the queue
 * card to the visible failed transcript row. Preparation/storage failures do
 * not use this error because the queue row is still the only durable copy.
 */
export class UserIntentSendError extends Error {
  readonly cause: unknown;
  readonly userEventId: string;

  constructor(error: unknown, userEventId: string) {
    super(
      error instanceof Error
        ? error.message
        : error == null
          ? "Failed to send message"
          : String(error)
    );
    this.name = "UserIntentSendError";
    this.cause = error;
    this.userEventId = userEventId;
  }
}

export function isUserIntentSendError(
  error: unknown
): error is UserIntentSendError {
  return error instanceof UserIntentSendError;
}

type UserIntentPreparationState = "prepared" | "accepted" | "failed";
const preparationStates = new WeakMap<
  UserIntentPreparation,
  UserIntentPreparationState
>();

function parkUserIntentEvent(
  event: SessionEvent,
  policy: UserIntentPendingPolicy
): void {
  if (policy === "none") return;
  const store = getInstrumentedStore();
  if (
    policy === "across_session_switch" ||
    store.get(sessionIdAtom) === event.sessionId
  ) {
    store.set(pendingSyntheticEventAtom, event);
  }
}

function deliveryEvent(
  event: SessionEvent,
  status: "pending" | "sent" | "failed",
  error?: unknown
): SessionEvent {
  const reason =
    status === "failed"
      ? error instanceof Error
        ? error.message
        : error == null
          ? "Failed to send message"
          : String(error)
      : undefined;
  return {
    ...event,
    displayStatus:
      status === "pending"
        ? "pending"
        : status === "failed"
          ? "failed"
          : "completed",
    result: {
      ...event.result,
      deliveryStatus: status,
      ...(reason ? { deliveryError: reason } : {}),
    },
  };
}

async function setUserIntentDelivery(
  preparation: UserIntentPreparation,
  status: "pending" | "sent" | "failed",
  error?: unknown
): Promise<void> {
  const next = deliveryEvent(preparation.userEvent, status, error);
  preparation.userEvent = next;
  parkUserIntentEvent(next, preparation.pendingPolicy);
  const updated = await eventStoreProxy.updateById(
    next.id,
    { displayStatus: next.displayStatus, result: next.result },
    preparation.sessionId
  );
  if (!updated) {
    throw new Error(
      `optimistic user event ${next.id} is missing from ${preparation.sessionId}`
    );
  }
}

export function clearParkedUserIntentEvent(userEventId: string): void {
  const store = getInstrumentedStore();
  const pending = store.get(pendingSyntheticEventAtom);
  if (pending?.id === userEventId) {
    store.set(pendingSyntheticEventAtom, null);
  }
}

/**
 * Reserve a turn and persist its canonical optimistic user row before any
 * slower transcript preparation. The returned value is dispatched in that
 * same concrete Session; canonical roots keep their own queue-visible row.
 */
export async function prepareUserIntent(
  params: PrepareUserIntentParams
): Promise<UserIntentPreparation> {
  const runtimeStatusSource = params.runtimeStatusSource ?? "dispatch";
  const pendingPolicy = params.pendingPolicy ?? "none";
  const generation = beginTurnDispatch(params.sessionId);
  publishTurnIntentDispatch(params.turnIntentId, {
    sessionId: params.sessionId,
    generation,
  });
  beginOptimisticTurn(params.sessionId, runtimeStatusSource);

  let userEvent: SessionEvent | null = null;
  try {
    await params.beforeAppend?.();
    userEvent = createSyntheticUserEvent(params.sessionId, params.visibleText, {
      imageDataUrls: params.imageDataUrls,
      turnIntentId: params.turnIntentId,
      deliveryStatus: "pending",
      queueMessageId: params.queueMessageId,
    });
    parkUserIntentEvent(userEvent, pendingPolicy);
    await eventStoreProxy.append([userEvent], params.sessionId);
    const preparation = {
      sessionId: params.sessionId,
      userEvent,
      generation,
      turnIntentId: params.turnIntentId,
      runtimeStatusSource,
      pendingPolicy,
    };
    preparationStates.set(preparation, "prepared");
    return preparation;
  } catch (error) {
    failOptimisticTurn(params.sessionId, runtimeStatusSource);
    markTurnTerminal(params.sessionId, "failed", { generation });
    if (userEvent) {
      const failed = deliveryEvent(userEvent, "failed", error);
      parkUserIntentEvent(failed, pendingPolicy);
      await eventStoreProxy
        .updateById(
          failed.id,
          { displayStatus: failed.displayStatus, result: failed.result },
          params.sessionId
        )
        .catch(() => false);
    }
    throw error;
  }
}

/** Keep a long pre-dispatch materialization outside the dispatch dead-man. */
export function confirmUserIntentPreparation(
  preparation: UserIntentPreparation
): void {
  confirmTurnRunning(preparation.sessionId);
}

/**
 * Re-assert the optimistic runtime mirror after a foreground continuation has
 * switched from its source Session to the newly materialized execution
 * Session. The initial preparation intentionally happens before navigation so
 * the user's row is visible immediately, but the session-scoped runtime-status
 * gate drops that target write while the source Session still owns the view.
 */
export function activateUserIntentPreparation(
  preparation: UserIntentPreparation
): void {
  beginOptimisticTurn(preparation.sessionId, preparation.runtimeStatusSource);
}

/** Keep an accepted Send visible as a failed row instead of retracting it. */
export async function failUserIntentPreparation(
  preparation: UserIntentPreparation,
  error: unknown
): Promise<void> {
  if (preparationStates.get(preparation) !== "prepared") return;
  preparationStates.set(preparation, "failed");
  failOptimisticTurn(preparation.sessionId, preparation.runtimeStatusSource);
  markTurnTerminal(preparation.sessionId, "failed", {
    generation: preparation.generation,
  });
  await setUserIntentDelivery(preparation, "failed", error);
}

async function resolveUserIntentPreparation(
  params: DispatchUserIntentParams
): Promise<UserIntentPreparation> {
  const existing = params.preparation;
  if (!existing) {
    return prepareUserIntent({
      sessionId: params.sessionId,
      visibleText: params.visibleText,
      imageDataUrls: params.imageDataUrls,
      turnIntentId: params.send.turnIntentId,
      runtimeStatusSource: params.runtimeStatusSource,
      pendingPolicy: params.pendingPolicy,
      beforeAppend: params.beforeAppend,
      queueMessageId: params.queueMessageId,
    });
  }
  const state = preparationStates.get(existing);
  if (
    state !== "prepared" ||
    existing.sessionId !== params.sessionId ||
    existing.turnIntentId !== params.send.turnIntentId
  ) {
    const error = new Error(
      "prepared user intent does not match this dispatch"
    );
    if (state === "prepared") {
      await failUserIntentPreparation(existing, error);
    }
    throw error;
  }
  // Native materialization may replace EventStore between preparation and
  // dispatch. Append is ID-deduped, so restore the exact same optimistic row.
  parkUserIntentEvent(existing.userEvent, existing.pendingPolicy);
  try {
    await eventStoreProxy.append([existing.userEvent], params.sessionId);
    return existing;
  } catch (error) {
    await failUserIntentPreparation(existing, error);
    throw error;
  }
}

/**
 * Persist one user row and hand the exact turn to SessionService. Backend
 * acceptance promotes the reserved generation to working; any pre-acceptance
 * failure keeps that same row visible as failed and closes its generation.
 */
export async function dispatchUserIntent(
  params: DispatchUserIntentParams
): Promise<DispatchUserIntentResult> {
  const preparation = await resolveUserIntentPreparation(params);
  try {
    await deliverOptimisticOutgoing({
      send: () =>
        SessionService.sendMessage({
          sessionId: params.sessionId,
          ...params.send,
          imageDataUrls: params.imageDataUrls,
        }),
      markSent: () => setUserIntentDelivery(preparation, "sent"),
      markFailed: (error) => failUserIntentPreparation(preparation, error),
      onProjectionError: (phase, error) => {
        log.error(
          `Failed to project ${phase} delivery for ${params.sessionId}`,
          error
        );
      },
    });
  } catch (error) {
    // markFailed is idempotent and already patched the same EventStore row.
    await failUserIntentPreparation(preparation, error);
    throw new UserIntentSendError(error, preparation.userEvent.id);
  }
  // Transport acceptance is the delivery boundary. Later local bookkeeping
  // must never downgrade that same row from sent to failed.
  preparationStates.set(preparation, "accepted");
  confirmTurnRunning(params.sessionId);
  markSessionActive(params.sessionId);
  if (isCursorIdeSession(params.sessionId)) {
    getInstrumentedStore().set(setSessionRuntimeStatusAtom, {
      sessionId: params.sessionId,
      status: "idle",
      source: preparation.runtimeStatusSource,
    });
    markTurnTerminal(params.sessionId, "completed", {
      generation: preparation.generation,
    });
  }
  return { preparation, userEvent: preparation.userEvent };
}

import { atom } from "jotai";

import type { AgentExecMode } from "@src/config/sessionCreatorConfig";
import { projectOutgoingUserMessage } from "@src/engines/ChatPanel/hooks/useInputArea/projectOutgoingUserMessage";
import { conversationRootKey } from "@src/engines/SessionCore/conversations/conversationTypes";
import type { QueuedConversationDispatch } from "@src/engines/SessionCore/conversations/queuedConversationExecutor";
import { mintTurnIntentId } from "@src/engines/SessionCore/sync/adapters/shared/eventFactories";
import type { LastModelSelection } from "@src/store/session/creatorDefaultModelAtom";
import { isCliSession } from "@src/util/session/sessionDispatch";

// ============================================
// Types
// ============================================

export type QueuedMessagePriority = "now" | "next";
export type QueuedMessageDeliveryState = "queued" | "preparing" | "accepted";

export interface QueuedMessage {
  id: string;
  /**
   * Canonical user-intent id. Minted once at the submit boundary
   * (ChatPanel / queue / Send Now / Resume) and propagated through:
   *
   *   QueuedMessage           (this field)
   *   createSyntheticUserEvent options.turnIntentId
   *   SessionService.sendMessage params.turnIntentId
   *   agent_send_message Tauri command turnIntentId
   *   ScheduledMessage.turn_intent_id
   *   TurnInput.turn_intent_id
   *   persist_user_message_event(... turn_intent_id ...)
   *   session_turn_intents row
   *
   * The turn indexer reads `result.turnIntentId` off both the synthetic
   * row (when the FE supplies one) and the backend-persisted row, and
   * groups them under the same logical round. See the lifecycle store in
   * `session-persistence::turn_intents`.
   */
  turnIntentId: string;
  sessionId: string;
  content: string;
  displayContent: string;
  imageDataUrls?: string[];
  conversationDispatch?: QueuedConversationDispatch;
  /**
   * Snapshot of model/account selection at enqueue time. Frozen here
   * so a model swap done while the queue is draining cannot retroactively
   * change which model an already-queued message is sent with.
   */
  modelSelection?: LastModelSelection;
  /**
   * Snapshot of the agent exec mode at enqueue time. Same rationale as
   * `modelSelection` — without this snapshot, switching from Plan to
   * Build mid-queue (or being switched by the `mode_switch` card) would
   * silently re-target every still-pending message in the queue.
   * `undefined` means "use whatever mode the session row has at dispatch
   * time" (which is the legacy behaviour and what callers that don't
   * care about a specific mode should keep doing).
   */
  agentExecMode?: AgentExecMode;
  /**
   * Dispatch priority.
   * - "next": natural follow-up — drains FIFO once the turn-lifecycle FSM
   *   reports the session idle.
   * - "now": explicit user dispatch (Send Now, or a submit issued after a
   *   user Stop) — jumps ahead of every "next" item and may interrupt an
   *   active turn via the timeline boundary.
   */
  priority: QueuedMessagePriority;
  /**
   * Set when the user pressed Stop while this message was parked. The
   * natural drain skips these permanently; only an explicit user action
   * (Send Now — which flips priority to "now" and clears this flag) can
   * dispatch them.
   */
  requiresExplicitDispatch?: boolean;
  /**
   * Durable delivery state for the same queue row. Canonical continuations
   * keep the row through provider completion so a renderer restart can
   * reconnect to the exact native turn instead of replaying it.
   */
  status: QueuedMessageDeliveryState;
  /** Concrete native Session selected before provider dispatch. */
  runnerSessionId?: string;
  /** Verified native prefix used by the live overlay once materialized. */
  runnerEventStartIndex?: number;
  /** Durable recovery backoff for an accepted canonical turn. */
  retryAt?: string;
  retryAttempt?: number;
  createdAt: string;
}

export const MAX_QUEUED_MESSAGES = 100;
export const MAX_QUEUED_MESSAGES_PER_SESSION = 25;
export const MAX_QUEUED_MESSAGE_CHARS = 8 * 1024 * 1024;
export const MAX_QUEUED_MESSAGE_CHARS_TOTAL = 32 * 1024 * 1024;

export type QueueAdmissionResult =
  | "enqueued"
  | "duplicate"
  | "message_too_large"
  | "session_limit"
  | "queue_limit";

export function queuedMessageCharSize(message: QueuedMessage): number {
  return (
    message.content.length +
    message.displayContent.length +
    (message.imageDataUrls ?? []).reduce(
      (total, image) => total + image.length,
      0
    )
  );
}

export function queuedMessageScopeKey(message: QueuedMessage): string {
  return message.conversationDispatch
    ? `conversation:${conversationRootKey(message.conversationDispatch.root)}`
    : message.sessionId;
}

export function queueAdmissionResult(
  current: readonly QueuedMessage[],
  message: QueuedMessage
): Exclude<QueueAdmissionResult, "enqueued" | "duplicate"> | null {
  const messageSize = queuedMessageCharSize(message);
  if (messageSize > MAX_QUEUED_MESSAGE_CHARS) return "message_too_large";
  if (
    current.filter(
      (item) => queuedMessageScopeKey(item) === queuedMessageScopeKey(message)
    ).length >= MAX_QUEUED_MESSAGES_PER_SESSION
  ) {
    return "session_limit";
  }
  if (current.length >= MAX_QUEUED_MESSAGES) return "queue_limit";
  const totalSize = current.reduce(
    (total, item) => total + queuedMessageCharSize(item),
    messageSize
  );
  return totalSize > MAX_QUEUED_MESSAGE_CHARS_TOTAL ? "queue_limit" : null;
}

/** Keep only the oldest valid rows when recovering an oversized snapshot. */
export function boundQueuedMessages(
  messages: readonly QueuedMessage[]
): QueuedMessage[] {
  const bounded: QueuedMessage[] = [];
  for (const message of messages) {
    if (!queueAdmissionResult(bounded, message)) bounded.push(message);
  }
  return bounded;
}

// ============================================
// Core Atom — THE single queue
// ============================================

export const messageQueueAtom = atom<QueuedMessage[]>([]);
messageQueueAtom.debugLabel = "messageQueueAtom";

/** True once the durable queue snapshot has been merged into this Jotai store. */
export const messageQueueHydratedAtom = atom(false);
messageQueueHydratedAtom.debugLabel = "messageQueueHydratedAtom";

/** Tracks which queued message is currently being edited in the main input box. */
export interface QueueEditTarget {
  messageId: string;
  content: string;
  imageDataUrls?: string[];
}
export const queueEditTargetAtom = atom<QueueEditTarget | null>(null);
queueEditTargetAtom.debugLabel = "queueEditTargetAtom";

/** True while a queued message is being edited — dispatch is paused. Derived from queueEditTargetAtom. */
export const queueEditingAtom = atom(
  (get) => get(queueEditTargetAtom) !== null
);
queueEditingAtom.debugLabel = "queueEditingAtom";

// ============================================
// Write Atoms
// ============================================

export const enqueueMessageAtom = atom(
  null,
  (get, set, message: QueuedMessage): QueueAdmissionResult => {
    const current = get(messageQueueAtom);
    // The submit boundary always mints this canonical identity, including for
    // hydrated durable rows. Text is not identity: the user may intentionally
    // send the same content more than once.
    const duplicate = current.some(
      (existing) => existing.turnIntentId === message.turnIntentId
    );
    if (duplicate) return "duplicate";
    const rejected = queueAdmissionResult(current, message);
    if (rejected) return rejected;

    set(messageQueueAtom, [...current, message]);
    return "enqueued";
  }
);
enqueueMessageAtom.debugLabel = "enqueueMessageAtom";

export const dequeueMessageAtom = atom(null, (_get, set, messageId: string) => {
  set(messageQueueAtom, (prev) =>
    prev.filter((msg) => msg.id !== messageId || msg.status !== "queued")
  );
});
dequeueMessageAtom.debugLabel = "dequeueMessageAtom";

/**
 * Send Now: promote a parked message to an explicit "now" dispatch. The
 * queue dispatcher interrupts the active turn (timeline boundary) if needed
 * and dispatches this message the moment the session is idle. Clearing
 * `requiresExplicitDispatch` lifts a previous Stop hold — Send Now IS the
 * explicit dispatch.
 */
export const forceSendMessageAtom = atom(
  null,
  (get, set, messageId: string) => {
    if (
      !get(messageQueueAtom).some(
        (msg) => msg.id === messageId && msg.status === "queued"
      )
    ) {
      return;
    }
    set(messageQueueAtom, (prev) =>
      prev.map((msg) =>
        msg.id === messageId && msg.status === "queued"
          ? {
              ...msg,
              // Send Now is an explicit new dispatch attempt. A recovered
              // queued row may point at an immutable stale/coalesced/rejected
              // backend intent; minting here prevents that terminal id from
              // making the visible retry permanently unrunnable.
              turnIntentId: mintTurnIntentId(),
              priority: "now",
              requiresExplicitDispatch: false,
              retryAt: undefined,
              retryAttempt: undefined,
            }
          : msg
      )
    );
  }
);
forceSendMessageAtom.debugLabel = "forceSendMessageAtom";

/**
 * Stop boundary: park every queued message of the session. Held messages are
 * permanently skipped by the natural drain — only Send Now (or queue edit
 * actions) can dispatch them afterwards.
 */
export const parkSessionQueuedMessagesAfterStopAtom = atom(
  null,
  (get, set, sessionId: string) => {
    const current = get(messageQueueAtom);
    const conversationKeys = new Set(
      current.flatMap((message) =>
        message.sessionId === sessionId && message.conversationDispatch
          ? [conversationRootKey(message.conversationDispatch.root)]
          : []
      )
    );
    set(messageQueueAtom, (prev) =>
      prev.map((msg) =>
        (msg.sessionId === sessionId ||
          (msg.conversationDispatch !== undefined &&
            conversationKeys.has(
              conversationRootKey(msg.conversationDispatch.root)
            ))) &&
        msg.status === "queued" &&
        !msg.requiresExplicitDispatch
          ? { ...msg, requiresExplicitDispatch: true }
          : msg
      )
    );
  }
);
parkSessionQueuedMessagesAfterStopAtom.debugLabel =
  "parkSessionQueuedMessagesAfterStopAtom";

export const clearSessionQueueAtom = atom(
  null,
  (get, set, sessionId: string) => {
    const current = get(messageQueueAtom);
    const conversationKeys = new Set(
      current.flatMap((message) =>
        message.sessionId === sessionId && message.conversationDispatch
          ? [conversationRootKey(message.conversationDispatch.root)]
          : []
      )
    );
    set(messageQueueAtom, (prev) =>
      prev.filter(
        (msg) =>
          msg.status !== "queued" ||
          (msg.sessionId !== sessionId &&
            (msg.conversationDispatch === undefined ||
              !conversationKeys.has(
                conversationRootKey(msg.conversationDispatch.root)
              )))
      )
    );
  }
);
clearSessionQueueAtom.debugLabel = "clearSessionQueueAtom";

/** Remove an exact visible queue projection without touching other Sessions. */
export const clearQueuedMessagesAtom = atom(
  null,
  (_get, set, messageIds: readonly string[]) => {
    if (messageIds.length === 0) return;
    const ids = new Set(messageIds);
    set(messageQueueAtom, (prev) =>
      prev.filter(
        (message) => message.status !== "queued" || !ids.has(message.id)
      )
    );
  }
);
clearQueuedMessagesAtom.debugLabel = "clearQueuedMessagesAtom";

export const editMessageAtom = atom(
  null,
  (
    _get,
    set,
    update: {
      messageId: string;
      /** The edited DISPLAY text (serialized editor form, pills intact). */
      content: string;
      imageDataUrls?: string[];
      modelSelection?: LastModelSelection;
      agentExecMode?: AgentExecMode;
    }
  ) => {
    let updated = false;
    set(messageQueueAtom, (prev) =>
      prev.map((msg) => {
        if (msg.id !== update.messageId || msg.status !== "queued") return msg;
        const nextImageDataUrls =
          update.imageDataUrls !== undefined
            ? update.imageDataUrls
            : msg.imageDataUrls;
        const draftSize =
          update.content.length * 2 +
          (nextImageDataUrls ?? []).reduce(
            (total, image) => total + image.length,
            0
          );
        if (draftSize > MAX_QUEUED_MESSAGE_CHARS) return msg;
        // The edit surface returns the display form, but `content` is what
        // the queue dispatcher sends to the model. Re-run the shared
        // projection so a saved edit can neither regress the agent copy to
        // raw pill serialization nor surface the agent contract as visible
        // text. Canvas interception mirrors the live submit gates: no
        // contract for CLI sessions or image-carrying messages.
        const projection = projectOutgoingUserMessage({
          displayText: update.content,
          allowCanvasInterception:
            !(nextImageDataUrls && nextImageDataUrls.length > 0) &&
            !isCliSession(msg.sessionId),
        });
        const next: QueuedMessage = {
          ...msg,
          // Saving an edit is a new logical user intent. The previous id may
          // already be a durable stale/rejected pre-run terminal after a
          // crash; terminal intent ids are immutable and cannot be safely
          // resurrected with different content.
          turnIntentId: mintTurnIntentId(),
          content: projection.agentContent ?? projection.displayContent,
          displayContent: projection.displayContent,
          ...(update.imageDataUrls !== undefined && {
            imageDataUrls: update.imageDataUrls,
          }),
          ...(update.modelSelection !== undefined && {
            modelSelection: update.modelSelection,
          }),
          ...(update.agentExecMode !== undefined && {
            agentExecMode: update.agentExecMode,
          }),
          retryAt: undefined,
          retryAttempt: undefined,
        };
        const siblings = prev.filter((item) => item.id !== msg.id);
        if (queueAdmissionResult(siblings, next)) return msg;
        updated = true;
        return next;
      })
    );
    return updated;
  }
);
editMessageAtom.debugLabel = "editMessageAtom";

export const reorderQueueAtom = atom(
  null,
  (
    _get,
    set,
    { fromIndex, toIndex }: { fromIndex: number; toIndex: number }
  ) => {
    set(messageQueueAtom, (prev) => {
      if (
        fromIndex === toIndex ||
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= prev.length ||
        toIndex >= prev.length ||
        prev[fromIndex]?.status !== "queued" ||
        prev[toIndex]?.status !== "queued"
      ) {
        return prev;
      }
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  }
);
reorderQueueAtom.debugLabel = "reorderQueueAtom";

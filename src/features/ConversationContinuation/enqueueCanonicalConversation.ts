import type { Store } from "jotai/vanilla/store";

import type {
  ConversationRootLocator,
  LocalConversationTarget,
} from "@src/engines/SessionCore/conversations/conversationTypes";
import { flushMessageQueuePersistence } from "@src/engines/SessionCore/hooks/session/messageQueuePersistence";
import {
  appendOptimisticQueueUserDelivery,
  removeOptimisticQueueUserDelivery,
} from "@src/engines/SessionCore/services/userIntentDispatch";
import { mintTurnIntentId } from "@src/engines/SessionCore/sync/adapters/shared/eventFactories";
import {
  org2CloudAuthAtom,
  org2CloudAuthIdentityKey,
} from "@src/features/Org2Cloud/org2CloudAuthAtom";
import { postStopDispatchSessionsAtom } from "@src/store/session/cliSessionStatusAtom";
import {
  type QueuedMessage,
  clearQueuedMessagesAtom,
  enqueueMessageAtom,
  messageQueueAtom,
  queueAdmissionResult,
} from "@src/store/ui/messageQueueAtom";

interface CanonicalConversationQueueInput {
  displayText: string;
  agentContent?: string;
  imageDataUrls?: string[];
  /** Preserve the durable intent identity when retrying a failed delivery. */
  turnIntentId?: string;
}

export class CanonicalConversationQueueAdmissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanonicalConversationQueueAdmissionError";
  }
}

/**
 * Compose a canonical turn into the application's one durable UI queue.
 * The queue remains the only component allowed to drain it; the neutral
 * SessionCore conversation layer never imports this client-state adapter.
 */
export async function enqueueCanonicalConversation(params: {
  store: Store;
  root: ConversationRootLocator;
  sessionId: string;
  input: CanonicalConversationQueueInput;
  target: LocalConversationTarget;
}): Promise<boolean> {
  const { store, root, sessionId, input, target } = params;
  const id = `queued-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const turnIntentId = input.turnIntentId ?? mintTurnIntentId();
  const dispatchIdentityKey =
    root.authority === "org2-cloud"
      ? (() => {
          const auth = store.get(org2CloudAuthAtom);
          if (!auth) {
            throw new CanonicalConversationQueueAdmissionError(
              "Cloud sign-in is required before queuing this turn"
            );
          }
          return org2CloudAuthIdentityKey(auth);
        })()
      : undefined;
  const explicitPostStopSubmit =
    store.get(postStopDispatchSessionsAtom)[sessionId] === true;
  const message: QueuedMessage = {
    id,
    turnIntentId,
    sessionId,
    content: input.agentContent ?? input.displayText,
    displayContent: input.displayText,
    imageDataUrls: input.imageDataUrls,
    conversationDispatch: {
      kind: "canonical_conversation",
      root,
      target,
      ...(dispatchIdentityKey ? { dispatchIdentityKey } : {}),
    },
    priority: explicitPostStopSubmit ? "now" : "next",
    status: "queued",
    createdAt: new Date().toISOString(),
  };
  const current = store.get(messageQueueAtom);
  if (
    current.some(
      (candidate) =>
        candidate.id === message.id ||
        candidate.turnIntentId === message.turnIntentId
    )
  ) {
    return true;
  }
  const rejected = queueAdmissionResult(current, message);
  if (rejected) {
    throw new CanonicalConversationQueueAdmissionError(
      rejected === "message_too_large"
        ? "Queued message is too large"
        : "Message queue is full; send or remove a queued message first"
    );
  }

  // Stage the row behind the existing explicit-dispatch hold. This keeps the
  // singleton queue dispatcher from claiming it until its durable recovery
  // owner exists and the visible EventStore projection has been published.
  const stagedMessage: QueuedMessage = {
    ...message,
    priority: "next",
    requiresExplicitDispatch: true,
  };
  const result = store.set(enqueueMessageAtom, stagedMessage);
  if (result === "duplicate") {
    return true;
  }
  if (result !== "enqueued") {
    throw new CanonicalConversationQueueAdmissionError(
      result === "message_too_large"
        ? "Queued message is too large"
        : "Message queue is full; send or remove a queued message first"
    );
  }

  let durableOwnerCommitted = false;
  try {
    // Commit the recovery owner first. A process exit after this boundary can
    // recover (or visibly hold) the intent; it can never strand a transcript
    // row whose queue owner existed only in renderer memory.
    await flushMessageQueuePersistence(store);
    durableOwnerCommitted = true;
    await appendOptimisticQueueUserDelivery({
      sessionId,
      visibleText: input.displayText,
      imageDataUrls: input.imageDataUrls,
      turnIntentId,
      queueMessageId: id,
      createdAt: message.createdAt,
    });
  } catch (error) {
    if (!durableOwnerCommitted) {
      store.set(clearQueuedMessagesAtom, [id]);
      await flushMessageQueuePersistence(store).catch(() => undefined);
      throw new CanonicalConversationQueueAdmissionError(
        `Unable to save queued message: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
    // Roll back in the inverse order: the durable held queue row remains the
    // recovery owner until EventStore proves that no pending projection is
    // left. If EventStore itself is unavailable, retaining that held owner is
    // safer than producing the orphan this barrier exists to prevent.
    const projectionRemoved = await removeOptimisticQueueUserDelivery({
      sessionId,
      queueMessageId: id,
    })
      .then(() => true)
      .catch(() => false);
    if (projectionRemoved) {
      store.set(clearQueuedMessagesAtom, [id]);
      await flushMessageQueuePersistence(store).catch(() => undefined);
    }
    throw new CanonicalConversationQueueAdmissionError(
      `Unable to save queued message: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  // Release the staged row only after both durable owner and pending bubble
  // exist. The ordinary queue persistence/dispatch owner handles every later
  // transition, including a post-Stop priority of "now".
  store.set(messageQueueAtom, (queue) =>
    queue.map((candidate) => (candidate.id === id ? message : candidate))
  );
  return true;
}

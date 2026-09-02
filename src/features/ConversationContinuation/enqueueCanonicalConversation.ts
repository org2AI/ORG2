import type { Store } from "jotai/vanilla/store";

import {
  admitUserIntentToMessageQueue,
  isExplicitPostStopSubmit,
} from "@src/engines/SessionCore/control/messageQueueAdmission";
import type {
  ConversationRootLocator,
  LocalConversationTarget,
} from "@src/engines/SessionCore/conversations/conversationTypes";
import { mintTurnIntentId } from "@src/engines/SessionCore/sync/adapters/shared/eventFactories";
import {
  org2CloudAuthAtom,
  org2CloudAuthIdentityKey,
} from "@src/features/Org2Cloud/org2CloudAuthAtom";

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
  const result = admitUserIntentToMessageQueue({
    store,
    explicitPostStopSubmit: isExplicitPostStopSubmit(store, sessionId),
    message: {
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
      status: "queued",
      createdAt: new Date().toISOString(),
    },
  });
  if (result === "duplicate") return true;
  if (result !== "enqueued") {
    throw new CanonicalConversationQueueAdmissionError(
      result === "message_too_large"
        ? "Queued message is too large"
        : "Message queue is full; send or remove a queued message first"
    );
  }
  return true;
}

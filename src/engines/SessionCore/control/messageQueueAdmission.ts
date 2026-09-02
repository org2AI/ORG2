import type { Store } from "jotai/vanilla/store";

import { postStopDispatchSessionsAtom } from "@src/store/session/cliSessionStatusAtom";
import {
  type QueueAdmissionResult,
  type QueuedMessage,
  enqueueMessageAtom,
} from "@src/store/ui/messageQueueAtom";

/**
 * Admit every user-authored queued turn through the same post-Stop policy.
 *
 * Runtime continuation changes where a queued turn executes, not how Stop,
 * Send Now, or explicit queue release behave. Keeping that decision here
 * prevents canonical/imported conversations from silently bypassing the
 * ordinary composer contract.
 */
export function admitUserIntentToMessageQueue(params: {
  store: Store;
  message: Omit<QueuedMessage, "priority">;
  explicitPostStopSubmit: boolean;
}): QueueAdmissionResult {
  const { store, message, explicitPostStopSubmit } = params;
  const result = store.set(enqueueMessageAtom, {
    ...message,
    priority: explicitPostStopSubmit ? "now" : "next",
  });

  return result;
}

export function isExplicitPostStopSubmit(
  store: Store,
  sessionId: string,
  restoredStopDraft = false
): boolean {
  return (
    restoredStopDraft ||
    store.get(postStopDispatchSessionsAtom)[sessionId] === true
  );
}

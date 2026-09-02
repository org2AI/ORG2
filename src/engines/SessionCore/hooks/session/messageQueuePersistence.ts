import type { Store } from "jotai/vanilla/store";

import {
  type QueuedMessage,
  boundQueuedMessages,
  messageQueueAtom,
  messageQueueHydratedAtom,
} from "@src/store/ui/messageQueueAtom";
import {
  loadDurableMessageQueue,
  persistDurableMessageQueue,
} from "@src/store/ui/messageQueueRepository";

function persistQueueBestEffort(store: Store): void {
  void persistDurableMessageQueue(store.get(messageQueueAtom)).catch(
    (error) => {
      console.warn("[messageQueuePersistence] failed to persist queue", error);
    }
  );
}

const hydrationByStore = new WeakMap<Store, Promise<void>>();
const unsubscribeByStore = new WeakMap<Store, () => void>();

function mergeQueues(
  durable: readonly QueuedMessage[],
  live: readonly QueuedMessage[]
): QueuedMessage[] {
  const byIntent = new Map<string, QueuedMessage>();
  // Legacy/plain queued rows may have crossed an old backend-ACK/dequeue crash
  // window, so keep those parked for an explicit Send Now. Modern canonical
  // rows persist preparing/accepted plus their runner Session and reconnect to
  // that exact turn automatically; downgrading them would strand a live native
  // turn and invite an unsafe replay.
  for (const message of durable) {
    byIntent.set(message.turnIntentId, {
      ...message,
      ...(message.status === "queued"
        ? { priority: "next" as const, requiresExplicitDispatch: true }
        : {}),
    });
  }
  // Live mutations made while the async disk read was pending win.
  for (const message of live) byIntent.set(message.turnIntentId, message);
  return boundQueuedMessages(
    [...byIntent.values()].sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt)
    )
  );
}

/**
 * Hydrate then subscribe one Jotai store. The WeakMap ownership supports test
 * stores and multiple windows without app-lifetime listener leaks.
 */
export function hydrateMessageQueue(store: Store): Promise<void> {
  const existing = hydrationByStore.get(store);
  if (existing) return existing;

  const hydration = loadDurableMessageQueue()
    .then((durable) => {
      store.set(messageQueueAtom, (live) => mergeQueues(durable, live));
      store.set(messageQueueHydratedAtom, true);
      persistQueueBestEffort(store);
      if (!unsubscribeByStore.has(store)) {
        const unsubscribe = store.sub(messageQueueAtom, () => {
          persistQueueBestEffort(store);
        });
        unsubscribeByStore.set(store, unsubscribe);
      }
    })
    .catch(() => {
      // The repository already logs the root error. Keep the queue usable in
      // memory rather than blocking all sends when persistence is unavailable.
      store.set(messageQueueHydratedAtom, true);
    });

  hydrationByStore.set(store, hydration);
  return hydration;
}

export function disposeMessageQueuePersistence(store: Store): void {
  unsubscribeByStore.get(store)?.();
  unsubscribeByStore.delete(store);
  hydrationByStore.delete(store);
  store.set(messageQueueHydratedAtom, false);
}

import type { Store } from "jotai/vanilla/store";

import {
  type ActiveMessageDelivery,
  type MessageDeliveryRecord,
  type QueuedMessage,
  boundQueuedMessages,
  isActiveMessageDelivery,
  isQueuedMessageDelivery,
  messageDeliveryRecordsAtom,
  messageQueueAtom,
  messageQueueHandoffIdsAtom,
  messageQueueHydratedAtom,
} from "@src/store/ui/messageQueueAtom";
import {
  type ActiveMessageDeliveryUpdate,
  assertDurableActiveDeliveryIsRootHead,
  handoffDurableMessageDelivery,
  loadDurableMessageDeliveries,
  persistDurableMessageQueue,
  removeDurableActiveMessageDelivery,
  returnDurableMessageDeliveryToQueue,
  updateDurableActiveMessageDelivery,
} from "@src/store/ui/messageQueueRepository";

const MUTATION_CHANNEL_NAME = "orgii:message-deliveries";

const queueRevisionByStore = new WeakMap<Store, number>();
const queuePersistByStore = new WeakMap<Store, Promise<void>>();
const lastObservedQueueByStore = new WeakMap<Store, readonly QueuedMessage[]>();
const hydrationByStore = new WeakMap<Store, Promise<void>>();
const unsubscribeByStore = new WeakMap<Store, () => void>();
const mutationGenerationByStore = new WeakMap<Store, number>();
const externalRefreshByStore = new WeakMap<Store, Promise<void>>();
const hydratedStores = new Set<Store>();
let mutationChannel: BroadcastChannel | null = null;

function sameQueue(
  left: readonly QueuedMessage[] | undefined,
  right: readonly QueuedMessage[]
): boolean {
  return (
    left !== undefined &&
    left.length === right.length &&
    left.every((message, index) => message === right[index])
  );
}

function persistQueueBestEffort(store: Store): Promise<void> {
  const write = persistDurableMessageQueue(store.get(messageQueueAtom));
  queuePersistByStore.set(store, write);
  void write.catch((error) => {
    console.warn("[messageQueuePersistence] failed to persist queue", error);
  });
  return write;
}

/**
 * Wait until the current queue projection has reached the existing durable
 * delivery registry. Callers use this as a commit barrier before publishing
 * side effects whose recovery depends on that queue row.
 */
export async function flushMessageQueuePersistence(
  store: Store
): Promise<void> {
  let write = queuePersistByStore.get(store) ?? persistQueueBestEffort(store);
  for (;;) {
    await write;
    const latest = queuePersistByStore.get(store);
    if (!latest || latest === write) return;
    write = latest;
  }
}

function installQueuePersistence(store: Store): void {
  if (unsubscribeByStore.has(store)) return;
  lastObservedQueueByStore.set(store, store.get(messageQueueAtom));
  const unsubscribe = store.sub(messageDeliveryRecordsAtom, () => {
    const queue = store.get(messageQueueAtom);
    if (sameQueue(lastObservedQueueByStore.get(store), queue)) return;
    lastObservedQueueByStore.set(store, queue);
    queueRevisionByStore.set(store, (queueRevisionByStore.get(store) ?? 0) + 1);
    persistQueueBestEffort(store);
  });
  unsubscribeByStore.set(store, unsubscribe);
}

function mergeHydratedQueue(
  durable: readonly QueuedMessage[],
  live: readonly QueuedMessage[],
  active: readonly ActiveMessageDelivery[]
): QueuedMessage[] {
  const activeIntents = new Set(active.map((row) => row.turnIntentId));
  const byIntent = new Map<string, QueuedMessage>();
  for (const message of durable) {
    if (activeIntents.has(message.turnIntentId)) continue;
    byIntent.set(message.turnIntentId, {
      ...message,
      priority: "next",
      requiresExplicitDispatch: true,
    });
  }
  for (const message of live) {
    if (!activeIntents.has(message.turnIntentId)) {
      byIntent.set(message.turnIntentId, message);
    }
  }
  return boundQueuedMessages(
    [...byIntent.values()].sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt)
    )
  );
}

function publishRecords(
  store: Store,
  queue: readonly QueuedMessage[],
  active: readonly ActiveMessageDelivery[]
): void {
  const nextQueue = [...queue];
  lastObservedQueueByStore.set(store, nextQueue);
  store.set(messageDeliveryRecordsAtom, [...nextQueue, ...active]);
}

function mutationGeneration(store: Store): number {
  return mutationGenerationByStore.get(store) ?? 0;
}

function noteLocalMutation(store: Store): void {
  mutationGenerationByStore.set(store, mutationGeneration(store) + 1);
}

function ensureMutationChannel(): BroadcastChannel | null {
  if (mutationChannel || typeof BroadcastChannel === "undefined") {
    return mutationChannel;
  }
  mutationChannel = new BroadcastChannel(MUTATION_CHANNEL_NAME);
  mutationChannel.addEventListener("message", () => {
    for (const store of hydratedStores) {
      mutationGenerationByStore.set(store, mutationGeneration(store) + 1);
      if (externalRefreshByStore.has(store)) continue;
      const refresh = (async () => {
        let observed: number;
        do {
          observed = mutationGeneration(store);
          await refreshMessageDeliveries(store);
        } while (observed !== mutationGeneration(store));
      })()
        .catch((error) =>
          console.warn(
            "[messageQueuePersistence] cross-window refresh failed",
            error
          )
        )
        .finally(() => externalRefreshByStore.delete(store));
      externalRefreshByStore.set(store, refresh);
    }
  });
  return mutationChannel;
}

function broadcastMutation(): void {
  ensureMutationChannel()?.postMessage({ type: "changed" });
}

function hydrateMessageQueueFromSnapshot(
  store: Store,
  durable: readonly QueuedMessage[],
  active: readonly ActiveMessageDelivery[] = []
): void {
  const queue = mergeHydratedQueue(
    durable,
    store.get(messageQueueAtom),
    active
  );
  publishRecords(store, queue, active);
  installQueuePersistence(store);
}

/** One hydration owner for queued, preparing, and accepted deliveries. */
export function hydrateMessageQueue(store: Store): Promise<void> {
  const existing = hydrationByStore.get(store);
  if (existing) return existing;
  hydratedStores.add(store);
  ensureMutationChannel();
  const hydration = (async () => {
    try {
      let generation = mutationGeneration(store);
      let snapshot = await loadDurableMessageDeliveries();
      while (generation !== mutationGeneration(store)) {
        generation = mutationGeneration(store);
        snapshot = await loadDurableMessageDeliveries();
      }
      hydrateMessageQueueFromSnapshot(store, snapshot.queue, snapshot.active);
      await persistQueueBestEffort(store);
      store.set(messageQueueHydratedAtom, true);
    } catch (error) {
      store.set(messageQueueHydratedAtom, false);
      hydrationByStore.delete(store);
      hydratedStores.delete(store);
      throw error;
    }
  })();
  hydrationByStore.set(store, hydration);
  return hydration;
}

/** Reconcile the live projections with the single durable delivery registry. */
export async function refreshMessageDeliveries(store: Store): Promise<void> {
  for (;;) {
    const revision = queueRevisionByStore.get(store) ?? 0;
    await queuePersistByStore.get(store);
    const snapshot = await loadDurableMessageDeliveries();
    if (revision !== (queueRevisionByStore.get(store) ?? 0)) continue;
    publishRecords(store, snapshot.queue, snapshot.active);
    return;
  }
}

export async function handoffQueuedMessageToActiveDelivery(
  store: Store,
  delivery: ActiveMessageDelivery
): Promise<void> {
  const result = await handoffDurableMessageDelivery(delivery);
  noteLocalMutation(store);
  const records = store.get(messageDeliveryRecordsAtom);
  const queue = records
    .filter(isQueuedMessageDelivery)
    .filter((message) => message.turnIntentId !== delivery.turnIntentId);
  publishRecords(store, queue, result.active);
  broadcastMutation();
}

export async function returnActiveDeliveryToMessageQueue(
  store: Store,
  deliveryId: string,
  message: QueuedMessage
): Promise<boolean> {
  store.set(messageQueueHandoffIdsAtom, (current) => {
    const next = new Set(current);
    next.add(message.id);
    return next;
  });
  try {
    const result = await returnDurableMessageDeliveryToQueue(
      deliveryId,
      message
    );
    noteLocalMutation(store);
    const records = store.get(messageDeliveryRecordsAtom);
    const queue = [
      ...records
        .filter(isQueuedMessageDelivery)
        .filter(
          (candidate) =>
            candidate.id !== result.message.id &&
            candidate.turnIntentId !== result.message.turnIntentId
        ),
      result.message,
    ];
    publishRecords(store, queue, result.active);
    broadcastMutation();
    return true;
  } finally {
    store.set(messageQueueHandoffIdsAtom, (current) => {
      if (!current.has(message.id)) return current;
      const next = new Set(current);
      next.delete(message.id);
      return next;
    });
  }
}

export async function updateActiveMessageDelivery(
  store: Store,
  deliveryId: string,
  update: ActiveMessageDeliveryUpdate
): Promise<ActiveMessageDelivery | null> {
  const updated = await updateDurableActiveMessageDelivery(deliveryId, update);
  noteLocalMutation(store);
  if (updated) {
    const records = store.get(messageDeliveryRecordsAtom);
    publishRecords(
      store,
      records.filter(isQueuedMessageDelivery),
      records
        .filter(isActiveMessageDelivery)
        .map((candidate) => (candidate.id === deliveryId ? updated : candidate))
    );
  }
  broadcastMutation();
  return updated;
}

export async function removeActiveMessageDelivery(
  store: Store,
  deliveryId: string
): Promise<void> {
  await removeDurableActiveMessageDelivery(deliveryId);
  noteLocalMutation(store);
  const records = store.get(messageDeliveryRecordsAtom);
  publishRecords(
    store,
    records.filter(isQueuedMessageDelivery),
    records
      .filter(isActiveMessageDelivery)
      .filter((candidate) => candidate.id !== deliveryId)
  );
  broadcastMutation();
}

export { assertDurableActiveDeliveryIsRootHead };

export function disposeMessageQueuePersistence(store: Store): void {
  unsubscribeByStore.get(store)?.();
  unsubscribeByStore.delete(store);
  hydrationByStore.delete(store);
  queueRevisionByStore.delete(store);
  queuePersistByStore.delete(store);
  lastObservedQueueByStore.delete(store);
  mutationGenerationByStore.delete(store);
  externalRefreshByStore.delete(store);
  hydratedStores.delete(store);
  store.set(messageQueueHydratedAtom, false);
  if (hydratedStores.size === 0) {
    mutationChannel?.close();
    mutationChannel = null;
  }
}

export function replaceActiveMessageDeliveryLocally(
  store: Store,
  deliveryId: string,
  update: ActiveMessageDeliveryUpdate
): void {
  store.set(messageDeliveryRecordsAtom, (records: MessageDeliveryRecord[]) =>
    records.map((record) =>
      isActiveMessageDelivery(record) && record.id === deliveryId
        ? { ...record, ...update }
        : record
    )
  );
}

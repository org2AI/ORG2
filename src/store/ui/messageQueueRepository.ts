/**
 * Durable message queue repository: the per-window queued partition, the
 * unified active-delivery registry and the handoff/return/update mutations
 * between them. Store access, row validation, locked reads and the canonical
 * conversation lock live in sibling modules and are re-exported here.
 */
import { conversationRootKey } from "@src/contracts/conversation";
import {
  QueuedConversationBusyError,
  QueuedConversationRecoveryPendingError,
} from "@src/contracts/conversation";

import {
  type ActiveMessageDelivery,
  type QueuedMessage,
  boundQueuedMessages,
  queueAdmissionResult,
} from "./messageQueueAtom";
import {
  DELIVERY_RECORDS_KEY,
  type DurableMessageDeliverySnapshot,
  readDeliveriesLocked,
  readDeliverySnapshotLocked,
  resetMessageQueueDeliveryRecordsForTests,
} from "./messageQueueDeliveryRecords";
import {
  type DurableQueuedMessage,
  isActiveDelivery,
  toQueuedMessage,
  validatedActiveMessageDeliveries,
  validatedDurableMessageDeliveries,
} from "./messageQueueRecordValidation";
import {
  resetMessageQueueStoreForTests,
  serializeMessageQueueStoreMutation,
  withMessageQueueStoreTransaction,
} from "./messageQueueStore";

export { withCanonicalConversationTurnLock } from "./canonicalConversationTurnLock";
export {
  validatedActiveMessageDeliveries,
  validatedDurableMessageQueue,
} from "./messageQueueRecordValidation";
export {
  getMessageQueueOwnerKey,
  isPrimaryMessageQueueOwnerKey,
  serializeMessageQueueStoreMutation,
  withMessageQueueStoreTransaction,
} from "./messageQueueStore";

export async function loadDurableMessageDeliveries(): Promise<DurableMessageDeliverySnapshot> {
  return await withMessageQueueStoreTransaction(readDeliverySnapshotLocked);
}

export async function loadDurableMessageQueue(): Promise<QueuedMessage[]> {
  return (await loadDurableMessageDeliveries()).queue;
}

export function persistDurableMessageQueue(
  messages: readonly QueuedMessage[]
): Promise<void> {
  const snapshot = boundQueuedMessages(messages).map((message) => ({
    ...message,
  }));
  return serializeMessageQueueStoreMutation(async (store, key) => {
    const records = await readDeliveriesLocked(store);
    const active = records.filter(isActiveDelivery);
    const activeIntentIds = new Set(active.map((row) => row.turnIntentId));
    const otherRecords = records.filter(
      (record) => record.status !== "queued" || record.originQueueKey !== key
    );
    const currentQueue = snapshot
      .filter((message) => !activeIntentIds.has(message.turnIntentId))
      .map((message) => ({ ...message, originQueueKey: key }));
    await store.set(
      DELIVERY_RECORDS_KEY,
      validatedDurableMessageDeliveries([...otherRecords, ...currentQueue])
    );
    await store.save();
  });
}

export interface QueuedMessageCancellationIdentity {
  id: string;
  turnIntentId: string;
}

/** Return which queue ids still have any durable queued/active owner. */
export function findDurableMessageDeliveryOwnerIds(
  messageIds: readonly string[]
): Promise<Set<string>> {
  const requested = new Set(messageIds);
  if (requested.size === 0) return Promise.resolve(new Set());
  return withMessageQueueStoreTransaction(async (store) => {
    const records = await readDeliveriesLocked(store);
    return new Set(
      records
        .filter((record) => requested.has(record.id))
        .map((record) => record.id)
    );
  });
}

/**
 * Remove exact queued owners from this window's durable partition.
 *
 * This is intentionally narrower than replacing the queue snapshot: a row
 * that has already moved to `preparing`/`accepted`, or belongs to another
 * window, is no longer cancellable by a stale queue card and must survive.
 */
export function removeDurableQueuedMessageDeliveries(
  identities: readonly QueuedMessageCancellationIdentity[]
): Promise<QueuedMessage[]> {
  const keys = new Set(
    identities.map(({ id, turnIntentId }) => `${id}\0${turnIntentId}`)
  );
  if (keys.size === 0) return Promise.resolve([]);

  return serializeMessageQueueStoreMutation(async (store, windowQueueKey) => {
    const records = await readDeliveriesLocked(store);
    const removed: QueuedMessage[] = [];
    const next = records.filter((record) => {
      const matches =
        record.status === "queued" &&
        record.originQueueKey === windowQueueKey &&
        keys.has(`${record.id}\0${record.turnIntentId}`);
      if (matches) removed.push(toQueuedMessage(record));
      return !matches;
    });
    if (removed.length === 0) return removed;
    await store.set(
      DELIVERY_RECORDS_KEY,
      validatedDurableMessageDeliveries(next)
    );
    await store.save();
    return removed;
  });
}

export function handoffDurableMessageDelivery(
  delivery: ActiveMessageDelivery
): Promise<{
  delivery: ActiveMessageDelivery;
  queue: QueuedMessage[];
  active: ActiveMessageDelivery[];
}> {
  return serializeMessageQueueStoreMutation(async (store, windowQueueKey) => {
    const records = await readDeliveriesLocked(store);
    const active = records.filter(isActiveDelivery);
    const queue = records
      .filter(
        (record): record is DurableQueuedMessage =>
          record.status === "queued" && record.originQueueKey === windowQueueKey
      )
      .map(toQueuedMessage);
    const existingOwner = active.find(
      (candidate) =>
        candidate.id === delivery.id &&
        candidate.turnIntentId === delivery.turnIntentId
    );
    const conflictingOwner = active.some(
      (candidate) =>
        candidate.id === delivery.id ||
        candidate.turnIntentId === delivery.turnIntentId
    );
    const sourceRow = queue.find(
      (message) =>
        message.id === delivery.id &&
        message.turnIntentId === delivery.turnIntentId
    );
    if (
      (!existingOwner && !sourceRow) ||
      (!existingOwner && conflictingOwner)
    ) {
      throw new QueuedConversationBusyError();
    }
    const persisted =
      existingOwner ??
      ({
        ...sourceRow,
        status: delivery.status,
        originQueueKey: windowQueueKey,
        runnerSessionId: delivery.runnerSessionId,
        runnerEventStartIndex: delivery.runnerEventStartIndex,
        retryAt: delivery.retryAt,
        retryAttempt: delivery.retryAttempt,
      } as ActiveMessageDelivery);
    const nextQueue = queue.filter(
      (message) =>
        message.id !== persisted.id ||
        message.turnIntentId !== persisted.turnIntentId
    );
    const nextActive = existingOwner
      ? active
      : validatedActiveMessageDeliveries([...active, persisted]);
    const nextRecords = existingOwner
      ? records.filter(
          (record) =>
            record.status !== "queued" ||
            record.originQueueKey !== windowQueueKey ||
            record.id !== persisted.id ||
            record.turnIntentId !== persisted.turnIntentId
        )
      : records.map((record) =>
          record.status === "queued" &&
          record.originQueueKey === windowQueueKey &&
          record.id === persisted.id &&
          record.turnIntentId === persisted.turnIntentId
            ? persisted
            : record
        );
    await store.set(
      DELIVERY_RECORDS_KEY,
      validatedDurableMessageDeliveries(nextRecords)
    );
    await store.save();
    return { delivery: persisted, queue: nextQueue, active: nextActive };
  });
}

export function returnDurableMessageDeliveryToQueue(
  deliveryId: string,
  message: QueuedMessage
): Promise<{
  message: QueuedMessage;
  active: ActiveMessageDelivery[];
}> {
  return serializeMessageQueueStoreMutation(async (store, claimantQueueKey) => {
    const records = await readDeliveriesLocked(store);
    const active = records.filter(isActiveDelivery);
    if (!active.some((candidate) => candidate.id === deliveryId)) {
      throw new QueuedConversationRecoveryPendingError(
        "active message delivery owner is temporarily unavailable"
      );
    }
    const queue = records
      .filter(
        (record): record is DurableQueuedMessage =>
          record.status === "queued" &&
          record.originQueueKey === claimantQueueKey
      )
      .map(toQueuedMessage);
    const supersedingMessage = queue.find(
      (candidate) =>
        candidate.id === message.id &&
        candidate.turnIntentId !== message.turnIntentId
    );
    const baseQueue = queue.filter(
      (candidate) =>
        candidate.id !== message.id &&
        candidate.turnIntentId !== message.turnIntentId
    );
    const restoredMessage = supersedingMessage ?? message;
    const rejection = queueAdmissionResult(baseQueue, restoredMessage);
    if (rejection) {
      throw new QueuedConversationRecoveryPendingError(
        `message queue cannot restore this turn yet (${rejection})`
      );
    }
    const nextActive = active.filter(
      (candidate) => candidate.id !== deliveryId
    );
    const queuedRecord: DurableQueuedMessage = {
      ...restoredMessage,
      originQueueKey: claimantQueueKey,
    };
    const nextRecords = records
      .filter(
        (record) =>
          record.id !== deliveryId &&
          !(
            record.status === "queued" &&
            record.originQueueKey === claimantQueueKey &&
            (record.id === queuedRecord.id ||
              record.turnIntentId === queuedRecord.turnIntentId)
          )
      )
      .concat(queuedRecord);
    await store.set(
      DELIVERY_RECORDS_KEY,
      validatedDurableMessageDeliveries(nextRecords)
    );
    await store.save();
    return { message: restoredMessage, active: nextActive };
  });
}

export type ActiveMessageDeliveryUpdate = Partial<
  Pick<
    ActiveMessageDelivery,
    | "status"
    | "runnerSessionId"
    | "runnerEventStartIndex"
    | "retryAt"
    | "retryAttempt"
  >
>;

export async function updateDurableActiveMessageDelivery(
  deliveryId: string,
  update: ActiveMessageDeliveryUpdate
): Promise<ActiveMessageDelivery | null> {
  let updated: ActiveMessageDelivery | null = null;
  await serializeMessageQueueStoreMutation(async (store) => {
    const records = await readDeliveriesLocked(store);
    const next = validatedDurableMessageDeliveries(
      records.map((candidate) => {
        if (candidate.status === "queued" || candidate.id !== deliveryId) {
          return candidate;
        }
        updated = { ...candidate, ...update } as ActiveMessageDelivery;
        return updated;
      })
    );
    await store.set(DELIVERY_RECORDS_KEY, next);
    await store.save();
  });
  return updated;
}

export function removeDurableActiveMessageDelivery(
  deliveryId: string
): Promise<void> {
  return serializeMessageQueueStoreMutation(async (store) => {
    const records = await readDeliveriesLocked(store);
    await store.set(
      DELIVERY_RECORDS_KEY,
      records.filter(
        (candidate) =>
          candidate.status === "queued" || candidate.id !== deliveryId
      )
    );
    await store.save();
  });
}

export function assertDurableActiveDeliveryIsRootHead(
  deliveryId: string
): Promise<ActiveMessageDelivery> {
  return withMessageQueueStoreTransaction(async (store) => {
    const active = (await readDeliveriesLocked(store)).filter(isActiveDelivery);
    const owner = active.find((candidate) => candidate.id === deliveryId);
    if (!owner) throw new QueuedConversationBusyError();
    const rootKey = conversationRootKey(owner.conversationDispatch.root);
    const head = active.find(
      (candidate) =>
        conversationRootKey(candidate.conversationDispatch.root) === rootKey
    );
    if (head?.id !== deliveryId) throw new QueuedConversationBusyError();
    return owner;
  });
}

export function resetMessageQueueRepositoryForTests(): void {
  resetMessageQueueStoreForTests();
  resetMessageQueueDeliveryRecordsForTests();
}

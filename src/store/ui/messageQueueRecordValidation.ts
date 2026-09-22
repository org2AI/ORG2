/**
 * Row validation for the durable message queue store: queued messages,
 * active deliveries and the unified per-owner delivery registry.
 */
import {
  MAX_QUEUED_CONVERSATION_MESSAGE_CHARS_TOTAL,
  isQueuedConversationMessagePayload,
  queuedConversationMessageCharSize,
} from "@src/contracts/conversation";

import {
  type ActiveMessageDelivery,
  MAX_QUEUED_MESSAGE_CHARS,
  type QueuedMessage,
  boundQueuedMessages,
  queuedMessageCharSize,
} from "./messageQueueAtom";

const MAX_ACTIVE_DELIVERIES = 100;

export function isQueuedMessage(value: unknown): value is QueuedMessage {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<QueuedMessage>;
  const validConversationDispatch = item.conversationDispatch
    ? isQueuedConversationMessagePayload(item)
    : true;
  return (
    typeof item.id === "string" &&
    typeof item.turnIntentId === "string" &&
    typeof item.sessionId === "string" &&
    typeof item.content === "string" &&
    typeof item.displayContent === "string" &&
    validConversationDispatch &&
    (item.imageDataUrls === undefined ||
      (Array.isArray(item.imageDataUrls) &&
        item.imageDataUrls.every((image) => typeof image === "string"))) &&
    (item.deliveryError === undefined ||
      typeof item.deliveryError === "string") &&
    (item.priority === "now" || item.priority === "next") &&
    item.status === "queued" &&
    typeof item.createdAt === "string" &&
    queuedMessageCharSize(item as QueuedMessage) <= MAX_QUEUED_MESSAGE_CHARS
  );
}

export type DurableQueuedMessage = QueuedMessage & { originQueueKey: string };
export type DurableMessageDelivery =
  | DurableQueuedMessage
  | ActiveMessageDelivery;

function hasQueueOwner(value: unknown): value is { originQueueKey: string } {
  return Boolean(
    value &&
    typeof value === "object" &&
    typeof (value as { originQueueKey?: unknown }).originQueueKey ===
      "string" &&
    (value as { originQueueKey: string }).originQueueKey.startsWith("queue:")
  );
}

function isDurableQueuedMessage(value: unknown): value is DurableQueuedMessage {
  return isQueuedMessage(value) && hasQueueOwner(value);
}

export function toQueuedMessage(record: DurableQueuedMessage): QueuedMessage {
  const { originQueueKey: _originQueueKey, ...message } = record;
  return message;
}

export function validatedDurableMessageQueue(value: unknown): QueuedMessage[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || !value.every(isQueuedMessage)) {
    throw new Error("durable message queue contains an invalid row");
  }
  const ids = new Set<string>();
  const intents = new Set<string>();
  for (const message of value) {
    if (ids.has(message.id) || intents.has(message.turnIntentId)) {
      throw new Error("durable message queue contains duplicate identity");
    }
    ids.add(message.id);
    intents.add(message.turnIntentId);
  }
  const bounded = boundQueuedMessages(value);
  if (bounded.length !== value.length) {
    throw new Error("durable message queue exceeds its safety limits");
  }
  return value;
}

export function isActiveDelivery(
  value: unknown
): value is ActiveMessageDelivery {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ActiveMessageDelivery>;
  const retryAt = candidate.retryAt;
  const retryAttempt = candidate.retryAttempt;
  const validMetadata = Boolean(
    typeof candidate.id === "string" &&
    (candidate.status === "preparing" || candidate.status === "accepted") &&
    (candidate.priority === "now" || candidate.priority === "next") &&
    (candidate.runnerSessionId === undefined ||
      (typeof candidate.runnerSessionId === "string" &&
        candidate.runnerSessionId.length > 0)) &&
    (candidate.status !== "accepted" ||
      typeof candidate.runnerSessionId === "string") &&
    (candidate.runnerEventStartIndex === undefined ||
      (typeof candidate.runnerEventStartIndex === "number" &&
        Number.isSafeInteger(candidate.runnerEventStartIndex) &&
        candidate.runnerEventStartIndex >= 0)) &&
    typeof candidate.createdAt === "string" &&
    (candidate.deliveryError === undefined ||
      typeof candidate.deliveryError === "string") &&
    (retryAt === undefined || typeof retryAt === "string") &&
    (retryAttempt === undefined ||
      (typeof retryAttempt === "number" &&
        Number.isSafeInteger(retryAttempt) &&
        retryAttempt >= 0))
  );
  return (
    validMetadata &&
    hasQueueOwner(value) &&
    isQueuedConversationMessagePayload(value)
  );
}

export function validatedActiveMessageDeliveries(
  value: unknown
): ActiveMessageDelivery[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new Error("active message delivery store is not an array");
  }
  if (!value.every(isActiveDelivery)) {
    throw new Error("active message delivery store contains an invalid row");
  }
  const rows = value as ActiveMessageDelivery[];
  if (rows.length > MAX_ACTIVE_DELIVERIES) {
    throw new Error("active message delivery store exceeds its row limit");
  }
  const ids = new Set<string>();
  const intentIds = new Set<string>();
  for (const delivery of rows) {
    if (ids.has(delivery.id) || intentIds.has(delivery.turnIntentId)) {
      throw new Error(
        "active message delivery store contains duplicate ownership"
      );
    }
    ids.add(delivery.id);
    intentIds.add(delivery.turnIntentId);
  }
  const totalChars = rows.reduce(
    (total, delivery) => total + queuedConversationMessageCharSize(delivery),
    0
  );
  if (totalChars > MAX_QUEUED_CONVERSATION_MESSAGE_CHARS_TOTAL) {
    throw new Error("active message delivery store exceeds its payload limit");
  }
  return rows;
}

export function validatedDurableMessageDeliveries(
  value: unknown
): DurableMessageDelivery[] {
  if (value === undefined || value === null) return [];
  if (
    !Array.isArray(value) ||
    !value.every(
      (record) => isDurableQueuedMessage(record) || isActiveDelivery(record)
    )
  ) {
    throw new Error("durable message delivery store contains an invalid row");
  }
  const records = value as DurableMessageDelivery[];
  const intentIds = new Set<string>();
  const queuedIds = new Set<string>();
  for (const record of records) {
    if (intentIds.has(record.turnIntentId)) {
      throw new Error(
        "durable message delivery store contains duplicate identity"
      );
    }
    intentIds.add(record.turnIntentId);
    if (record.status === "queued") {
      if (queuedIds.has(record.id)) {
        throw new Error(
          "durable message delivery store contains duplicate identity"
        );
      }
      queuedIds.add(record.id);
    }
  }
  const active = records.filter(isActiveDelivery);
  validatedActiveMessageDeliveries(active);
  const queuedByOwner = new Map<string, DurableQueuedMessage[]>();
  for (const record of records) {
    if (record.status !== "queued") continue;
    const ownerQueue = queuedByOwner.get(record.originQueueKey) ?? [];
    ownerQueue.push(record);
    queuedByOwner.set(record.originQueueKey, ownerQueue);
  }
  for (const queue of queuedByOwner.values()) {
    validatedDurableMessageQueue(queue);
  }
  const totalChars = records.reduce(
    (total, record) => total + queuedConversationMessageCharSize(record),
    0
  );
  if (totalChars > MAX_QUEUED_CONVERSATION_MESSAGE_CHARS_TOTAL) {
    throw new Error("durable message delivery store exceeds its payload limit");
  }
  return records;
}

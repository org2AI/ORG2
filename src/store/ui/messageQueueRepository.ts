import { type Store, load } from "@tauri-apps/plugin-store";

import {
  isConversationRootLocator,
  isLocalConversationTarget,
} from "@src/engines/SessionCore/conversations/conversationTypes";
import { createLogger } from "@src/hooks/logger";

import {
  MAX_QUEUED_MESSAGE_CHARS,
  type QueuedMessage,
  boundQueuedMessages,
  queuedMessageCharSize,
} from "./messageQueueAtom";

const log = createLogger("messageQueueRepository");
const STORE_PATH = "chat-message-queue.json";
const STORE_KEY_PREFIX = "queue";
const STORE_LOCK_NAME = "orgii:chat-message-queue-store";

let storePromise: Promise<Store | null> | null = null;
let queueKeyPromise: Promise<string> | null = null;
let writeChain: Promise<void> = Promise.resolve();
let fallbackStoreLock: Promise<unknown> = Promise.resolve();

async function withStoreLock<T>(operation: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (locks?.request) {
    return await locks.request(
      STORE_LOCK_NAME,
      { mode: "exclusive" },
      operation
    );
  }
  const next = fallbackStoreLock.catch(() => undefined).then(operation);
  fallbackStoreLock = next;
  return await next;
}

function isQueuedMessage(value: unknown): value is QueuedMessage {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<QueuedMessage>;
  const conversationDispatch = item.conversationDispatch;
  const validConversationDispatch =
    conversationDispatch === undefined ||
    (conversationDispatch.kind === "canonical_conversation" &&
      isConversationRootLocator(conversationDispatch.root) &&
      isLocalConversationTarget(conversationDispatch.target) &&
      (conversationDispatch.dispatchIdentityKey === undefined ||
        typeof conversationDispatch.dispatchIdentityKey === "string"));
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
    (item.priority === "now" || item.priority === "next") &&
    (item.status === "queued" ||
      item.status === "preparing" ||
      item.status === "accepted") &&
    (item.runnerSessionId === undefined ||
      typeof item.runnerSessionId === "string") &&
    (item.runnerEventStartIndex === undefined ||
      (typeof item.runnerEventStartIndex === "number" &&
        Number.isSafeInteger(item.runnerEventStartIndex) &&
        item.runnerEventStartIndex >= 0)) &&
    (item.retryAt === undefined ||
      (typeof item.retryAt === "string" &&
        Number.isFinite(Date.parse(item.retryAt)))) &&
    (item.retryAttempt === undefined ||
      (typeof item.retryAttempt === "number" &&
        Number.isSafeInteger(item.retryAttempt) &&
        item.retryAttempt >= 0)) &&
    (item.status !== "accepted" || typeof item.runnerSessionId === "string") &&
    typeof item.createdAt === "string" &&
    queuedMessageCharSize(item as QueuedMessage) <= MAX_QUEUED_MESSAGE_CHARS
  );
}

async function durableStore(): Promise<Store | null> {
  if (storePromise) return storePromise;
  storePromise = load(STORE_PATH, {
    defaults: {},
    autoSave: false,
  }).catch((error) => {
    log.warn("[messageQueueRepository] durable store unavailable", error);
    // Do not memoize a transient startup/plugin failure forever. Queue writes
    // remain serialized, and the next mutation gets one fresh load attempt.
    storePromise = null;
    return null;
  });
  return storePromise;
}

async function queueKey(): Promise<string> {
  if (queueKeyPromise) return queueKeyPromise;
  queueKeyPromise = import("@tauri-apps/api/window")
    .then(
      ({ getCurrentWindow }) =>
        `${STORE_KEY_PREFIX}:${getCurrentWindow().label}`
    )
    .catch(() => `${STORE_KEY_PREFIX}:browser`);
  return queueKeyPromise;
}

/** Load this window's durable queue. Invalid rows are ignored, never dispatched. */
export async function loadDurableMessageQueue(): Promise<QueuedMessage[]> {
  const store = await durableStore();
  if (!store) {
    throw new Error("durable message queue store is unavailable");
  }
  try {
    return await withStoreLock(async () => {
      await store.reload();
      const stored = await store.get<unknown>(await queueKey());
      if (!Array.isArray(stored)) return [];
      return boundQueuedMessages(stored.filter(isQueuedMessage));
    });
  } catch (error) {
    log.warn("[messageQueueRepository] failed to load queue", error);
    // An unreadable snapshot is unknown, not an authoritative empty queue.
    // Let hydration retain its live in-memory rows and avoid writing [] over
    // a transiently unavailable durable document.
    throw error;
  }
}

/**
 * Serialize writes so a rapid enqueue/reorder/dequeue burst cannot let an older
 * async save overwrite a newer snapshot. Writes are explicitly saved before
 * the mutation promise resolves, so app shutdown cannot race a deferred
 * autosave after the in-memory queue has already changed.
 */
export function persistDurableMessageQueue(
  messages: readonly QueuedMessage[]
): Promise<void> {
  const snapshot = boundQueuedMessages(messages).map((message) => ({
    ...message,
  }));
  writeChain = writeChain
    .catch((error) => {
      // A transient failure must not poison the serialization chain. The next
      // queue mutation gets a fresh save attempt with its complete snapshot.
      log.warn("[messageQueueRepository] previous queue save failed", error);
    })
    .then(async () => {
      const store = await durableStore();
      if (!store) {
        throw new Error("durable message queue store is unavailable");
      }
      await withStoreLock(async () => {
        // Store handles are cached per webview. Reload under the cross-window
        // lock before changing only this window's key, otherwise a stale save
        // can erase a sibling window's durable queue.
        await store.reload();
        await store.set(await queueKey(), snapshot);
        await store.save();
      });
    });
  // Deliberately propagate the current write failure. Provider dispatch uses
  // this promise as its crash-consistency boundary: starting a native turn
  // without the corresponding durable queue row would make renderer restart
  // recovery ambiguous and can replay the same user intent. Background
  // subscribers attach their own best-effort logging handler.
  return writeChain;
}

export function resetMessageQueueRepositoryForTests(): void {
  storePromise = null;
  queueKeyPromise = null;
  writeChain = Promise.resolve();
  fallbackStoreLock = Promise.resolve();
}

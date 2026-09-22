/**
 * Durable message queue store access: the shared Tauri store handle, the
 * per-window owner key, the cross-window store lock and the reload-before-
 * transaction / serialized-mutation contracts every repository write uses.
 */
import { type Store, load } from "@tauri-apps/plugin-store";

import { createLogger } from "@src/hooks/logger";

const log = createLogger("messageQueueRepository");
const STORE_PATH = "chat-message-queue.json";
export const STORE_KEY_PREFIX = "queue";
const STORE_LOCK_NAME = "orgii:chat-message-queue-store";

function isMissingStoreFileError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("No such file or directory") ||
    message.includes("os error 2")
  );
}

let storePromise: Promise<Store | null> | null = null;
let queueKeyPromise: Promise<string> | null = null;
let mutationChain: Promise<unknown> = Promise.resolve();
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

async function durableStore(): Promise<Store | null> {
  if (storePromise) return storePromise;
  storePromise = load(STORE_PATH, {
    defaults: {},
    autoSave: false,
  }).catch((error) => {
    log.warn("[messageQueueRepository] durable store unavailable", error);
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

export async function getMessageQueueOwnerKey(): Promise<string> {
  return await queueKey();
}

export function isPrimaryMessageQueueOwnerKey(key: string): boolean {
  return (
    key === `${STORE_KEY_PREFIX}:main` || key === `${STORE_KEY_PREFIX}:browser`
  );
}

export async function withMessageQueueStoreTransaction<T>(
  operation: (store: Store, windowQueueKey: string) => Promise<T>
): Promise<T> {
  const store = await durableStore();
  if (!store) {
    throw new Error("durable message queue store is unavailable");
  }
  return await withStoreLock(async () => {
    try {
      await store.reload();
    } catch (error) {
      if (!isMissingStoreFileError(error)) throw error;
      // Store.load() supplies the empty in-memory defaults when its file does
      // not exist, but reload() reports ENOENT. Persist that initial snapshot
      // once so the normal reload-before-transaction contract can begin.
      await store.save();
    }
    return await operation(store, await queueKey());
  });
}

export function serializeMessageQueueStoreMutation<T>(
  operation: (store: Store, windowQueueKey: string) => Promise<T>
): Promise<T> {
  const next = mutationChain
    .catch((error) => {
      log.warn("[messageQueueRepository] previous mutation failed", error);
    })
    .then(() => withMessageQueueStoreTransaction(operation));
  mutationChain = next;
  return next;
}

export function resetMessageQueueStoreForTests(): void {
  storePromise = null;
  queueKeyPromise = null;
  mutationChain = Promise.resolve();
  fallbackStoreLock = Promise.resolve();
}

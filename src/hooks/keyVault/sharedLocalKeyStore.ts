import { listKeys } from "@src/api/services/keyValidation";
import type { KeyInfo } from "@src/api/services/keyValidation";
import { replaceModelAliasesFromKeys } from "@src/hooks/models/modelAliasRegistry";

type SharedLocalKeysListener = (keys: KeyInfo[]) => void;

let sharedAllKeys: KeyInfo[] = [];
let sharedKeysLoaded = false;
let sharedKeysLoadPromise: Promise<KeyInfo[]> | undefined;
const listeners = new Set<SharedLocalKeysListener>();

export function getSharedLocalKeys(): KeyInfo[] {
  return sharedAllKeys;
}

export function subscribeSharedLocalKeys(
  listener: SharedLocalKeysListener
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function publishSharedLocalKeys(keys: KeyInfo[]): void {
  sharedAllKeys = keys;
  replaceModelAliasesFromKeys(keys);
  for (const listener of listeners) listener(keys);
}

export function updateSharedLocalKeys(
  updater: (previous: KeyInfo[]) => KeyInfo[]
): KeyInfo[] {
  const next = updater(sharedAllKeys);
  publishSharedLocalKeys(next);
  return next;
}

export function upsertSharedLocalKey(updated: KeyInfo): void {
  updateSharedLocalKeys((previous) => {
    const index = previous.findIndex((key) => key.id === updated.id);
    if (index < 0) return [...previous, updated];
    const next = [...previous];
    next[index] = updated;
    return next;
  });
}

/**
 * Load the local key list once for all mounted consumers.
 *
 * Concurrent callers join the same request. Normal auto-loads reuse the
 * populated cache; explicit page refreshes pass `force=true` and still share
 * any request already in flight.
 */
export function loadSharedLocalKeys(force = false): Promise<KeyInfo[]> {
  if (!force && sharedKeysLoaded) return Promise.resolve(sharedAllKeys);
  if (sharedKeysLoadPromise) return sharedKeysLoadPromise;

  const request = listKeys()
    .then((keys) => {
      sharedKeysLoaded = true;
      publishSharedLocalKeys(keys);
      return keys;
    })
    .finally(() => {
      if (sharedKeysLoadPromise === request) sharedKeysLoadPromise = undefined;
    });
  sharedKeysLoadPromise = request;
  return request;
}

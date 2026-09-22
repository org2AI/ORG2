import { listKeys } from "@src/api/services/keyValidation";
import type { KeyInfo } from "@src/api/services/keyValidation";
import { replaceModelAliasesFromKeys } from "@src/hooks/models/modelAliasRegistry";
import { subscribeDevMockScenarios } from "@src/store/dev/mockScenarios";

type SharedLocalKeysListener = (keys: KeyInfo[]) => void;

const NO_KEYS: KeyInfo[] = [];

let sharedAllKeys: KeyInfo[] = [];
let sharedKeysLoaded = false;
let sharedKeysLoadPromise: Promise<KeyInfo[]> | undefined;
/** Dev-only display mask — see `@src/store/dev/mockScenarios`. */
let keysMasked = false;
const listeners = new Set<SharedLocalKeysListener>();

/**
 * What consumers see. `sharedAllKeys` stays the real on-disk list so writes,
 * validation, and quota refreshes keep working while the mask is on.
 */
function visibleKeys(): KeyInfo[] {
  return keysMasked ? NO_KEYS : sharedAllKeys;
}

function notifyLocalKeyConsumers(): void {
  const visible = visibleKeys();
  replaceModelAliasesFromKeys(visible);
  for (const listener of listeners) listener(visible);
}

export function getSharedLocalKeys(): KeyInfo[] {
  return visibleKeys();
}

/**
 * `true` once the shared list has been loaded at least once this session.
 * Consumers use it to tell a first load (which may show a loading state)
 * from a revalidation (which must keep the current rows on screen).
 */
export function areSharedLocalKeysLoaded(): boolean {
  return sharedKeysLoaded;
}

export function subscribeSharedLocalKeys(
  listener: SharedLocalKeysListener
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function publishSharedLocalKeys(keys: KeyInfo[]): void {
  sharedAllKeys = keys;
  notifyLocalKeyConsumers();
}

export function updateSharedLocalKeys(
  updater: (previous: KeyInfo[]) => KeyInfo[]
): KeyInfo[] {
  // Always update against the real list, never the masked view.
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
  if (!force && sharedKeysLoaded) return Promise.resolve(visibleKeys());
  if (sharedKeysLoadPromise) return sharedKeysLoadPromise;

  const request = listKeys()
    .then((keys) => {
      sharedKeysLoaded = true;
      publishSharedLocalKeys(keys);
      return visibleKeys();
    })
    .finally(() => {
      if (sharedKeysLoadPromise === request) sharedKeysLoadPromise = undefined;
    });
  sharedKeysLoadPromise = request;
  return request;
}

if (process.env.NODE_ENV === "development") {
  subscribeDevMockScenarios((scenarios) => {
    if (keysMasked === scenarios.noKeys) return;
    keysMasked = scenarios.noKeys;
    notifyLocalKeyConsumers();
  });
}

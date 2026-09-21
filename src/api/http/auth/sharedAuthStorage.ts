import { getIdentifier } from "@tauri-apps/api/app";
import { isTauri } from "@tauri-apps/api/core";
import { appDataDir, resolve } from "@tauri-apps/api/path";
import { LazyStore } from "@tauri-apps/plugin-store";

import {
  serializedCloudOwner,
  suspendNativeCloudOwner,
  synchronizeNativeCloudOwner,
} from "./nativeCloudOwner";

/**
 * Auth storage shared by the primary ORG2 app and the dedicated dev identity.
 * Tauri dev and the bundled app have different origins, so
 * browser localStorage cannot be the source of truth for their login session.
 *
 * Numbered secondary identifiers keep their own auth store. Only the dev
 * identity opts into the primary login; its other app data remains separate.
 */
const SHARED_AUTH_STORE_PATH = "shared-service-auth.json";
const SHARED_AUTH_SCHEMA_KEY = "__orgii_shared_auth_schema";
const SHARED_AUTH_SCHEMA_VERSION = 2;

export const SHARED_ORG2_CLOUD_AUTH_STORAGE_KEY = "orgii:org2-cloud-v1:auth";
export const SHARED_AUTH_SYNCHRONIZED_EVENT =
  "orgii:shared-service-auth-synchronized";

export const SUPABASE_AUTH_STORAGE_KEY = "orgii.supabase.auth";
export const SUPABASE_PKCE_STORAGE_KEY = `${SUPABASE_AUTH_STORAGE_KEY}-code-verifier`;

export const SHARED_SERVICE_AUTH_STORAGE_KEYS = {
  accessToken: "hosted_access_token",
  refreshToken: "hosted_refresh_token",
  tokenExpiry: "hosted_token_expiry",
  userId: "hosted_user_id",
  authSkipped: "orgii:auth_skipped",
  processedCode: "hosted_processed_code",
} as const;

const MIRRORED_AUTH_KEYS = [
  SUPABASE_AUTH_STORAGE_KEY,
  SUPABASE_PKCE_STORAGE_KEY,
  ...Object.values(SHARED_SERVICE_AUTH_STORAGE_KEYS),
  "id_token",
  "user_id",
  "orgii-user-info",
  SHARED_ORG2_CLOUD_AUTH_STORAGE_KEY,
] as const;

type SharedAuthKey = (typeof MIRRORED_AUTH_KEYS)[number];

interface StringStorage {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
}

let storePromise: Promise<LazyStore> | null = null;
let operationQueue: Promise<void> = Promise.resolve();
let initializePromise: Promise<void> | null = null;
let synchronizePromise: Promise<void> | null = null;
// Invocation order, not authorization. Native owns identity verification and
// epochs; this single pending transition only coordinates durable writes.
let projectedCloudOwner: string | null | undefined;
let cloudTransition: { epoch: Promise<number> } | null = null;
let cloudWriteNeedsRecovery = false;
let cloudWriteGeneration = 0;
let nativeOwnerReady: Promise<void> = Promise.resolve();
let nativeOwnerFailed = false;
let nativeOwnerSettled = true;
function ownerChangeSignal() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
let nativeOwnerChanged = ownerChangeSignal();

function trackNativeOwnerReady(operation: Promise<void>): Promise<void> {
  nativeOwnerReady = operation;
  nativeOwnerFailed = false;
  nativeOwnerSettled = false;
  nativeOwnerChanged.resolve();
  nativeOwnerChanged = ownerChangeSignal();
  void operation.then(
    () => {
      if (nativeOwnerReady === operation) {
        nativeOwnerSettled = true;
        nativeOwnerChanged.resolve();
      }
    },
    () => {
      if (nativeOwnerReady === operation) {
        nativeOwnerFailed = true;
        nativeOwnerSettled = true;
        nativeOwnerChanged.resolve();
      }
    }
  );
  return operation;
}

/** Only Package entry points wait for native verification, never App startup. */
export async function awaitNativeCloudOwnerReady(): Promise<void> {
  if (!isTauri()) return;
  // A subsequent explicit Package action can retry a failed transition using
  // canonical local auth. Do not retry automatically in the background.
  if (nativeOwnerFailed)
    void writeCloudAuth(
      localValue(SHARED_ORG2_CLOUD_AUTH_STORAGE_KEY),
      true
    ).catch(() => {});
  if (nativeOwnerSettled) return nativeOwnerReady;
  for (;;) {
    const pending = nativeOwnerReady;
    try {
      await Promise.race([pending, nativeOwnerChanged.promise]);
    } catch (error) {
      if (pending === nativeOwnerReady) throw error;
    }
    if (pending === nativeOwnerReady) return;
  }
}

function localValue(key: string): string | null {
  if (typeof localStorage === "undefined") return null;
  return localStorage.getItem(key);
}

function setLocalValue(key: string, value: string | undefined): void {
  if (typeof localStorage === "undefined") return;
  if (value === undefined) {
    localStorage.removeItem(key);
  } else {
    localStorage.setItem(key, value);
  }
}

function getStore(): Promise<LazyStore> {
  storePromise ??= (async () => {
    const identifier = await getIdentifier();
    const storePath =
      identifier === "org2ai.org2.dev"
        ? await resolve(
            await appDataDir(),
            "..",
            "org2ai.org2",
            SHARED_AUTH_STORE_PATH
          )
        : SHARED_AUTH_STORE_PATH;
    return new LazyStore(storePath, { defaults: {}, autoSave: false });
  })().catch((error: unknown) => {
    // Startup can race native IPC availability. Preserve focus-return retry
    // instead of caching a rejected identity/path lookup for the whole app.
    storePromise = null;
    throw error;
  });
  return storePromise;
}

function enqueueStoreOperation<T>(operation: () => Promise<T>): Promise<T> {
  const result = operationQueue.then(operation, operation);
  operationQueue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

function normalizedCloudValue(value: string | null): string | null {
  return value === "null" ? null : value;
}

function writeCloudAuth(
  value: string | null,
  requireCurrentLocalValue = false,
  completion: "native-ready" | "persisted" = "native-ready"
): Promise<void> {
  const currentMatches = () =>
    normalizedCloudValue(localValue(SHARED_ORG2_CLOUD_AUTH_STORAGE_KEY)) ===
    normalizedCloudValue(value);
  if (requireCurrentLocalValue && !currentMatches()) {
    return Promise.reject(new Error("Cloud auth write was superseded"));
  }
  const generation = ++cloudWriteGeneration;
  const previous =
    projectedCloudOwner === undefined
      ? serializedCloudOwner(localValue(SHARED_ORG2_CLOUD_AUTH_STORAGE_KEY))
      : projectedCloudOwner;
  const next = serializedCloudOwner(value);
  projectedCloudOwner = next;
  if (previous !== next || cloudWriteNeedsRecovery) {
    // Start before the atom publishes the new local value. Do not wait behind
    // unrelated store writes while old native requests retain their owner.
    const epoch = suspendNativeCloudOwner();
    void epoch.catch(() => {});
    cloudTransition = { epoch };
    cloudWriteNeedsRecovery = false;
  }
  const transition = cloudTransition;
  const persisted = enqueueStoreOperation(async () => {
    const epoch = transition ? await transition.epoch : null;
    const sharedStore = await getStore();
    await reloadStore(sharedStore);
    const snapshot = await readStoreSnapshot(sharedStore);
    await migrateLocalAuthOnce(sharedStore, snapshot);
    if (requireCurrentLocalValue && !currentMatches()) {
      throw new Error("Cloud auth write was superseded");
    }
    if (value === null) {
      await sharedStore.delete(SHARED_ORG2_CLOUD_AUTH_STORAGE_KEY);
    } else {
      await sharedStore.set(SHARED_ORG2_CLOUD_AUTH_STORAGE_KEY, value);
    }
    await sharedStore.save();
    return epoch;
  });
  const ready = persisted
    .then(async (epoch) => {
      // Native verification/cache retirement must not hold the durable-write
      // queue: a newer logout must save even while an old Keychain prompt waits.
      await synchronizeNativeCloudOwner(epoch);
      if (
        generation === cloudWriteGeneration &&
        cloudTransition === transition
      ) {
        cloudTransition = null;
        cloudWriteNeedsRecovery = false;
      }
    })
    .catch((error: unknown) => {
      // A failed write/verification must not silently unpark the old owner.
      // A later explicit write can establish a fresh native transition.
      if (generation === cloudWriteGeneration) cloudWriteNeedsRecovery = true;
      throw error;
    });
  const nativeReady = trackNativeOwnerReady(ready);
  // Relay reads persisted credentials itself. Market verification must keep its
  // own gate without delaying or rejecting a successful relay credential write.
  return completion === "native-ready"
    ? nativeReady
    : persisted.then(() => undefined);
}

async function reloadStore(sharedStore: LazyStore): Promise<void> {
  await sharedStore.init();
  await sharedStore.reload({ ignoreDefaults: true });
}

async function readStoreSnapshot(
  sharedStore: LazyStore
): Promise<Map<string, unknown>> {
  return new Map(await sharedStore.entries<unknown>());
}

async function migrateLocalAuthOnce(
  sharedStore: LazyStore,
  snapshot: Map<string, unknown>
): Promise<void> {
  const schemaVersion = snapshot.get(SHARED_AUTH_SCHEMA_KEY);
  if (schemaVersion === SHARED_AUTH_SCHEMA_VERSION) return;

  const localEntries: Array<[SharedAuthKey, string]> = [];
  let sharedAuthAlreadyExists = false;

  for (const key of MIRRORED_AUTH_KEYS) {
    const sharedValue = snapshot.get(key);
    sharedAuthAlreadyExists ||= typeof sharedValue === "string";

    const value = localValue(key);
    if (value !== null) {
      localEntries.push([key, value]);
    }
  }

  const storeWasPreviouslyEstablished =
    typeof schemaVersion === "number" || sharedAuthAlreadyExists;

  // The very first origin seeds its existing hosted-auth values. Do not let
  // an empty dev origin establish an authoritative store: the bundled origin
  // may still own the pre-upgrade login.
  if (!storeWasPreviouslyEstablished && localEntries.length === 0) return;

  if (!storeWasPreviouslyEstablished) {
    for (const [key, value] of localEntries) {
      await sharedStore.set(key, value);
      snapshot.set(key, value);
    }
  }

  // Schema v1 predated ORG2 Cloud auth. Keep its migration unresolved while
  // both the shared store and this origin lack that key, so the bundled
  // `tauri://localhost` origin can still contribute it on a later launch.
  const sharedCloudAuth = snapshot.get(SHARED_ORG2_CLOUD_AUTH_STORAGE_KEY);
  const localCloudAuth = localValue(SHARED_ORG2_CLOUD_AUTH_STORAGE_KEY);
  if (typeof sharedCloudAuth !== "string" && localCloudAuth !== null) {
    await sharedStore.set(SHARED_ORG2_CLOUD_AUTH_STORAGE_KEY, localCloudAuth);
    snapshot.set(SHARED_ORG2_CLOUD_AUTH_STORAGE_KEY, localCloudAuth);
  }

  const cloudMigrationEstablished =
    typeof snapshot.get(SHARED_ORG2_CLOUD_AUTH_STORAGE_KEY) === "string";
  const nextSchemaVersion = cloudMigrationEstablished ? 2 : 1;
  if (schemaVersion === nextSchemaVersion) return;

  await sharedStore.set(SHARED_AUTH_SCHEMA_KEY, nextSchemaVersion);
  snapshot.set(SHARED_AUTH_SCHEMA_KEY, nextSchemaVersion);
  await sharedStore.save();
}

function copySharedAuthToLocal(snapshot: ReadonlyMap<string, unknown>): void {
  for (const key of MIRRORED_AUTH_KEYS) {
    const value = snapshot.get(key);
    setLocalValue(key, typeof value === "string" ? value : undefined);
  }
}

function notifySharedAuthSynchronized(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(SHARED_AUTH_SYNCHRONIZED_EVENT));
}

async function initializeOrSynchronize(): Promise<void> {
  if (!isTauri()) return;
  const generation = cloudWriteGeneration;

  await enqueueStoreOperation(async () => {
    const sharedStore = await getStore();
    await reloadStore(sharedStore);
    const snapshot = await readStoreSnapshot(sharedStore);
    await migrateLocalAuthOnce(sharedStore, snapshot);
    // A focus read started before a local logout/account change must not
    // overwrite the new atom state while its durable write is queued.
    if (generation !== cloudWriteGeneration) return;
    copySharedAuthToLocal(snapshot);
    projectedCloudOwner = serializedCloudOwner(
      localValue(SHARED_ORG2_CLOUD_AUTH_STORAGE_KEY)
    );
    // Market verification may be offline while ordinary Cloud auth hydration
    // is still valid. Native keeps Market gated and retries on the next sync;
    // existing auth consumers must still receive the canonical snapshot.
    if (!cloudTransition)
      void trackNativeOwnerReady(synchronizeNativeCloudOwner()).catch(() => {});
    notifySharedAuthSynchronized();
  });
}

/**
 * Establishes the shared store as the source of truth before auth atoms and
 * route guards are imported. The first upgraded launch migrates the current
 * origin's existing auth state; later launches never resurrect stale
 * per-origin localStorage after a shared sign-out.
 */
export function initializeSharedServiceAuthStorage(): Promise<void> {
  initializePromise ??= initializeOrSynchronize();
  return initializePromise;
}

/**
 * Re-read the on-disk auth state after focus returns. Calls are single-flight
 * so multiple mounted auth consumers cause only one disk read per focus event.
 */
export function synchronizeSharedServiceAuthStorage(): Promise<void> {
  if (synchronizePromise) return synchronizePromise;
  // Preserve a local logout/account change if its earlier durable write failed;
  // copying the old disk snapshot first would resurrect that discarded owner.
  const retry = cloudWriteNeedsRecovery
    ? writeCloudAuth(localValue(SHARED_ORG2_CLOUD_AUTH_STORAGE_KEY), true)
    : Promise.resolve();
  synchronizePromise = retry.then(initializeOrSynchronize).finally(() => {
    synchronizePromise = null;
  });
  return synchronizePromise;
}

/** Supabase-compatible async string storage. */
export const sharedServiceAuthStorage: StringStorage = {
  async getItem(key) {
    if (!isTauri()) return localValue(key);

    return enqueueStoreOperation(async () => {
      const sharedStore = await getStore();
      await reloadStore(sharedStore);
      const value = await sharedStore.get<unknown>(key);
      return typeof value === "string" ? value : null;
    });
  },

  async setItem(key, value) {
    if (!isTauri()) {
      setLocalValue(key, value);
      return;
    }

    if (key === SHARED_ORG2_CLOUD_AUTH_STORAGE_KEY) {
      await writeCloudAuth(value);
      return;
    }

    await enqueueStoreOperation(async () => {
      const sharedStore = await getStore();
      await reloadStore(sharedStore);
      const snapshot = await readStoreSnapshot(sharedStore);
      await migrateLocalAuthOnce(sharedStore, snapshot);
      await sharedStore.set(key, value);
      await sharedStore.save();
    });
  },

  async removeItem(key) {
    if (!isTauri()) {
      setLocalValue(key, undefined);
      return;
    }

    if (key === SHARED_ORG2_CLOUD_AUTH_STORAGE_KEY) {
      await writeCloudAuth(null);
      return;
    }

    await enqueueStoreOperation(async () => {
      const sharedStore = await getStore();
      await reloadStore(sharedStore);
      const snapshot = await readStoreSnapshot(sharedStore);
      await migrateLocalAuthOnce(sharedStore, snapshot);
      await sharedStore.delete(key);
      await sharedStore.save();
    });
  },
};

/**
 * Synchronous auth helpers keep their current localStorage API and mirror
 * mutations to the shared Tauri store in invocation order.
 */
export function mirrorSharedServiceAuthValue(
  key: SharedAuthKey,
  value: string | null
): void {
  if (!isTauri()) return;
  const operation =
    value === null
      ? sharedServiceAuthStorage.removeItem(key)
      : sharedServiceAuthStorage.setItem(key, value);
  void Promise.resolve(operation).catch(() => {});
}

/**
 * Await persisting ORG2 Cloud auth to the shared Tauri store before Rust
 * commands read `shared-service-auth.json` (mobile relay, pairing, etc.).
 *
 * `mirrorSharedServiceAuthValue` is fire-and-forget; callers that immediately
 * notify the Rust side must use this helper to avoid a read-before-write race.
 */
export async function awaitMirroredOrg2CloudAuth(
  serialized: string | null
): Promise<void> {
  if (!isTauri()) return;
  await writeCloudAuth(serialized, true, "persisted");
}

export const __SHARED_AUTH_STORAGE_INTERNALS = {
  MIRRORED_AUTH_KEYS,
  SHARED_AUTH_SCHEMA_KEY,
  SHARED_AUTH_SCHEMA_VERSION,
  SHARED_AUTH_STORE_PATH,
};

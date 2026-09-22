/**
 * Persisted ORG2 Cloud auth state (design §8.2 Org2CloudAuthState).
 *
 * `null` = signed out. Persisted via the same zod-validated localStorage
 * idiom as the collab atoms (`createZodJsonStorage`): a corrupted or
 * schema-incompatible stored value parses to the initial value (`null`,
 * i.e. signed out) instead of crashing atom hydration.
 *
 * `expiresAt` is kept as UNIX EPOCH SECONDS (number) — the exact wire
 * representation of both the deep-link fragment (`expires_at`) and the
 * Supabase token-refresh response, so no conversion can drift. Compare with
 * `Date.now() / 1000`.
 */
import { type ExtractAtomArgs, atom } from "jotai";
import { atomWithStorage } from "jotai/utils";

import {
  SHARED_AUTH_SYNCHRONIZED_EVENT,
  SHARED_ORG2_CLOUD_AUTH_STORAGE_KEY,
  mirrorSharedServiceAuthValue,
} from "@src/api/http/auth/sharedAuthStorage";
import { createZodJsonStorage } from "@src/util/core/storage/zodStorage";

import {
  type Org2CloudAuthState,
  Org2CloudAuthStateSchema,
  type Org2CloudProfile,
  parseStoredOrg2CloudAuth,
} from "./org2CloudAuthState";

export { Org2CloudAuthStateSchema };
export type { Org2CloudAuthState, Org2CloudProfile };

export const ORG2_CLOUD_AUTH_STORAGE_KEY = SHARED_ORG2_CLOUD_AUTH_STORAGE_KEY;

/**
 * Stable privacy/cache boundary for managed-cloud state. Access-token refresh
 * and profile enrichment replace the auth object without changing identity;
 * endpoint or account switches must produce a different key.
 */
export function org2CloudAuthIdentityKey(
  auth: Pick<Org2CloudAuthState, "supabaseUrl" | "userId">
): string {
  return `${auth.supabaseUrl.trim().replace(/\/+$/, "")}|${auth.userId}`;
}

const StoredAuthSchema = Org2CloudAuthStateSchema.nullable();
const localOrg2CloudAuthStorage = createZodJsonStorage(StoredAuthSchema);

export { parseStoredOrg2CloudAuth };

const sharedOrg2CloudAuthStorage = {
  getItem(key: string, initialValue: Org2CloudAuthState | null) {
    return localOrg2CloudAuthStorage.getItem(key, initialValue);
  },
  setItem(key: string, value: Org2CloudAuthState | null) {
    mirrorSharedServiceAuthValue(
      ORG2_CLOUD_AUTH_STORAGE_KEY,
      JSON.stringify(value)
    );
    localOrg2CloudAuthStorage.setItem(key, value);
  },
  removeItem(key: string) {
    mirrorSharedServiceAuthValue(ORG2_CLOUD_AUTH_STORAGE_KEY, null);
    localOrg2CloudAuthStorage.removeItem(key);
  },
  subscribe(
    key: string,
    callback: (value: Org2CloudAuthState | null) => void,
    initialValue: Org2CloudAuthState | null
  ) {
    const handleSynchronized = () => {
      callback(localOrg2CloudAuthStorage.getItem(key, initialValue));
    };
    window.addEventListener(SHARED_AUTH_SYNCHRONIZED_EVENT, handleSynchronized);
    return () =>
      window.removeEventListener(
        SHARED_AUTH_SYNCHRONIZED_EVENT,
        handleSynchronized
      );
  },
};

const storedOrg2CloudAuthAtom = atomWithStorage<Org2CloudAuthState | null>(
  ORG2_CLOUD_AUTH_STORAGE_KEY,
  null,
  sharedOrg2CloudAuthStorage,
  { getOnInit: true }
);
/** Read-only CAS checks must not cause atomWithStorage to rewrite credentials. */
export const org2CloudAuthAtom = atom(
  (get) => get(storedOrg2CloudAuthAtom),
  (get, set, update: ExtractAtomArgs<typeof storedOrg2CloudAuthAtom>[0]) => {
    const current = get(storedOrg2CloudAuthAtom);
    const next = typeof update === "function" ? update(current) : update;
    if (next !== current) set(storedOrg2CloudAuthAtom, next);
  }
);
org2CloudAuthAtom.debugLabel = "org2CloudAuthAtom";

/** Rehydration/profile enrichment may replace the object, not its credentials. */
export function isSameOrg2CloudSession(
  current: Org2CloudAuthState | null,
  expected: Org2CloudAuthState
): current is Org2CloudAuthState {
  return (
    current !== null &&
    org2CloudAuthIdentityKey(current) === org2CloudAuthIdentityKey(expected) &&
    current.supabaseAnonKey === expected.supabaseAnonKey &&
    current.oauthClientId === expected.oauthClientId &&
    current.accessToken === expected.accessToken &&
    current.refreshToken === expected.refreshToken &&
    current.expiresAt === expected.expiresAt
  );
}

function sameProfile(
  current: Org2CloudProfile | undefined,
  expected: Org2CloudProfile | undefined
): boolean {
  return (
    current?.displayName === expected?.displayName &&
    current?.primaryEmail === expected?.primaryEmail &&
    current?.avatarUrl === expected?.avatarUrl
  );
}

/**
 * Commit only the credential generation that initiated refresh. Shared-store
 * synchronization and atomWithStorage hydration parse a new object, so object
 * equality can discard a successful rotation and leave the spent token saved.
 * Generation equality survives those reads while protecting logout, endpoint /
 * client switches and newer sign-ins. Concurrent profile enrichment is kept.
 */
export function commitRefreshedAuth(
  setAuth: (
    updater: (prev: Org2CloudAuthState | null) => Org2CloudAuthState | null
  ) => void,
  previous: Org2CloudAuthState,
  fresh: Org2CloudAuthState
): boolean {
  let committed = false;
  setAuth((current) => {
    if (!isSameOrg2CloudSession(current, previous)) return current;
    committed = true;
    if (fresh === previous) return current;
    // Keep the fresh reference when possible: sign-in profile enrichment uses
    // it to verify ownership before its next RPC. Preserve a newer profile if
    // that is the only field updated while the token exchange was in flight.
    return sameProfile(current.profile, previous.profile)
      ? fresh
      : { ...fresh, profile: current.profile };
  });
  return committed;
}

/**
 * Sign the user out locally after GoTrue DEFINITIVELY rejects a refresh
 * credential (400/401 — never a transient network/timeout failure). Use the
 * same scoped credential-generation CAS as successful rotation, not object
 * reference or user id alone. A newer login or another endpoint/client cannot
 * be cleared by the late rejection of an older exchange.
 */
export function clearRejectedAuth(
  setAuth: (
    updater: (prev: Org2CloudAuthState | null) => Org2CloudAuthState | null
  ) => void,
  rejected: Org2CloudAuthState
): boolean {
  let cleared = false;
  setAuth((current) => {
    if (!isSameOrg2CloudSession(current, rejected)) {
      return current;
    }
    cleared = true;
    return null;
  });
  return cleared;
}

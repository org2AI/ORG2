/** Identity and persisted-generation checks shared by the refresh exchange. */
import {
  ORG2_CLOUD_AUTH_STORAGE_KEY,
  type Org2CloudAuthState,
  org2CloudAuthIdentityKey,
  parseStoredOrg2CloudAuth,
} from "./org2CloudAuthAtom";

/** Missing auth is readable sign-out state; unavailable storage is unknown. */
export function readPersistedOrg2CloudAuth():
  | Org2CloudAuthState
  | null
  | undefined {
  try {
    if (typeof localStorage === "undefined") return undefined;
    return parseStoredOrg2CloudAuth(
      localStorage.getItem(ORG2_CLOUD_AUTH_STORAGE_KEY)
    );
  } catch {
    return undefined;
  }
}

export function refreshScope(auth: Org2CloudAuthState): string {
  return JSON.stringify([
    org2CloudAuthIdentityKey(auth),
    auth.supabaseAnonKey,
    auth.oauthClientId ?? null,
  ]);
}

/** Profile enrichment does not replace a credential generation. */
export function persistedSessionKey(
  auth: Org2CloudAuthState | null
): string | null {
  return auth
    ? JSON.stringify([
        refreshScope(auth),
        auth.accessToken,
        auth.refreshToken,
        auth.expiresAt,
      ])
    : null;
}

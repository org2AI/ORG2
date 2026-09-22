/**
 * Org2CloudSyncEngine — retention-expired push parking.
 *
 * A session the server rejects with ORG2_RETENTION_EXPIRED is parked under
 * its (identity, org, session) key at its current `updated_at`; the push
 * loop skips it until the session changes again. Parks are durable across
 * restarts under the same auth identity (see `resetSyncState`).
 */
import type { Session } from "@src/store/session/sessionAtom/types";

import {
  type Org2CloudAuthState,
  org2CloudAuthAtom,
  org2CloudAuthIdentityKey,
} from "./org2CloudAuthAtom";
import {
  org2CloudRetentionParkedAtom,
  pruneRetentionParked,
  retentionParkKey,
} from "./org2CloudSyncAtoms";
import type { CloudStore } from "./org2CloudSyncLifecycle";

export function isRetentionParked(
  store: CloudStore,
  orgId: string,
  session: Session
): boolean {
  const auth = store.get(org2CloudAuthAtom);
  if (!auth) return false;
  const key = retentionParkKey(
    org2CloudAuthIdentityKey(auth),
    orgId,
    session.session_id
  );
  return store.get(org2CloudRetentionParkedAtom)[key] === session.updated_at;
}

export function parkRetentionExpired(
  store: CloudStore,
  auth: Org2CloudAuthState,
  orgId: string,
  session: Session
): void {
  const key = retentionParkKey(
    org2CloudAuthIdentityKey(auth),
    orgId,
    session.session_id
  );
  store.set(org2CloudRetentionParkedAtom, (current) => {
    // Reinsert renewed entries at the end of the bounded insertion-order cache.
    const next = { ...current };
    delete next[key];
    return pruneRetentionParked({ ...next, [key]: session.updated_at });
  });
}

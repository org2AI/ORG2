/**
 * Org2CloudSessionSync — cold-start seeding from a server-authoritative
 * listing.
 *
 * Restarts must prove that already-published sessions are unchanged without
 * re-materializing every transcript: the metadata hash gate is seeded from
 * the remote row, and the event plane is marked clean only when the durable
 * cursor still matches both the server summary and the local content /
 * execution revisions. The chain's protected bookkeeping is reached through
 * a small `RemoteSeedHost` the class hands in.
 */
import { eventStoreProxy } from "@src/engines/SessionCore/core/store/EventStoreProxy";
import type { RemoteTeammateSessionMetadata } from "@src/store/collaboration/types";
import type { Session } from "@src/store/session/sessionAtom/types";
import { isImportedHistorySession } from "@src/util/session/sessionDispatch";

import {
  sha256Hex,
  stableStringify,
} from "../TeamCollaboration/collabSyncUtils";
import type { CloudPushAccess } from "./org2CloudAccessSettings";
import type { Org2CloudAuthState } from "./org2CloudAuthAtom";
import {
  buildCloudSessionMetadata,
  metadataPayloadForHash,
} from "./org2CloudSessionSync.metadata";
import type { CollabSessionPushCursor } from "./org2CloudSyncAtoms";

/** The protected chain state and bookkeeping the seed path needs. */
export interface RemoteSeedHost {
  remoteSeedAttemptedKeys: Set<string>;
  lastPushedMetadataHashes: Map<string, string>;
  eventActivityStamps: ReadonlyMap<string, number>;
  setPushedMetadataMarker: (orgId: string, sessionId: string) => void;
  getCursor: (
    orgId: string,
    sessionId: string
  ) => CollabSessionPushCursor | undefined;
  setCursor: (cursor: CollabSessionPushCursor) => void;
  loadLocalExecutionRevision: (
    sessionId: string
  ) => Promise<string | null | undefined>;
  markEventPlaneClean: (
    orgId: string,
    session: Session,
    stampAtRead: number,
    verifiedAt: number,
    localContentRevision?: number,
    localExecutionRevision?: string | null
  ) => void;
}

/** Seed volatile cold-start caches from a server-authoritative listing. */
export async function seedFromRemoteSummary(
  host: RemoteSeedHost,
  auth: Org2CloudAuthState,
  orgId: string,
  session: Session,
  scopeKey: string | null,
  access: CloudPushAccess,
  remote: RemoteTeammateSessionMetadata
): Promise<void> {
  const key = `${orgId}:${session.session_id}`;
  if (host.remoteSeedAttemptedKeys.has(key)) return;
  host.remoteSeedAttemptedKeys.add(key);
  if (
    remote.deletedAt ||
    remote.ownerUserId !== auth.userId ||
    remote.sourceSessionId !== session.session_id
  ) {
    return;
  }
  const displayName =
    auth.profile?.displayName ?? auth.profile?.primaryEmail ?? auth.userId;
  const localMetadata = buildCloudSessionMetadata(
    session,
    orgId,
    auth.userId,
    displayName,
    scopeKey,
    access,
    auth.profile?.avatarUrl
  );
  const [localHash, remoteHash] = await Promise.all([
    sha256Hex(stableStringify(metadataPayloadForHash(localMetadata))),
    sha256Hex(stableStringify(metadataPayloadForHash(remote))),
  ]);
  if (localHash === remoteHash) {
    // upsertMetadataIfChanged gates on the FULL payload hash; seeding the
    // stripped comparison hash would never match it and every restart would
    // re-upsert an identical payload for every pushed session.
    host.lastPushedMetadataHashes.set(
      key,
      await sha256Hex(stableStringify(localMetadata))
    );
    host.setPushedMetadataMarker(orgId, session.session_id);
  }

  // Metadata and transcript are independent planes. Even if a title or
  // access field changed locally, a cursor stamped with this exact local
  // content version plus the server summary proves the event plane clean.
  // Legacy cursors lack the stamp and deliberately take one normal read.
  const cursor = host.getCursor(orgId, session.session_id);
  if (
    !cursor ||
    remote.eventsEpoch !== cursor.epoch ||
    remote.eventsFrozenSeq !== cursor.frozenSeq ||
    remote.eventsCount !== cursor.pushedCount ||
    (remote.eventsTailHash ?? null) !== cursor.tailHash
  ) {
    return;
  }
  const localExecutionRevision = await host.loadLocalExecutionRevision(
    session.session_id
  );
  // The durable cursor predates continuation-child revision stamps. A root
  // with children therefore needs one authoritative combined replay after
  // every app start before it can be marked clean in memory.
  if (localExecutionRevision !== undefined && localExecutionRevision !== "[]") {
    return;
  }
  let localContentRevision: number | undefined;
  if (!isImportedHistorySession(session.session_id)) {
    const durable = await eventStoreProxy.getPersistedEventRevision(
      session.session_id
    );
    if (durable && durable.eventCount > 0) {
      if (durable.eventCount !== cursor.pushedCount) return;
      if (
        cursor.localContentRevision !== undefined &&
        cursor.localContentRevision !== durable.revision
      ) {
        return;
      }
      // Legacy revisions are upgraded from the server cursor + local count
      // proof. Crucially this is independent of Session.updated_at: rename,
      // pin and org-access edits are metadata changes and must not trigger a
      // multi-GB replay materialization.
      localContentRevision = durable.revision;
      if (cursor.localContentRevision !== durable.revision) {
        host.setCursor({ ...cursor, localContentRevision: durable.revision });
      }
    } else if (cursor.localContentUpdatedAt !== session.updated_at) {
      return;
    }
  } else if (cursor.localContentUpdatedAt !== session.updated_at) {
    return;
  }
  host.markEventPlaneClean(
    orgId,
    session,
    host.eventActivityStamps.get(session.session_id) ?? 0,
    Date.now(),
    localContentRevision,
    localExecutionRevision
  );
}

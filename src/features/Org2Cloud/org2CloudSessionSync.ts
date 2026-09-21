/**
 * Owns one session's metadata/event push plane, including persisted cursors,
 * event-clean stamps, OCC re-anchors, and retract bookkeeping.
 *
 * The class is assembled from an inheritance chain, each link a sibling file:
 * - `.state`      in-memory bookkeeping (hashes, clean stamps, cursors)
 * - `.pushEvents` materializing a session's events into a prepared push plan
 * - `.turnIndex`  the 0012 index publish (and the sync-client dependency)
 * - `.upload`     metadata upsert plus the three segment mutations
 * - `.pushPhases` shared-file sync and the replay write branches of one pass
 * and this file adds the pass orchestration that decides which of them runs.
 * Two composed helpers sit beside the chain: `.pushGuards` (per-session
 * retry + shrink confirmation) and `.remoteSeed` (cold-start seeding).
 */
import { COLLAB_SESSION_ACCESS_MODE } from "@src/store/collaboration/types";
import type { RemoteTeammateSessionMetadata } from "@src/store/collaboration/types";
import type { Session } from "@src/store/session/sessionAtom/types";

import type { CloudPushAccess } from "./org2CloudAccessSettings";
import type { Org2CloudAuthState } from "./org2CloudAuthAtom";
import { getCloudCapabilitiesConfirmed } from "./org2CloudCapabilities";
import { broadcastOrgControlChangedToPeers } from "./org2CloudControlBus";
import { endpointForOrg } from "./org2CloudOrgEndpointRouter";
import { Org2CloudSessionPushGuards } from "./org2CloudSessionSync.pushGuards";
import {
  Org2CloudSessionSyncPushPhases,
  type PreparedPushPass,
} from "./org2CloudSessionSync.pushPhases";
import {
  type RemoteSeedHost,
  seedFromRemoteSummary,
} from "./org2CloudSessionSync.remoteSeed";
import { isOrg2SyncErrorCode } from "./org2CloudSyncClient";

export {
  buildCloudSessionMetadata,
  isCloudPushCandidate,
} from "./org2CloudSessionSync.metadata";
export type { Org2CloudSyncClientDeps } from "./org2CloudSessionSync.types";
export { IMPORTED_INCREMENTAL_REANCHOR_EVERY } from "./org2CloudSessionSync.pushEvents";
export {
  SESSION_PUSH_RETRY_BASE_MS,
  SESSION_PUSH_RETRY_MAX_MS,
} from "./org2CloudSessionSync.pushGuards";
export { normalizeTurnPromptPreview } from "./org2CloudSessionSync.turnIndex";
export { SESSION_SEGMENT_UPLOAD_BATCH_SIZE } from "./org2CloudSessionSync.upload";

export class Org2CloudSessionSync extends Org2CloudSessionSyncPushPhases {
  /** Per-session transient retry + shrink confirmation, split out to
   * `Org2CloudSessionPushGuards`. */
  private readonly pushGuards = new Org2CloudSessionPushGuards();

  override reset(): void {
    super.reset();
    this.pushGuards.reset();
  }

  override prune(
    liveOrgIds: ReadonlySet<string>,
    liveSessionIds: ReadonlySet<string>
  ): void {
    super.prune(liveOrgIds, liveSessionIds);
    this.pushGuards.prune(liveOrgIds, liveSessionIds);
  }

  /** Seed volatile cold-start caches from a server-authoritative listing. */
  seedFromRemoteSummary(
    auth: Org2CloudAuthState,
    orgId: string,
    session: Session,
    scopeKey: string | null,
    access: CloudPushAccess,
    remote: RemoteTeammateSessionMetadata
  ): Promise<void> {
    return seedFromRemoteSummary(
      this.remoteSeedHost(),
      auth,
      orgId,
      session,
      scopeKey,
      access,
      remote
    );
  }

  /** The chain's protected bookkeeping, handed to the seed helper. */
  private remoteSeedHost(): RemoteSeedHost {
    return {
      remoteSeedAttemptedKeys: this.remoteSeedAttemptedKeys,
      lastPushedMetadataHashes: this.lastPushedMetadataHashes,
      eventActivityStamps: this.eventActivityStamps,
      setPushedMetadataMarker: (orgId, sessionId) =>
        this.setPushedMetadataMarker(orgId, sessionId),
      getCursor: (orgId, sessionId) => this.getCursor(orgId, sessionId),
      setCursor: (cursor) => this.setCursor(cursor),
      loadLocalExecutionRevision: (sessionId) =>
        this.loadLocalExecutionRevision(sessionId),
      markEventPlaneClean: (
        orgId,
        session,
        stampAtRead,
        verifiedAt,
        localContentRevision,
        localExecutionRevision
      ) =>
        this.markEventPlaneClean(
          orgId,
          session,
          stampAtRead,
          verifiedAt,
          localContentRevision,
          localExecutionRevision
        ),
    };
  }

  /** Soft-tombstone a prior push and clear every local pushed marker. */
  /** Live server rows this ACCOUNT owns in the org, regardless of which
   * device pushed them or whether local push markers survived. */
  async listSelfOwnedLiveRemoteSessionIds(
    auth: Org2CloudAuthState,
    orgId: string
  ): Promise<string[]> {
    const result = await this.client.listOrgSessions(auth.accessToken, orgId);
    return result.sessions
      .filter((row) => row.ownerUserId === auth.userId && !row.deletedAt)
      .map((row) => row.sourceSessionId);
  }

  async retractSession(
    auth: Org2CloudAuthState,
    orgId: string,
    sessionId: string
  ): Promise<void> {
    try {
      await this.client.deleteSession(auth.accessToken, orgId, sessionId);
    } catch (error) {
      if (!isOrg2SyncErrorCode(error, "ORG2_SESSION_NOT_FOUND")) throw error;
    }
    this.invalidatePushedMetadataHash(orgId, sessionId);
    this.lastPushedTurnIndexHashes.delete(`${orgId}:${sessionId}`);
    this.clearPushedMetadataMarker(orgId, sessionId);
    this.clearCursor(orgId, sessionId);
    broadcastOrgControlChangedToPeers(orgId, "sessions");
  }

  async pushSession(
    auth: Org2CloudAuthState,
    orgId: string,
    session: Session,
    scopeKey: string | null,
    access: CloudPushAccess
  ): Promise<void> {
    const sessionId = session.session_id;
    if (
      access.accessMode !== COLLAB_SESSION_ACCESS_MODE.METADATA_ONLY &&
      this.pushGuards.isSessionPushBackedOff(orgId, sessionId)
    ) {
      // Metadata remains cheap and live while the expensive transcript plane
      // sleeps. The hash gate makes this a no-RPC no-op when unchanged.
      await this.upsertMetadataIfChanged(
        auth,
        orgId,
        session,
        scopeKey,
        access
      );
      return;
    }
    try {
      await this.pushSessionOnce(auth, orgId, session, scopeKey, access);
      this.pushGuards.clearSessionPushFailure(orgId, sessionId);
    } catch (error) {
      if (this.pushGuards.shouldBackOffSessionFailure(error)) {
        this.pushGuards.noteSessionPushFailure(orgId, sessionId);
      }
      throw error;
    }
  }

  private async pushSessionOnce(
    auth: Org2CloudAuthState,
    orgId: string,
    session: Session,
    scopeKey: string | null,
    access: CloudPushAccess
  ): Promise<void> {
    const sessionId = session.session_id;
    if (access.accessMode === COLLAB_SESSION_ACCESS_MODE.METADATA_ONLY) {
      await this.upsertMetadataIfChanged(
        auth,
        orgId,
        session,
        scopeKey,
        access
      );
      // A metadata-only pass invalidates local segment knowledge. If policy
      // later rises to full replay, rebuild the authoritative transcript.
      this.cleanEventPlanes.get(sessionId)?.delete(orgId);
      this.clearCursor(orgId, sessionId);
      return;
    }
    // The external-history scanner updates sessionsAtom directly, without an
    // EventStore notification. Gate on the source's updated_at as well as the
    // event-store stamp, and defer metadata together with replay so a live CLI
    // turn does not produce one cloud upsert per scanner refresh.
    if (!this.isExternalHistorySettled(session)) return;
    const currentLocalExecutionRevision =
      await this.loadLocalExecutionRevision(sessionId);
    const cursor = this.getCursor(orgId, sessionId);
    // Old transcript cursors do not prove the referenced files were uploaded.
    // Probe is endpoint-cached; unsupported servers preserve the existing idle gate.
    const needsFileBackfill =
      cursor && cursor.sharedFilesVersion !== 1
        ? (
            await getCloudCapabilitiesConfirmed(
              auth.accessToken,
              endpointForOrg(orgId)
            )
          ).capabilities.sharedSessionFiles === true
        : false;
    if (
      !needsFileBackfill &&
      this.isEventPlaneClean(orgId, session, currentLocalExecutionRevision)
    ) {
      await this.upsertMetadataIfChanged(
        auth,
        orgId,
        session,
        scopeKey,
        access
      );
      return;
    }
    const prepared = await this.preparePushEventsForPass(
      sessionId,
      cursor,
      needsFileBackfill
    );
    const {
      stampAtRead,
      mode,
      baseEventCount,
      localContentRevision,
      localExecutionRevision,
      events,
    } = prepared;
    let sharedFilesReady = false;
    const markPreparedClean = () => {
      this.markEventPlaneClean(
        orgId,
        session,
        stampAtRead,
        Date.now(),
        localContentRevision,
        localExecutionRevision
      );
      const latestCursor = this.getCursor(orgId, sessionId);
      if (
        sharedFilesReady &&
        latestCursor &&
        latestCursor.sharedFilesVersion !== 1
      )
        this.setCursor({ ...latestCursor, sharedFilesVersion: 1 });
    };
    const publishPreparedTurnIndex = () => {
      void this.publishTurnIndexBestEffort(auth, orgId, session, stampAtRead);
    };
    if (!cursor && events.length === 0) {
      await this.upsertMetadataIfChanged(
        auth,
        orgId,
        session,
        scopeKey,
        access
      );
      markPreparedClean();
      return;
    }
    // Equals the plan's totalEventCount without forcing the plan: the shrink
    // dance below returns without pushing on its first observation, and
    // hashing a GB-scale transcript just to skip would defeat this pass.
    const observedTotalEventCount = baseEventCount + events.length;
    const shrink = this.pushGuards.observeShrink(
      orgId,
      sessionId,
      observedTotalEventCount,
      cursor?.pushedCount
    );
    if (shrink === "skip") return;
    const confirmedShrink = shrink === "confirmed";

    // A replay exposes its referenced files as independent immutable snapshots.
    // Register only after the source session exists; no transcript bytes/hashes
    // are rewritten to add attachment data.
    await this.upsertMetadataIfChanged(auth, orgId, session, scopeKey, access);
    sharedFilesReady = await this.syncReplaySharedFiles(
      auth,
      orgId,
      session,
      events
    );
    const preparedPlan = await prepared.plan();
    const pass: PreparedPushPass = {
      auth,
      orgId,
      session,
      scopeKey,
      access,
      prepared,
      preparedPlan,
      confirmedShrink,
      markPreparedClean,
      publishPreparedTurnIndex,
    };

    if (cursor && mode === "incremental") {
      await this.pushIncrementalReplay(pass, cursor);
      return;
    }

    if (cursor) {
      await this.pushCursorReplay(pass, cursor);
      return;
    }

    await this.pushInitialReplay(pass);
  }
}

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
import { isCliSession } from "@src/util/session/sessionDispatch";

import type { CloudPushAccess } from "./org2CloudAccessSettings";
import type { Org2CloudAuthState } from "./org2CloudAuthAtom";
import { getCloudCapabilitiesConfirmed } from "./org2CloudCapabilities";
import { broadcastOrgControlChangedToPeers } from "./org2CloudControlBus";
import type { CloudSessionOperation } from "./org2CloudSessionOperation";
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
    return this.runOperation(auth, orgId, (operation) =>
      seedFromRemoteSummary(
        this.remoteSeedHost(operation),
        auth,
        orgId,
        session,
        scopeKey,
        access,
        remote,
        operation
      )
    );
  }
  /** The chain's protected bookkeeping, handed to the seed helper. */
  private remoteSeedHost(operation: CloudSessionOperation): RemoteSeedHost {
    return {
      remoteSeedAttemptedKeys: this.remoteSeedAttemptedKeys,
      lastPushedMetadataHashes: this.lastPushedMetadataHashes,
      eventActivityStamps: this.eventActivityStamps,
      setPushedMetadataMarker: (orgId, sessionId) =>
        this.setPushedMetadataMarker(operation, orgId, sessionId),
      getCursor: (orgId, sessionId) => this.getCursor(orgId, sessionId),
      setCursor: (cursor) => this.setCursor(operation, cursor),
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
          operation,
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
  listSelfOwnedLiveRemoteSessionIds(
    auth: Org2CloudAuthState,
    orgId: string
  ): Promise<string[]> {
    return this.runOperation(auth, orgId, (operation) =>
      this.listSelfOwnedLiveRemoteSessionIdsWithOperation(
        auth,
        orgId,
        operation
      )
    );
  }
  private async listSelfOwnedLiveRemoteSessionIdsWithOperation(
    auth: Org2CloudAuthState,
    orgId: string,
    operation: CloudSessionOperation
  ): Promise<string[]> {
    operation.assertCurrent();
    const result = await operation.wait(() =>
      this.client.listOrgSessions(
        auth.accessToken,
        orgId,
        undefined,
        operation.signal,
        operation.request
      )
    );
    return result.sessions
      .filter((row) => row.ownerUserId === auth.userId && !row.deletedAt)
      .map((row) => row.sourceSessionId);
  }
  retractSession(
    auth: Org2CloudAuthState,
    orgId: string,
    sessionId: string
  ): Promise<void> {
    return this.runOperation(auth, orgId, (operation) =>
      this.retractSessionWithOperation(auth, orgId, sessionId, operation)
    );
  }
  private async retractSessionWithOperation(
    auth: Org2CloudAuthState,
    orgId: string,
    sessionId: string,
    operation: CloudSessionOperation
  ): Promise<void> {
    operation.assertCurrent();
    try {
      await operation.wait(() =>
        this.client.deleteSession(
          auth.accessToken,
          orgId,
          sessionId,
          operation.request
        )
      );
    } catch (error) {
      operation.assertCurrent();
      if (!isOrg2SyncErrorCode(error, "ORG2_SESSION_NOT_FOUND")) throw error;
    }
    this.invalidatePushedMetadataHash(orgId, sessionId);
    this.lastPushedTurnIndexHashes.delete(`${orgId}:${sessionId}`);
    this.clearPushedMetadataMarker(operation, orgId, sessionId);
    this.clearCursor(operation, orgId, sessionId);
    broadcastOrgControlChangedToPeers(orgId, "sessions");
  }
  pushSession(
    auth: Org2CloudAuthState,
    orgId: string,
    session: Session,
    scopeKey: string | null,
    access: CloudPushAccess
  ): Promise<void> {
    return this.runOperation(auth, orgId, (operation) =>
      this.pushSessionWithOperation(
        auth,
        orgId,
        session,
        scopeKey,
        access,
        operation
      )
    );
  }
  private async pushSessionWithOperation(
    auth: Org2CloudAuthState,
    orgId: string,
    session: Session,
    scopeKey: string | null,
    access: CloudPushAccess,
    operation: CloudSessionOperation
  ): Promise<void> {
    operation.assertCurrent();
    const sessionId = session.session_id;
    if (
      access.accessMode !== COLLAB_SESSION_ACCESS_MODE.METADATA_ONLY &&
      this.pushGuards.isSessionPushBackedOff(orgId, sessionId)
    ) {
      // Metadata remains cheap and live while the expensive transcript plane
      // sleeps. The hash gate makes this a no-RPC no-op when unchanged.
      await operation.wait(() =>
        this.upsertMetadataIfChanged(
          auth,
          orgId,
          session,
          scopeKey,
          access,
          operation
        )
      );
      return;
    }
    try {
      await operation.wait(() =>
        this.pushSessionOnce(auth, orgId, session, scopeKey, access, operation)
      );
      this.pushGuards.clearSessionPushFailure(orgId, sessionId);
    } catch (error) {
      operation.assertCurrent();
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
    access: CloudPushAccess,
    operation: CloudSessionOperation
  ): Promise<void> {
    operation.assertCurrent();
    const sessionId = session.session_id;
    if (access.accessMode === COLLAB_SESSION_ACCESS_MODE.METADATA_ONLY) {
      await operation.wait(async () =>
        this.upsertMetadataIfChanged(
          auth,
          orgId,
          session,
          scopeKey,
          access,
          operation
        )
      );
      // A metadata-only pass invalidates local segment knowledge. If policy
      // later rises to full replay, rebuild the authoritative transcript.
      this.cleanEventPlanes.get(sessionId)?.delete(orgId);
      this.clearCursor(operation, orgId, sessionId);
      return;
    }
    // The external-history scanner updates sessionsAtom directly, without an
    // EventStore notification. Gate on the source's updated_at as well as the
    // event-store stamp, and defer metadata together with replay so a live CLI
    // turn does not produce one cloud upsert per scanner refresh.
    if (!this.isExternalHistorySettled(session)) return;
    const currentLocalExecutionRevision = await operation.wait(async () =>
      this.loadLocalExecutionRevision(sessionId)
    );
    const cursor = this.getCursor(orgId, sessionId);
    // Old transcript cursors do not prove the referenced files were uploaded.
    // Probe is endpoint-cached; unsupported servers preserve the existing idle gate.
    const needsFileBackfill =
      cursor && cursor.sharedFilesVersion !== 1
        ? (
            await operation.wait(async () =>
              getCloudCapabilitiesConfirmed(
                auth.accessToken,
                operation.endpoint
              )
            )
          ).capabilities.sharedSessionFiles === true
        : false;
    if (
      !needsFileBackfill &&
      this.isEventPlaneClean(orgId, session, currentLocalExecutionRevision)
    ) {
      await operation.wait(async () =>
        this.upsertMetadataIfChanged(
          auth,
          orgId,
          session,
          scopeKey,
          access,
          operation
        )
      );
      return;
    }
    const prepared = await operation.wait(async () =>
      this.preparePushEventsForPass(sessionId, cursor, needsFileBackfill)
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
      operation.assertCurrent();
      if (
        prepared.cliHistoryMutation &&
        (this.eventActivityStamps.get(sessionId) ?? 0) === stampAtRead
      ) {
        const acknowledged = this.getCursor(orgId, sessionId);
        if (
          acknowledged &&
          acknowledged.cliHistoryEpoch !== prepared.cliHistoryMutation.epoch
        ) {
          this.setCursor(operation, {
            ...acknowledged,
            cliHistoryEpoch: prepared.cliHistoryMutation.epoch,
          });
        }
      }
      this.markEventPlaneClean(
        operation,
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
        this.setCursor(operation, { ...latestCursor, sharedFilesVersion: 1 });
    };
    const publishPreparedTurnIndex = () => {
      return this.publishTurnIndexBestEffort(
        auth,
        orgId,
        session,
        stampAtRead,
        operation
      );
    };
    if (!cursor && events.length === 0) {
      await operation.wait(async () =>
        this.upsertMetadataIfChanged(
          auth,
          orgId,
          session,
          scopeKey,
          access,
          operation
        )
      );
      markPreparedClean();
      return;
    }
    // Equals the plan's totalEventCount without forcing the plan: the shrink
    // dance below returns without pushing on its first observation, and
    // hashing a GB-scale transcript just to skip would defeat this pass.
    const observedTotalEventCount = baseEventCount + events.length;
    let confirmedShrink = false;
    if (
      isCliSession(sessionId) &&
      cursor &&
      observedTotalEventCount < cursor.pushedCount
    ) {
      const mutation = prepared.cliHistoryMutation;
      confirmedShrink = Boolean(
        observedTotalEventCount > 0 &&
        mutation &&
        cursor.cliHistoryEpoch !== undefined &&
        mutation.epoch > cursor.cliHistoryEpoch &&
        ["message_truncate", "file_rewind", "snapshot_restore"].includes(
          mutation.reason
        )
      );
      if (!confirmedShrink) return;
    } else {
      const shrink = this.pushGuards.observeShrink(
        orgId,
        sessionId,
        observedTotalEventCount,
        cursor?.pushedCount
      );
      if (shrink === "skip") return;
      confirmedShrink = shrink === "confirmed";
    }
    // A replay exposes its referenced files as independent immutable snapshots.
    // Register only after the source session exists; no transcript bytes/hashes
    // are rewritten to add attachment data.
    await operation.wait(async () =>
      this.upsertMetadataIfChanged(
        auth,
        orgId,
        session,
        scopeKey,
        access,
        operation
      )
    );
    sharedFilesReady = await operation.wait(async () =>
      this.syncReplaySharedFiles(auth, orgId, session, events, operation)
    );
    const preparedPlan = await operation.wait(async () => prepared.plan());
    const pass: PreparedPushPass = {
      operation,
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
      await operation.wait(async () =>
        this.pushIncrementalReplay(pass, cursor)
      );
      return;
    }
    if (cursor) {
      await operation.wait(async () => this.pushCursorReplay(pass, cursor));
      return;
    }
    await operation.wait(async () => this.pushInitialReplay(pass));
  }
}

/**
 * The write phases of one Org2CloudSessionSync push pass, run after its gates,
 * event preparation and shrink observation: one of the
 * three replay branches (bounded imported delta, cursor-anchored delta append
 * or epoch rewrite, first publish), then independently scheduled shared-file sync.
 *
 * Fifth link of the Org2CloudSessionSync inheritance chain; which branch runs
 * is still decided by `pushSessionOnce` in Org2CloudSessionSync itself.
 */
import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import { createLogger } from "@src/hooks/logger";
import type { Session } from "@src/store/session/sessionAtom/types";

import { splitFrozenIntoSegments } from "../TeamCollaboration/engine/collabSyncEngineHelpers";
import type { CloudPushAccess } from "./org2CloudAccessSettings";
import {
  type Org2CloudAuthState,
  org2CloudAuthAtom,
  org2CloudAuthIdentityKey,
} from "./org2CloudAuthAtom";
import { getCloudCapabilitiesConfirmed } from "./org2CloudCapabilities";
import { broadcastOrgControlChangedToPeers } from "./org2CloudControlBus";
import { endpointForOrg } from "./org2CloudOrgEndpointRouter";
import type {
  PreparedPushEvents,
  PreparedPushPlan,
} from "./org2CloudSessionSync.types";
import { Org2CloudSessionSyncUpload } from "./org2CloudSessionSync.upload";
import type { CollabSessionPushCursor } from "./org2CloudSyncAtoms";
import { isOrg2SyncErrorCode } from "./org2CloudSyncClient";
import {
  SessionSharedFileRetry,
  sharedFileRetryScope,
} from "./sessionSharedFileRetry";
import { SharedSessionFileRequestError } from "./sharedSessionFilesClient";

const log = createLogger("Org2CloudSyncEngine");
const MAX_REPLAY_FILE_JOBS = 2;

interface ReplayFileJob {
  orgId: string;
  sessionId: string;
  controller: AbortController;
}

/** One prepared pass, handed from `pushSessionOnce` to its write phases. */
export interface PreparedPushPass {
  auth: Org2CloudAuthState;
  orgId: string;
  session: Session;
  scopeKey: string | null;
  access: CloudPushAccess;
  prepared: PreparedPushEvents;
  preparedPlan: PreparedPushPlan;
  /** The shrink guard confirmed a short read on consecutive passes. */
  confirmedShrink: boolean;
  /** Stamp the event plane clean for the prepared read. */
  markPreparedClean: () => void;
  /** Fire the best-effort turn-index publish for the prepared read. */
  publishPreparedTurnIndex: () => void;
}

export class Org2CloudSessionSyncPushPhases extends Org2CloudSessionSyncUpload {
  private readonly sharedFileRetry = new SessionSharedFileRetry();
  // No in-memory backlog: the persisted cursor remains pending if slots are full.
  // Aborted jobs retain their slots until their actual work settles.
  private readonly sharedFileJobs = new Set<ReplayFileJob>();
  protected sharedFileGeneration = 0;
  private sharedFileDiagnosticAt = -Infinity;

  override reset(): void {
    super.reset();
    this.sharedFileGeneration++;
    this.sharedFileRetry.reset();
    this.sharedFileDiagnosticAt = -Infinity;
    for (const job of this.sharedFileJobs) job.controller.abort();
  }

  override prune(
    orgs: ReadonlySet<string>,
    sessions: ReadonlySet<string>
  ): void {
    super.prune(orgs, sessions);
    this.sharedFileRetry.prune(orgs, sessions);
    for (const job of this.sharedFileJobs) {
      if (!orgs.has(job.orgId) || !sessions.has(job.sessionId))
        job.controller.abort();
    }
  }

  protected cancelReplaySharedFiles(orgId: string, sessionId: string): void {
    for (const job of this.sharedFileJobs) {
      if (job.orgId === orgId && job.sessionId === sessionId)
        job.controller.abort();
    }
  }

  /**
   * Body publication never waits for attachment probes, reads or uploads.
   * Existing sync passes rediscover pending cursors after saturation/restart;
   * no new polling loop or retained queue of transcript arrays is introduced.
   */
  protected scheduleReplaySharedFiles(
    auth: Org2CloudAuthState,
    orgId: string,
    session: Session,
    coveredEvents?: SessionEvent[]
  ): void {
    const sessionId = session.session_id;
    const cursor = this.getCursor(orgId, sessionId);
    const endpoint = endpointForOrg(orgId);
    const scope = sharedFileRetryScope(
      auth,
      endpoint.supabaseUrl,
      orgId,
      sessionId
    );
    if (!cursor || cursor.sharedFilesVersion === 1) return;
    let deferredReason: string | null = null;
    if (
      typeof document !== "undefined" &&
      document.visibilityState === "hidden"
    )
      deferredReason = "hidden";
    else if (this.sharedFileRetry.isBackedOff(scope))
      deferredReason = "backoff";
    else if (this.sharedFileJobs.size >= MAX_REPLAY_FILE_JOBS)
      deferredReason = "capacity";
    else if (
      [...this.sharedFileJobs].some(
        (job) => job.orgId === orgId && job.sessionId === sessionId
      )
    )
      deferredReason = "in-flight";
    if (deferredReason) {
      this.noteSharedFileDeferral(deferredReason);
      return;
    }
    const job: ReplayFileJob = {
      orgId,
      sessionId,
      controller: new AbortController(),
    };
    const generation = this.sharedFileGeneration;
    const isCurrent = () => {
      const latest = this.getStore()?.get(org2CloudAuthAtom);
      return (
        !job.controller.signal.aborted &&
        generation === this.sharedFileGeneration &&
        latest !== null &&
        latest !== undefined &&
        org2CloudAuthIdentityKey(latest) === org2CloudAuthIdentityKey(auth) &&
        endpointForOrg(orgId).supabaseUrl === endpoint.supabaseUrl &&
        (typeof document === "undefined" ||
          document.visibilityState !== "hidden") &&
        this.getCursor(orgId, sessionId) !== undefined
      );
    };
    const assertCurrentIdentity = () => {
      if (!isCurrent())
        throw new Error("Replay attachment task is no longer active");
    };
    this.sharedFileJobs.add(job);
    void (async () => {
      try {
        assertCurrentIdentity();
        const { syncSessionSharedFiles } =
          await import("./syncSessionSharedFiles");
        assertCurrentIdentity();
        let events = coveredEvents;
        if (!events) {
          // A pending file marker must not force the BODY to reload full history.
          // Probe before a background backfill read on unsupported endpoints.
          const probe = await getCloudCapabilitiesConfirmed(
            auth.accessToken,
            endpoint
          );
          assertCurrentIdentity();
          if (!probe.confirmed || !probe.capabilities.sharedSessionFiles)
            throw new SharedSessionFileRequestError(
              "Shared file support unavailable",
              null,
              true
            );
          events = await this.loadPushEvents(sessionId);
          assertCurrentIdentity();
        }
        const ready = await syncSessionSharedFiles({
          token: auth.accessToken,
          endpoint,
          orgId,
          sessionId,
          events,
          repoPath: session.repoPath,
          assertCurrentIdentity,
          signal: job.controller.signal,
        });
        assertCurrentIdentity();
        // A newer body/cursor owns its own attachment acknowledgement. Even a
        // successful older job cannot certify deltas that arrived during upload.
        if (ready && this.getCursor(orgId, sessionId) === cursor)
          this.setCursor({ ...cursor, sharedFilesVersion: 1 });
        else if (ready) this.noteSharedFileDeferral("newer-body");
        else
          this.sharedFileRetry.noteFailure(
            scope,
            new Error("Shared files pending")
          );
      } catch (error) {
        // Obsolete work never poisons body retries or a new identity's file state.
        if (isCurrent()) {
          this.sharedFileRetry.noteFailure(scope, error);
          log.warn(
            `Replay published; shared files pending for session ${sessionId}`,
            error
          );
        } else this.noteSharedFileDeferral("cancelled");
      } finally {
        this.sharedFileJobs.delete(job);
      }
    })();
  }

  /** One diagnostic per owner/minute, without another retained map or timer. */
  private noteSharedFileDeferral(reason: string): void {
    const now = Date.now();
    if (now - this.sharedFileDiagnosticAt < 60_000) return;
    this.sharedFileDiagnosticAt = now;
    log.info(
      `Replay attachments remain pending (${reason}); body scheduling is independent`
    );
  }

  /**
   * Imported history prepared from only the suffix past the cursor: one
   * bounded append, re-anchored by a full authoritative rewrite on conflict.
   */
  protected async pushIncrementalReplay(
    pass: PreparedPushPass,
    cursor: CollabSessionPushCursor
  ): Promise<void> {
    const { auth, orgId, session, scopeKey, access, preparedPlan } = pass;
    const { markPreparedClean, publishPreparedTurnIndex } = pass;
    const sessionId = session.session_id;
    const { baseEventCount, events } = pass.prepared;
    const {
      totalEventCount,
      localFrozenEventCount,
      tailHash,
      frozenChainHash,
      importedReplay,
    } = preparedPlan;
    const priorFrozenInsideWindow = cursor.frozenEventCount - baseEventCount;
    const newFrozenEvents = events.slice(
      priorFrozenInsideWindow,
      localFrozenEventCount
    );
    if (
      newFrozenEvents.length === 0 &&
      tailHash === cursor.tailHash &&
      totalEventCount === cursor.pushedCount
    ) {
      await this.upsertMetadataIfChanged(
        auth,
        orgId,
        session,
        scopeKey,
        access
      );
      if (importedReplay) {
        this.setCursor({
          ...cursor,
          frozenChainHash,
          importedReplay,
        });
      }
      markPreparedClean();
      return;
    }
    await this.upsertMetadataIfChanged(auth, orgId, session, scopeKey, access);
    try {
      await this.appendIncrementalSession(
        auth,
        orgId,
        sessionId,
        cursor,
        newFrozenEvents,
        preparedPlan
      );
    } catch (error) {
      if (!isOrg2SyncErrorCode(error, "ORG2_CONFLICT")) throw error;
      const fullPrepared = await this.preparePushEventsForPass(
        sessionId,
        cursor,
        true
      );
      const fullPlan = await fullPrepared.plan();
      await this.rewriteSession(auth, orgId, session, scopeKey, access, {
        events: fullPrepared.events,
        ...fullPlan,
        newEpoch: null,
      });
    }
    broadcastOrgControlChangedToPeers(orgId, "sessions");
    markPreparedClean();
    publishPreparedTurnIndex();
  }

  /**
   * Full read against an existing cursor: extend its epoch while the frozen
   * history is intact, otherwise rewrite the history under the next epoch.
   */
  protected async pushCursorReplay(
    pass: PreparedPushPass,
    cursor: CollabSessionPushCursor
  ): Promise<void> {
    const { auth, orgId, session, scopeKey, access, preparedPlan } = pass;
    const { confirmedShrink, markPreparedClean, publishPreparedTurnIndex } =
      pass;
    const sessionId = session.session_id;
    const { events } = pass.prepared;
    const {
      perEventHashes,
      frozenHashMode,
      totalEventCount,
      frozenEventCount,
      localFrozenEventCount,
      tailEvents,
      tailHash,
      frozenChainHash,
      importedReplay,
    } = preparedPlan;
    let frozenIntact =
      !confirmedShrink && frozenEventCount >= cursor.frozenEventCount;
    if (frozenIntact && cursor.frozenEventCount > 0) {
      // The cursor's commitment may be in either hash mode: flat-v1 cursors
      // predate the imported-replay checkpoint, a failed turn-id probe
      // downgrades a checkpointed cursor, and an interrupted batch append
      // persists a merkle commitment without its checkpoint. Both modes
      // commit to the same per-event hashes, so intactness accepts a match
      // in either — an intact history rides the delta append and adopts
      // this plan's mode there; a mode change alone must never force the
      // O(total) epoch rewrite.
      frozenIntact = await this.frozenChainMatchesCursor(cursor, preparedPlan);
    }

    if (!frozenIntact) {
      // An epoch rewrite re-uploads the ENTIRE frozen history. It is the
      // expensive path, so name the condition that forced it: a silent
      // rewrite loop is indistinguishable from steady state in the ledger.
      log.info(
        `epoch rewrite for ${sessionId} org ${orgId}: ` +
          `confirmedShrink=${confirmedShrink} ` +
          `frozen=${frozenEventCount} cursorFrozen=${cursor.frozenEventCount} ` +
          `chainMismatch=${
            !confirmedShrink && frozenEventCount >= cursor.frozenEventCount
          }`
      );
    }

    if (frozenIntact) {
      await this.appendIntactFrozenHistory(pass, cursor);
      return;
    }

    await this.rewriteSession(auth, orgId, session, scopeKey, access, {
      events,
      perEventHashes,
      frozenHashMode,
      totalEventCount,
      frozenEventCount,
      localFrozenEventCount,
      frozenChainHash,
      tailEvents,
      tailHash,
      importedReplay,
      newEpoch: cursor.epoch + 1,
    });
    markPreparedClean();
    publishPreparedTurnIndex();
  }

  /**
   * Intact frozen history: converge an unchanged read locally, otherwise
   * append the frozen delta in batches (a conflict re-anchors via rewrite).
   */
  private async appendIntactFrozenHistory(
    pass: PreparedPushPass,
    cursor: CollabSessionPushCursor
  ): Promise<void> {
    const { auth, orgId, session, scopeKey, access } = pass;
    const { markPreparedClean, publishPreparedTurnIndex } = pass;
    const sessionId = session.session_id;
    const { events } = pass.prepared;
    const {
      perEventHashes,
      frozenHashMode,
      totalEventCount,
      frozenEventCount,
      localFrozenEventCount,
      tailEvents,
      tailHash,
      frozenChainHash,
      importedReplay,
    } = pass.preparedPlan;
    const newFrozenEvents = events.slice(
      cursor.frozenEventCount,
      frozenEventCount
    );
    if (
      newFrozenEvents.length === 0 &&
      tailHash === cursor.tailHash &&
      totalEventCount === cursor.pushedCount
    ) {
      await this.upsertMetadataIfChanged(
        auth,
        orgId,
        session,
        scopeKey,
        access
      );
      if (importedReplay && frozenChainHash !== cursor.frozenChainHash) {
        // Same content in an upgraded hash mode: converge the local
        // cursor (a checkpoint plus its merkle commitment) so the next
        // delta takes the bounded path — no network write is needed.
        // The downgrade direction deliberately keeps the cursor: a
        // still-valid checkpoint must survive a transiently failed probe.
        this.setCursor({ ...cursor, frozenChainHash, importedReplay });
      }
      markPreparedClean();
      return;
    }
    await this.upsertMetadataIfChanged(auth, orgId, session, scopeKey, access);
    const frozenSegments = splitFrozenIntoSegments(
      newFrozenEvents,
      cursor.frozenSeq + 1
    );
    try {
      await this.appendSessionBatches(
        auth,
        orgId,
        sessionId,
        cursor,
        frozenSegments,
        {
          events,
          perEventHashes,
          frozenHashMode,
          totalEventCount,
          frozenEventCount,
          localFrozenEventCount,
          frozenChainHash,
          tailEvents,
          tailHash,
          importedReplay,
        }
      );
      broadcastOrgControlChangedToPeers(orgId, "sessions");
      markPreparedClean();
      publishPreparedTurnIndex();
      return;
    } catch (error) {
      if (!isOrg2SyncErrorCode(error, "ORG2_CONFLICT")) throw error;
      await this.rewriteSession(auth, orgId, session, scopeKey, access, {
        events,
        perEventHashes,
        frozenHashMode,
        totalEventCount,
        frozenEventCount,
        localFrozenEventCount,
        frozenChainHash,
        tailEvents,
        tailHash,
        importedReplay,
        newEpoch: null,
      });
      markPreparedClean();
      publishPreparedTurnIndex();
      return;
    }
  }

  /** No cursor yet: publish the complete replay as epoch 1. */
  protected async pushInitialReplay(pass: PreparedPushPass): Promise<void> {
    const { auth, orgId, session, scopeKey, access } = pass;
    const { markPreparedClean, publishPreparedTurnIndex } = pass;
    const { events } = pass.prepared;
    const {
      perEventHashes,
      frozenHashMode,
      totalEventCount,
      frozenEventCount,
      localFrozenEventCount,
      tailEvents,
      tailHash,
      frozenChainHash,
      importedReplay,
    } = pass.preparedPlan;
    await this.rewriteSession(auth, orgId, session, scopeKey, access, {
      events,
      perEventHashes,
      frozenHashMode,
      totalEventCount,
      frozenEventCount,
      localFrozenEventCount,
      frozenChainHash,
      tailEvents,
      tailHash,
      importedReplay,
      newEpoch: 1,
    });
    markPreparedClean();
    publishPreparedTurnIndex();
  }
}

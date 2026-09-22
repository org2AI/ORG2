/**
 * Org2CloudSyncEngine — vanished-session GC sweep (per org).
 *
 * Retracts cloud rows THIS device push-marked whose sessions no longer
 * resolve anywhere locally, plus continuation-superseded siblings whose
 * lineage winner is itself live on the org. Holds the per-org sweep
 * throttle, the two-strike confirmation counters and the self-owned remote
 * id cache the push loop shares with it. The suspect-finding helpers live in
 * `org2CloudSyncEngine.vanishedSessions.ts`; this module owns the engine-side
 * bookkeeping around them.
 */
import { createLogger } from "@src/hooks/logger";
import { sessionsAtom } from "@src/store/session/sessionAtom/atoms";

import type { Org2CloudAuthState } from "./org2CloudAuthAtom";
import type { Org2CloudSessionSync } from "./org2CloudSessionSync";
import {
  VANISHED_SESSION_RETRACT_CONFIRMATIONS,
  VANISHED_SESSION_SWEEP_INTERVAL_MS,
} from "./org2CloudSyncEngine.constants";
import {
  type Org2CloudOrgBackoffTracker,
  isCloudSyncBackoffError,
} from "./org2CloudSyncEngine.orgBackoff";
import {
  type ContinuationStatusResolver,
  type LocalSessionIdResolver,
  type SupersededPushedSession,
  continuationLiveSessionIds,
  findSupersededPushedSessions,
  findSupersededSelfOwnedRemoteSessions,
  findVanishedPushedSessionIds,
} from "./org2CloudSyncEngine.vanishedSessions";
import type { CloudStore } from "./org2CloudSyncLifecycle";

const log = createLogger("Org2CloudSyncEngine");

export class Org2CloudVanishedSweep {
  /** Per-org timestamp of the last vanished-session GC sweep. */
  private readonly lastVanishedSweepAtMs = new Map<string, number>();

  /** Self-owned live remote session ids per org, captured from the
   * cold-start listing so the ghost sweep can reuse it instead of paying a
   * second listing for orgs the push loop already covered. Retracted ids
   * are removed in place so a stale entry cannot re-suspect forever. */
  private readonly selfOwnedRemoteIdsByOrg = new Map<string, Set<string>>();
  /** `${orgId}:${sessionId}` → consecutive sweeps confirmed absent. A
   * suspect retracts only at VANISHED_SESSION_RETRACT_CONFIRMATIONS, so one
   * empty lookup during a cache rebuild cannot mass-retract live rows. */
  private readonly vanishedStrikes = new Map<string, number>();
  /** Same two-strike discipline for superseded-continuation retracts. */
  private readonly supersededStrikes = new Map<string, number>();

  constructor(
    private readonly getStore: () => CloudStore | null,
    private readonly sessionSync: Org2CloudSessionSync,
    private readonly orgBackoff: Org2CloudOrgBackoffTracker,
    /** Confirms vanished-session suspects against every local store; a
     * constructor seam so engine tests can fake local resolution. */
    private readonly resolveLocalSessionIds: LocalSessionIdResolver,
    /** Continuation status of push-marked suspects; same seam pattern. */
    private readonly resolveContinuationStatuses: ContinuationStatusResolver
  ) {}

  reset(): void {
    this.lastVanishedSweepAtMs.clear();
    this.vanishedStrikes.clear();
    this.selfOwnedRemoteIdsByOrg.clear();
  }

  prune(currentOrgIds: ReadonlySet<string>): void {
    for (const orgId of this.lastVanishedSweepAtMs.keys()) {
      if (!currentOrgIds.has(orgId)) this.lastVanishedSweepAtMs.delete(orgId);
    }
    for (const orgId of this.selfOwnedRemoteIdsByOrg.keys()) {
      if (!currentOrgIds.has(orgId)) {
        this.selfOwnedRemoteIdsByOrg.delete(orgId);
      }
    }
    for (const key of this.vanishedStrikes.keys()) {
      const orgId = key.slice(0, key.indexOf(":"));
      if (!currentOrgIds.has(orgId)) this.vanishedStrikes.delete(key);
    }
  }

  /** Record the cold-start listing's self-owned live ids for one org. */
  recordSelfOwnedRemoteIds(orgId: string, sessionIds: Iterable<string>): void {
    this.selfOwnedRemoteIdsByOrg.set(orgId, new Set(sessionIds));
  }

  /**
   * Vanished-session GC for one org: retract cloud rows THIS device
   * push-marked whose sessions no longer resolve anywhere locally.
   *
   * TTL-throttled: the suspect set is dominated by marked sessions that
   * merely fell out of the paginated roster, and each sweep costs one
   * confirming backend lookup — not worth paying every 60s pass for a rare
   * condition. Marked-but-resolvable ids are left alone; markers clear on
   * successful retraction, so a healthy steady state has no suspects.
   */
  async retractVanishedSessions(
    fresh: Org2CloudAuthState,
    orgId: string,
    generation: number,
    isCurrentGeneration: (generation: number) => boolean
  ): Promise<void> {
    const store = this.getStore();
    if (!store) return;
    if (this.orgBackoff.isOrgBackedOff(orgId)) return;
    const now = Date.now();
    const lastSweepAt = this.lastVanishedSweepAtMs.get(orgId) ?? 0;
    if (now - lastSweepAt < VANISHED_SESSION_SWEEP_INTERVAL_MS) return;
    this.lastVanishedSweepAtMs.set(orgId, now);

    const markedSessionIds = this.sessionSync.markedSessionIds(orgId);
    const liveSessions = store.get(sessionsAtom);
    const liveSessionIds = new Set(
      liveSessions.map((session) => session.session_id)
    );
    const vanishedIds = await findVanishedPushedSessionIds({
      orgId,
      markedSessionIds,
      liveSessionIds,
      resolveSessionIds: this.resolveLocalSessionIds,
    });
    if (!isCurrentGeneration(generation)) return;
    const confirmedAbsent = new Set(vanishedIds);
    for (const key of this.vanishedStrikes.keys()) {
      if (!key.startsWith(`${orgId}:`)) continue;
      if (!confirmedAbsent.has(key.slice(orgId.length + 1))) {
        this.vanishedStrikes.delete(key);
      }
    }
    for (const sessionId of vanishedIds) {
      if (!isCurrentGeneration(generation)) return;
      const strikeKey = `${orgId}:${sessionId}`;
      const strikes = (this.vanishedStrikes.get(strikeKey) ?? 0) + 1;
      if (strikes < VANISHED_SESSION_RETRACT_CONFIRMATIONS) {
        this.vanishedStrikes.set(strikeKey, strikes);
        log.info(
          `vanished-session suspect ${sessionId} org ${orgId} confirmed ` +
            `absent (${strikes}/${VANISHED_SESSION_RETRACT_CONFIRMATIONS}); ` +
            `deferring retract to the next sweep`
        );
        continue;
      }
      try {
        log.info(
          `cloud retract [vanished locally]: session ${sessionId} org ${orgId}`
        );
        await this.sessionSync.retractSession(fresh, orgId, sessionId);
        this.vanishedStrikes.delete(strikeKey);
        this.selfOwnedRemoteIdsByOrg.get(orgId)?.delete(sessionId);
      } catch (error) {
        if (!isCurrentGeneration(generation)) return;
        if (isCloudSyncBackoffError(error)) {
          this.orgBackoff.backOffOrg(orgId, error);
          return;
        }
        // Markers survive a failed retract, so the next sweep retries.
        log.warn(
          `cloud retract failed for vanished session ${sessionId}:`,
          error
        );
      }
    }

    // Continuation-superseded reconcile: a compaction demotes the old
    // sibling out of the roster while its Team Sessions row lingers as a
    // stale duplicate of the family. Retract it ONLY when the family's
    // listable winner is itself replay-pushed to this org — the conversation
    // stays represented by exactly one live row. NOTE the deliberate content
    // tradeoff: the demoted row is the only cloud replay of the pre-compact
    // detail; the winner carries the compacted continuation. The source
    // transcript stays on the owner's disk and can always be re-shared.
    // A demoted sibling can still sit in the roster (union merge, persisted
    // rehydrate); judge it by lineage rather than by mere presence.
    const continuationLiveIds = continuationLiveSessionIds(liveSessions);
    const superseded = await findSupersededPushedSessions({
      orgId,
      markedSessionIds,
      liveSessionIds: continuationLiveIds,
      resolveStatuses: this.resolveContinuationStatuses,
    });
    if (!isCurrentGeneration(generation)) return;
    // Marker-free arm: judge the server's own list of this account's rows,
    // so ghosts survive neither a clobbered marker map nor a same-account
    // second device. The cold-start listing is reused when the push loop
    // already fetched it; only never-targeted orgs pay their own listing.
    // Listing failure = unknown; the arm just sits out.
    let remoteSelfIds: Set<string> | null =
      this.selfOwnedRemoteIdsByOrg.get(orgId) ?? null;
    if (!remoteSelfIds) {
      try {
        remoteSelfIds = new Set(
          await this.sessionSync.listSelfOwnedLiveRemoteSessionIds(fresh, orgId)
        );
        this.selfOwnedRemoteIdsByOrg.set(orgId, remoteSelfIds);
      } catch (error) {
        if (!isCurrentGeneration(generation)) return;
        if (isCloudSyncBackoffError(error)) {
          this.orgBackoff.backOffOrg(orgId, error);
          return;
        }
        log.warn(`self-owned remote listing failed for org ${orgId}:`, error);
      }
    }
    if (!isCurrentGeneration(generation)) return;
    let remoteSuperseded: SupersededPushedSession[] = [];
    if (remoteSelfIds) {
      remoteSuperseded = await findSupersededSelfOwnedRemoteSessions({
        orgId,
        remoteSelfSessionIds: [...remoteSelfIds].filter(
          (sessionId) => !markedSessionIds.has(sessionId)
        ),
        liveSessionIds: continuationLiveIds,
        resolveStatuses: this.resolveContinuationStatuses,
      });
      if (!isCurrentGeneration(generation)) return;
    }
    const allSuperseded = [...superseded, ...remoteSuperseded];
    const supersededNow = new Set(
      allSuperseded.map((entry) => entry.sessionId)
    );
    for (const key of this.supersededStrikes.keys()) {
      if (!key.startsWith(`${orgId}:`)) continue;
      if (!supersededNow.has(key.slice(orgId.length + 1))) {
        this.supersededStrikes.delete(key);
      }
    }
    for (const { sessionId, lineageId } of allSuperseded) {
      if (!isCurrentGeneration(generation)) return;
      const winner = liveSessions.find(
        (session) =>
          session.session_id !== sessionId &&
          session.continuationLineageId === lineageId &&
          (this.sessionSync.hasReplayPushed(orgId, session.session_id) ||
            remoteSelfIds?.has(session.session_id) === true)
      );
      if (!winner) {
        log.info(
          `superseded continuation ${sessionId} org ${orgId} kept: no ` +
            `replay-pushed winner for lineage ${lineageId} on this device yet`
        );
        continue;
      }
      const strikeKey = `${orgId}:${sessionId}`;
      const strikes = (this.supersededStrikes.get(strikeKey) ?? 0) + 1;
      if (strikes < VANISHED_SESSION_RETRACT_CONFIRMATIONS) {
        this.supersededStrikes.set(strikeKey, strikes);
        log.info(
          `superseded-continuation suspect ${sessionId} org ${orgId} ` +
            `(winner ${winner.session_id}, ` +
            `${strikes}/${VANISHED_SESSION_RETRACT_CONFIRMATIONS}); ` +
            `deferring retract to the next sweep`
        );
        continue;
      }
      try {
        log.info(
          `cloud retract [superseded continuation]: session ${sessionId} ` +
            `org ${orgId} (winner ${winner.session_id})`
        );
        await this.sessionSync.retractSession(fresh, orgId, sessionId);
        this.supersededStrikes.delete(strikeKey);
        this.selfOwnedRemoteIdsByOrg.get(orgId)?.delete(sessionId);
      } catch (error) {
        if (!isCurrentGeneration(generation)) return;
        if (isCloudSyncBackoffError(error)) {
          this.orgBackoff.backOffOrg(orgId, error);
          return;
        }
        log.warn(
          `cloud retract failed for superseded continuation ${sessionId}:`,
          error
        );
      }
    }
  }
}

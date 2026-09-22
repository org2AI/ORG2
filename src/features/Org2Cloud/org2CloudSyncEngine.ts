/**
 * Org2CloudSyncEngine — managed-cloud session PUSH (Phase 6 v1).
 *
 * Deliberately SMALL next to the self-hosted `CollabSyncEngine`: one
 * serialized sync pass over (cloud org × local session), happy-path push +
 * OCC conflict re-anchor + quota/disabled backoff. No pull-merge of remote
 * metadata into local stores yet (the panel lists teammates' sessions
 * directly via `listOrgSessions`).
 *
 * Per pass, the session plane visits the actively viewed org plus every org
 * whose admin enabled background upload. For each visited org that has
 * locally-stored repo scopes (`org2CloudRepoScopesAtom`) and sync not disabled
 * (`org2CloudSyncEnabledAtom`), every OWN local session whose resolved repo
 * scope key matches a scope is a push CANDIDATE. Whether a candidate is
 * actually uploaded — and at what level — is decided by the per-session
 * access ladder (`org2CloudAccessSettingsAtom`, design §13.4):
 * repo-scope matching SELECTS candidates, while the org minimum plus any
 * per-session override GATE the upload (effective 'off' ⇒ skipped entirely,
 * 'metadata_only' ⇒ metadata upsert only, 'full_replay' ⇒ metadata +
 * segments). A candidate that passes the ladder is pushed:
 *
 * 1. metadata upsert (`toRemoteMetadata` shape, hash-gated per pass), then
 * 2. incremental segments push mirroring the collab engine's epoch /
 *    frozen-line / tail bookkeeping — the persisted cursor is the SAME
 *    `CollabSessionPushCursor` shape (`org2CloudPushCursorsAtom`).
 *
 * ORG2_CONFLICT → re-anchor via epoch-bumped rewrite (server epoch read
 * through `getSessionEvents`). ORG2_QUOTA_EXCEEDED / ORG2_SYNC_DISABLED →
 * bounded per-org backoff. Only the actively viewed org surfaces a warning;
 * inactive orgs use a longer event-triggered cooldown.
 *
 * Projects/work-items (cloud-parity Phase B): after the session push, every
 * org drives the SAME `ProjectSyncChannel` + Rust bridge as the self-hosted
 * engine, backed by the cloud RPC adapter (`org2CloudProjectsClient`). The
 * pulled state comes from `cloud_list_org_collab_state` behind a persisted
 * per-org cursor (`org2CloudCollabStateCursorsAtom`, serverTime − 2s
 * overlap), bypassed for a COMPLETE listing only for the ACTIVE org on
 * start/reconnect/roster recovery — a row that leaves the visible set
 * without a tombstone can only be proven absent against the full state, and
 * background orgs get that authoritative listing when next activated (the
 * SUBSCRIBED edge forces it). Work items are org-wide: no repo-scope
 * selection.
 *
 * Scheduling is event-driven: start/roster changes, local EventStore writes,
 * the durable project outbox event, Realtime invalidations, reconnect,
 * visibility regain, and explicit user actions. There is no recurring cloud
 * pass. Debounce and bounded retry timers only coalesce or recover concrete
 * events; they never poll for new work.
 *
 * This file is the thin orchestration shell — lifecycle wiring plus the
 * collaborators one pass needs. The pass loop itself lives in
 * `org2CloudSyncEngine.syncPass.ts` (per-org session push in
 * `.sessionPushPass.ts`, projects plane in `.projectsPass.ts`, vanished /
 * superseded GC in `.vanishedSweep.ts`). Cohesive sub-concerns are split
 * into co-located composed helpers (mirroring the existing
 * `Org2CloudSessionSync` composition): `org2CloudSyncEngine.schemaGate.ts`,
 * `.orgBackoff.ts`, `.repoScopeSync.ts`, `.sessionColdStart.ts`,
 * `.projectsChannel.ts`, `.constants.ts`.
 */
import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import { sessionsAtom } from "@src/store/session/sessionAtom/atoms";
import type { Session } from "@src/store/session/sessionAtom/types";
import { chatPanelSelectedCloudOrgAtom } from "@src/store/ui/chatPanel/selectionAtoms";

import type { ProjectSyncBridge } from "../TeamCollaboration/engine/projectSyncBridge";
import { tauriProjectSyncBridge } from "../TeamCollaboration/engine/projectSyncBridge";
import { subscribeShareableScopeKeys } from "../TeamCollaboration/repoScopeResolver";
import {
  org2CloudAuthAtom,
  org2CloudAuthIdentityKey,
} from "./org2CloudAuthAtom";
import { schemaVersion } from "./org2CloudClient";
import { sidebarActiveCloudOrgIdAtom } from "./org2CloudOrgsAtom";
import type { Org2CloudOrg } from "./org2CloudOrgsAtom";
import * as org2CloudProjectsClient from "./org2CloudProjectsClient";
import {
  Org2CloudSessionSync,
  type Org2CloudSyncClientDeps,
} from "./org2CloudSessionSync";
import { org2CloudRetentionParkedAtom } from "./org2CloudSyncAtoms";
import * as org2CloudSyncClient from "./org2CloudSyncClient";
import { Org2CloudExternalHistoryRoster } from "./org2CloudSyncEngine.externalHistoryRoster";
import { Org2CloudOrgBackoffTracker } from "./org2CloudSyncEngine.orgBackoff";
import {
  Org2CloudProjectsChannel,
  type Org2CloudProjectsClientDeps,
} from "./org2CloudSyncEngine.projectsChannel";
import { Org2CloudRepoScopeSync } from "./org2CloudSyncEngine.repoScopeSync";
import {
  Org2CloudSchemaGate,
  type Org2CloudSchemaVersionProbe,
} from "./org2CloudSyncEngine.schemaGate";
import { Org2CloudSessionColdStart } from "./org2CloudSyncEngine.sessionColdStart";
import {
  type PendingPassRequests,
  type SyncPassHost,
  runSyncPass,
} from "./org2CloudSyncEngine.syncPass";
import {
  type ContinuationStatusResolver,
  type LocalSessionIdResolver,
  resolveContinuationStatusesViaCache,
  resolveLocalSessionIdsViaAggregateList,
} from "./org2CloudSyncEngine.vanishedSessions";
import { Org2CloudVanishedSweep } from "./org2CloudSyncEngine.vanishedSweep";
import {
  type CloudStore,
  Org2CloudSyncLifecycle,
} from "./org2CloudSyncLifecycle";

export {
  DATA_CHANGED_DEBOUNCE_MS,
  EXTERNAL_HISTORY_ACTIVITY_DEBOUNCE_MS,
  PROJECT_PUSH_RETRY_DELAY_MS,
} from "./org2CloudSyncLifecycle";
export {
  buildCloudSessionMetadata,
  isCloudPushCandidate,
} from "./org2CloudSessionSync";
export type { Org2CloudSyncClientDeps } from "./org2CloudSessionSync";
export {
  COLLAB_LISTING_SHARE_WINDOW_MS,
  ORG_BACKOFF_COOLDOWN_MS,
  INACTIVE_ORG_BACKOFF_COOLDOWN_MS,
} from "./org2CloudSyncEngine.constants";
export type { Org2CloudProjectsClientDeps } from "./org2CloudSyncEngine.projectsChannel";
export type { Org2CloudSchemaVersionProbe } from "./org2CloudSyncEngine.schemaGate";

const SCOPE_RESOLUTION_DEBOUNCE_MS = 1_000;
export class Org2CloudSyncEngine extends Org2CloudSyncLifecycle {
  /** Imported-history roster activity capture, split out to
   * `Org2CloudExternalHistoryRoster`. */
  private readonly externalHistoryRoster = new Org2CloudExternalHistoryRoster();
  private retentionIdentityKey: string | null = null;
  private sessionRosterUnsubscribe: (() => void) | null = null;
  private scopeResolutionUnsubscribe: (() => void) | null = null;
  private scopeResolutionTimer: ReturnType<typeof setTimeout> | null = null;
  /** Per-org entitlement backoff deadlines + notification state, split out
   * to `Org2CloudOrgBackoffTracker` — see that module for the per-map
   * rationale (kept together there since a policy signal touches more than
   * one at once). */
  private readonly orgBackoff: Org2CloudOrgBackoffTracker;
  /** Generation whose background-org retract reconcile already ran (P2). */
  private reconciledGeneration = -1;
  /** TTL-gated `org2CloudRepoScopesAtom` mirror hydration, split out to
   * `Org2CloudRepoScopeSync`. */
  private readonly repoScopeSync: Org2CloudRepoScopeSync;
  /** Project-org alias + collab-state channel bookkeeping (cloud-parity
   * Phase B), split out to `Org2CloudProjectsChannel`. */
  private readonly projectsChannel: Org2CloudProjectsChannel;
  /** Owner-session summary cold-start cache, split out to
   * `Org2CloudSessionColdStart`. */
  private readonly sessionColdStart: Org2CloudSessionColdStart;
  /** Custom-endpoint schema gate (Phase C), split out to
   * `Org2CloudSchemaGate` — see that module for the per-URL verdict
   * caching rationale. */
  private readonly schemaGate: Org2CloudSchemaGate;
  /** Vanished / superseded-continuation GC sweep state (throttle, strike
   * counters, self-owned remote id cache), split out to
   * `Org2CloudVanishedSweep`. */
  private readonly vanishedSweep: Org2CloudVanishedSweep;

  private readonly client: Org2CloudSyncClientDeps;
  private readonly projectsClient: Org2CloudProjectsClientDeps;
  private readonly projectSyncBridge: ProjectSyncBridge;
  private readonly sessionSync: Org2CloudSessionSync;

  constructor(
    client: Org2CloudSyncClientDeps = org2CloudSyncClient,
    projectsClient: Org2CloudProjectsClientDeps = org2CloudProjectsClient,
    projectSyncBridge: ProjectSyncBridge = tauriProjectSyncBridge,
    probeSchemaVersion: Org2CloudSchemaVersionProbe = schemaVersion,
    resolveLocalSessionIds: LocalSessionIdResolver = resolveLocalSessionIdsViaAggregateList,
    resolveContinuationStatuses: ContinuationStatusResolver = resolveContinuationStatusesViaCache
  ) {
    super();
    this.client = client;
    this.projectsClient = projectsClient;
    this.projectSyncBridge = projectSyncBridge;
    this.sessionSync = new Org2CloudSessionSync(() => this.store, client);
    this.orgBackoff = new Org2CloudOrgBackoffTracker((orgId) =>
      this.isActiveOrg(orgId)
    );
    this.repoScopeSync = new Org2CloudRepoScopeSync(() => this.store, client);
    this.projectsChannel = new Org2CloudProjectsChannel(
      () => this.store,
      projectsClient,
      projectSyncBridge
    );
    this.sessionColdStart = new Org2CloudSessionColdStart(client);
    this.schemaGate = new Org2CloudSchemaGate(probeSchemaVersion);
    this.vanishedSweep = new Org2CloudVanishedSweep(
      () => this.store,
      this.sessionSync,
      this.orgBackoff,
      resolveLocalSessionIds,
      resolveContinuationStatuses
    );
  }

  override start(store: CloudStore): void {
    if (this.sessionRosterUnsubscribe) return;
    const auth = store.get(org2CloudAuthAtom);
    this.retentionIdentityKey = auth ? org2CloudAuthIdentityKey(auth) : null;
    super.start(store);
    this.captureExternalHistoryRosterActivity(store);
    this.sessionRosterUnsubscribe = store.sub(sessionsAtom, () => {
      this.captureExternalHistoryRosterActivity(store);
    });
    this.scopeResolutionUnsubscribe = subscribeShareableScopeKeys(() => {
      if (this.scopeResolutionTimer !== null) return;
      this.scopeResolutionTimer = setTimeout(() => {
        this.scopeResolutionTimer = null;
        void this.runSyncPass({ pushSessions: true });
      }, SCOPE_RESOLUTION_DEBOUNCE_MS);
    });
  }

  override stop(): void {
    this.sessionRosterUnsubscribe?.();
    this.sessionRosterUnsubscribe = null;
    this.scopeResolutionUnsubscribe?.();
    this.scopeResolutionUnsubscribe = null;
    if (this.scopeResolutionTimer !== null) {
      clearTimeout(this.scopeResolutionTimer);
    }
    this.scopeResolutionTimer = null;
    this.externalHistoryRoster.reset();
    super.stop();
  }

  private captureExternalHistoryRosterActivity(store: CloudStore): void {
    this.externalHistoryRoster.capture(store, {
      noteSessionEventActivity: (sessionId) =>
        this.noteSessionEventActivity(sessionId),
      scheduleActivityPass: (sessionId) => this.scheduleActivityPass(sessionId),
    });
  }

  protected override resetSyncState(): void {
    // Startup/router remount can restart this singleton under the SAME auth
    // identity. Only a real sign-out/account/endpoint transition invalidates
    // durable parks; treating every stop as sign-out defeats cold-boot parking.
    const auth = this.store?.get(org2CloudAuthAtom);
    const currentIdentity = auth ? org2CloudAuthIdentityKey(auth) : null;
    if (!currentIdentity || currentIdentity !== this.retentionIdentityKey) {
      this.store?.set(org2CloudRetentionParkedAtom, {});
    }
    this.retentionIdentityKey = null;
    this.orgBackoff.reset();
    this.sessionSync.reset();
    this.repoScopeSync.reset();
    this.projectsChannel.reset();
    this.sessionColdStart.reset();
    this.schemaGate.reset();
    this.vanishedSweep.reset();
  }

  protected override clearAllOrgBackoffs(): void {
    // Same underlying bookkeeping resetSyncState() clears — this call site
    // is a mid-session invalidation, not a full engine reset.
    this.orgBackoff.reset();
  }

  protected override invalidateFullInboundState(orgId?: string): void {
    this.repoScopeSync.invalidate(orgId);
  }

  protected override noteSessionEventActivity(sessionId: string): void {
    this.sessionSync.noteSessionEventActivity(sessionId);
  }

  protected override afterSyncPass(): void {
    this.sessionSync.endPass();
  }

  protected override async syncAllOrgs(
    generation: number,
    options: { pushSessions: boolean }
  ): Promise<void> {
    if (options.pushSessions) this.sessionSync.beginPass();
    await runSyncPass(this.passHost(), generation, options);
  }

  /** Collaborators + lifecycle hooks one pass consumes; built per pass so
   * `store` reflects the engine's current mount. */
  private passHost(): SyncPassHost {
    return {
      store: this.store,
      sessionSync: this.sessionSync,
      orgBackoff: this.orgBackoff,
      repoScopeSync: this.repoScopeSync,
      projectsChannel: this.projectsChannel,
      sessionColdStart: this.sessionColdStart,
      schemaGate: this.schemaGate,
      vanishedSweep: this.vanishedSweep,
      isCurrentGeneration: (gen) => this.generation === gen,
      isActiveOrg: (orgId) => this.isActiveOrg(orgId),
      scheduleProjectPushRetry: () => this.scheduleProjectPushRetry(),
      pruneRemovedOrgState: (orgs, sessions) =>
        this.pruneRemovedOrgState(orgs, sessions),
      takePendingPassRequests: () => this.takePendingPassRequests(),
      claimBackgroundReconcile: (gen) => this.claimBackgroundReconcile(gen),
    };
  }

  /** Consume requests only after auth/schema/outbound setup succeeds; an
   * offline or mismatched backend must leave them pending for the next pass. */
  private takePendingPassRequests(): PendingPassRequests {
    const requestedInboundOrgIds = new Set(this.pendingInboundOrgIds);
    this.pendingInboundOrgIds.clear();
    const requestedFullInboundOrgIds = new Set(this.pendingFullInboundOrgIds);
    this.pendingFullInboundOrgIds.clear();
    const forceAllInbound = this.forceAllInboundNextPass;
    this.forceAllInboundNextPass = false;
    const pushProjects = this.forceProjectsNextPass;
    this.forceProjectsNextPass = false;
    return {
      requestedInboundOrgIds,
      requestedFullInboundOrgIds,
      forceAllInbound,
      pushProjects,
    };
  }

  /** P2 background reconcile runs once per engine run (generation). */
  private claimBackgroundReconcile(generation: number): boolean {
    if (this.reconciledGeneration === generation) return false;
    this.reconciledGeneration = generation;
    return true;
  }

  protected override clearOrgBackoff(orgId: string): void {
    this.orgBackoff.clearOrgBackoff(orgId);
  }

  /** The engine singleton outlives individual memberships. Keep every
   * app-lifetime org/session cache bounded by the authoritative live roster
   * and current local session list. */
  private pruneRemovedOrgState(
    orgs: readonly Org2CloudOrg[],
    sessions: readonly Session[]
  ): void {
    const currentOrgIds = new Set(orgs.map((org) => org.orgId));
    this.orgBackoff.prune(currentOrgIds);
    this.repoScopeSync.prune(currentOrgIds);
    this.projectsChannel.prune(currentOrgIds);
    this.sessionColdStart.prune(currentOrgIds);
    this.vanishedSweep.prune(currentOrgIds);
    for (const orgId of this.pendingInboundOrgIds) {
      if (!currentOrgIds.has(orgId)) this.pendingInboundOrgIds.delete(orgId);
    }
    for (const orgId of this.pendingFullInboundOrgIds) {
      if (!currentOrgIds.has(orgId)) {
        this.pendingFullInboundOrgIds.delete(orgId);
      }
    }
    this.sessionSync.prune(
      currentOrgIds,
      new Set(sessions.map((session) => session.session_id))
    );
  }

  /** Match the Realtime demand rule: an open management surface is the
   * strongest visible-org signal, otherwise the sidebar scope is active. */
  private isActiveOrg(orgId: string): boolean {
    const store = this.store;
    if (!store) return false;
    const managementOrgId = store.get(chatPanelSelectedCloudOrgAtom)?.orgId;
    return (
      (managementOrgId ?? store.get(sidebarActiveCloudOrgIdAtom)) === orgId
    );
  }

  /** Force the next pass to re-upsert one session's metadata row. */
  invalidatePushedMetadataHash(orgId: string, sessionId: string): void {
    this.sessionSync.invalidatePushedMetadataHash(orgId, sessionId);
  }

  /** Retained private test seam; the session module owns the implementation. */
  private loadPushEvents(sessionId: string): Promise<SessionEvent[]> {
    return this.sessionSync.loadPushEvents(sessionId);
  }
}

/** Module singleton — mounted once via `useOrg2CloudSyncEngine`. */
export const org2CloudSyncEngine = new Org2CloudSyncEngine();

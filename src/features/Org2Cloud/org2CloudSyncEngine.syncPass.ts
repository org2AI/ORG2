/**
 * Org2CloudSyncEngine — one serialized sync pass over (cloud org × local
 * session), split out of the engine class so the class stays the wiring
 * shell. Reads top to bottom in pass order:
 *
 * 1. roster prune + project-org aliases + schema gate,
 * 2. token refresh anchored to the pass-start endpoint identity,
 * 3. org endpoint directory + session push target selection,
 * 4. per-org session push (`org2CloudSyncEngine.sessionPushPass.ts`) and
 *    the vanished-session sweep over every push-marked org,
 * 5. projects / work-items plane (`org2CloudSyncEngine.projectsPass.ts`),
 * 6. P2 retract-only reconcile for background orgs
 *    (`org2CloudSyncEngine.retractReconcile.ts`).
 *
 * The engine hands in a `SyncPassHost` — its collaborators plus the few
 * lifecycle hooks the pass consumes (generation check, inbound latches,
 * the once-per-run reconcile claim).
 */
import { createLogger } from "@src/hooks/logger";
import { sessionsAtom } from "@src/store/session/sessionAtom/atoms";
import type { Session } from "@src/store/session/sessionAtom/types";

import {
  sessionOrgTagsAtom,
  taggedCloudOrgIds,
} from "../TeamCollaboration/sessionOrgTagsAtom";
import { getCloudEndpoint } from "./config";
import {
  org2CloudAccessSettingsAtom,
  org2CloudSharingFloorAtom,
} from "./org2CloudAccessSettings";
import { commitRefreshedAuth, org2CloudAuthAtom } from "./org2CloudAuthAtom";
import { ensureFreshSession } from "./org2CloudClient";
import { resolveOrgEndpoint } from "./org2CloudEndpointDirectory";
import { setOrgEndpointDirectory } from "./org2CloudOrgEndpointRouter";
import {
  isOrgBackgroundUploadEnabled,
  org2CloudOrgsAtom,
} from "./org2CloudOrgsAtom";
import type { Org2CloudOrg } from "./org2CloudOrgsAtom";
import type { Org2CloudSessionSync } from "./org2CloudSessionSync";
import {
  org2CloudPushCursorsAtom,
  org2CloudPushedMetadataAtom,
  org2CloudRepoScopesAtom,
  org2CloudSyncEnabledAtom,
} from "./org2CloudSyncAtoms";
import type { Org2CloudOrgBackoffTracker } from "./org2CloudSyncEngine.orgBackoff";
import type { Org2CloudProjectsChannel } from "./org2CloudSyncEngine.projectsChannel";
import { syncProjectsPlane } from "./org2CloudSyncEngine.projectsPass";
import type { Org2CloudRepoScopeSync } from "./org2CloudSyncEngine.repoScopeSync";
import {
  orgsWithLocalPushMarkers,
  reconcileOrgRetracts,
} from "./org2CloudSyncEngine.retractReconcile";
import type { Org2CloudSchemaGate } from "./org2CloudSyncEngine.schemaGate";
import type { Org2CloudSessionColdStart } from "./org2CloudSyncEngine.sessionColdStart";
import { pushOrgSessions } from "./org2CloudSyncEngine.sessionPushPass";
import type { Org2CloudVanishedSweep } from "./org2CloudSyncEngine.vanishedSweep";
import type { CloudStore } from "./org2CloudSyncLifecycle";

const log = createLogger("Org2CloudSyncEngine");

/** Inbound/project requests drained from the lifecycle latches per pass. */
export interface PendingPassRequests {
  requestedInboundOrgIds: Set<string>;
  requestedFullInboundOrgIds: Set<string>;
  forceAllInbound: boolean;
  pushProjects: boolean;
}

/** What one sync pass needs from the engine that owns it. */
export interface SyncPassHost {
  readonly store: CloudStore | null;
  readonly sessionSync: Org2CloudSessionSync;
  readonly orgBackoff: Org2CloudOrgBackoffTracker;
  readonly repoScopeSync: Org2CloudRepoScopeSync;
  readonly projectsChannel: Org2CloudProjectsChannel;
  readonly sessionColdStart: Org2CloudSessionColdStart;
  readonly schemaGate: Org2CloudSchemaGate;
  readonly vanishedSweep: Org2CloudVanishedSweep;
  isCurrentGeneration: (generation: number) => boolean;
  isActiveOrg: (orgId: string) => boolean;
  scheduleProjectPushRetry: () => void;
  pruneRemovedOrgState: (
    orgs: readonly Org2CloudOrg[],
    sessions: readonly Session[]
  ) => void;
  /** Consume the pending inbound/project latches for this pass. Must only
   * run after auth/schema/outbound setup succeeds so an offline or
   * mismatched backend leaves them pending for the next pass. */
  takePendingPassRequests: () => PendingPassRequests;
  /** Claim the once-per-engine-run P2 reconcile for this generation. */
  claimBackgroundReconcile: (generation: number) => boolean;
}

export async function runSyncPass(
  host: SyncPassHost,
  generation: number,
  options: { pushSessions: boolean }
): Promise<void> {
  const store = host.store;
  if (!store) return;
  const auth = store.get(org2CloudAuthAtom);
  if (!auth) return;
  const orgs = store.get(org2CloudOrgsAtom);
  const sessionsAtPassStart = store.get(sessionsAtom);
  host.pruneRemovedOrgState(orgs, sessionsAtPassStart);
  if (orgs.length === 0) return;
  for (const org of orgs) {
    if (!host.isCurrentGeneration(generation)) return;
    await host.projectsChannel.ensureProjectOrgAlias(org);
  }
  if (
    !(await host.schemaGate.passesSchemaGate(
      generation,
      host.isCurrentGeneration
    ))
  ) {
    return;
  }
  const enabledByOrg = store.get(org2CloudSyncEnabledAtom);
  const tags = store.get(sessionOrgTagsAtom);
  // Access ladder (§13.4): read the PERSISTED settings every pass — the
  // ratchet lives here. A per-session override (mode or restricted
  // visibility) is always honored before applying the org minimum, so an automated
  // re-push can never rebuild metadata "from defaults" and silently flip
  // a session back to org/full_replay.
  const accessByOrg = store.get(org2CloudAccessSettingsAtom);
  // Admin sharing floor mirror (0002), re-read every pass like the ladder:
  // the effective per-session mode is raised to at least the org's floor
  // before it goes on the wire (the server backstops this).
  const floorByOrg = store.get(org2CloudSharingFloorAtom);
  // Repo scopes are the HARD boundary (server-enforced since the scope
  // governance change: upsert raises ORG2_SCOPE_FORBIDDEN outside them).
  // Orgs with tagged sessions are still VISITED even without scopes so the
  // loop below can invalidate now-out-of-scope tags (retract + untag);
  // they no longer cause any pushes by themselves.
  const orgsWithTaggedSessions = taggedCloudOrgIds(tags);

  // Endpoint identity captured at pass start. Every RPC re-resolves
  // getCloudEndpoint() at call time, so a mid-pass endpoint switch would
  // otherwise send this pass's still-valid OLD-backend JWT + session
  // payloads to the NEW backend. The token's own backend is recorded on
  // the auth state — bail the moment the active endpoint diverges from it.
  const passSupabaseUrl = auth.supabaseUrl;

  const fresh = await ensureFreshSession(auth);
  if (!host.isCurrentGeneration(generation)) return;
  if (!fresh) {
    log.warn("cloud sync pass skipped: token refresh failed");
    return;
  }
  // Compare-and-set: an endpoint switch (resetCloudStateForEndpointSwitch)
  // or a manual sign-out may have wiped/replaced the atom while the
  // refresh was in flight — never resurrect a signed-out state with
  // old-backend tokens; abandon the pass instead.
  if (store.get(org2CloudAuthAtom) !== auth) return;
  if (getCloudEndpoint().supabaseUrl !== passSupabaseUrl) return;
  commitRefreshedAuth(
    (updater) => store.set(org2CloudAuthAtom, updater),
    auth,
    fresh
  );

  // The session plane follows visible-org demand unless an admin explicitly
  // enables background upload. That policy keeps eligible member sessions
  // publishing without requiring the org to be opened, while ordinary
  // inactive orgs still incur no session scan or scope RPC. Switching/opening
  // an org causes its Realtime subscription to request an immediate full
  // session pass; policy changes arrive through the roster lifecycle key.
  // Sharding Phase A: publish the roster's resolved home endpoints so
  // org-scoped data-plane calls route to each org's home project. Rebuilt
  // every pass — a directory cutover (or rollback) takes effect on the
  // next pass without restart. Empty/absent homeEndpoint keeps the
  // official endpoint, so pre-0007 backends behave exactly as before.
  setOrgEndpointDirectory(
    orgs.map((org) => [org.orgId, resolveOrgEndpoint(org, getCloudEndpoint())])
  );
  // Explicitly tagged sessions must publish (and keep publishing
  // updates) no matter which org the user is looking at — otherwise
  // Move to Org completes its awaited pass without ever visiting the
  // target org, reports success, and the session stays invisible to
  // every other member until the owner happens to activate that org.
  const sessionPushOrgs = orgs.filter(
    (org) =>
      host.isActiveOrg(org.orgId) ||
      isOrgBackgroundUploadEnabled(org) ||
      orgsWithTaggedSessions.has(org.orgId)
  );
  await host.repoScopeSync.hydrateRepoScopes(
    fresh,
    sessionPushOrgs,
    generation,
    host.isCurrentGeneration
  );
  if (!host.isCurrentGeneration(generation)) return;

  const scopesByOrg = store.get(org2CloudRepoScopesAtom);
  const targets = options.pushSessions
    ? sessionPushOrgs.filter(
        (org) =>
          ((scopesByOrg[org.orgId]?.length ?? 0) > 0 ||
            orgsWithTaggedSessions.has(org.orgId)) &&
          enabledByOrg[org.orgId] !== false &&
          !host.orgBackoff.isOrgBackedOff(org.orgId)
      )
    : [];

  for (const org of targets) {
    // Bail the whole pass if the endpoint changed under us (see
    // passSupabaseUrl) — never push this backend's sessions elsewhere.
    if (getCloudEndpoint().supabaseUrl !== passSupabaseUrl) return;
    const scopes = scopesByOrg[org.orgId] ?? [];
    const aborted = await pushOrgSessions(
      {
        store,
        sessionSync: host.sessionSync,
        orgBackoff: host.orgBackoff,
        repoScopeSync: host.repoScopeSync,
        sessionColdStart: host.sessionColdStart,
        vanishedSweep: host.vanishedSweep,
        isCurrentGeneration: host.isCurrentGeneration,
      },
      {
        auth,
        fresh,
        org,
        scopes,
        accessByOrg,
        floorByOrg,
        generation,
        passSupabaseUrl,
      }
    );
    if (aborted) return;
  }

  // The GC above only covered `targets`, but stale rows outlive that set:
  // an org the user switched away from (no background upload), whose
  // scopes are unresolved this run, or that lost its last scope/tag keeps
  // this device's push-marked ghosts forever — Team Sessions then shows a
  // duplicate row per context-window continuation. Sweep every org with
  // local push markers, same rails as the P2 reconcile below.
  if (options.pushSessions) {
    const markedOrgIds = orgsWithLocalPushMarkers(
      store.get(org2CloudPushCursorsAtom),
      store.get(org2CloudPushedMetadataAtom)
    );
    const sweptOrgIds = new Set(targets.map((org) => org.orgId));
    for (const org of orgs) {
      if (!markedOrgIds.has(org.orgId)) continue;
      if (sweptOrgIds.has(org.orgId)) continue;
      if (enabledByOrg[org.orgId] === false) continue;
      if (!host.isCurrentGeneration(generation)) return;
      if (getCloudEndpoint().supabaseUrl !== passSupabaseUrl) return;
      await host.vanishedSweep.retractVanishedSessions(
        fresh,
        org.orgId,
        generation,
        host.isCurrentGeneration
      );
      if (!host.isCurrentGeneration(generation)) return;
    }
  }

  // Projects / work items (cloud-parity Phase B), AFTER the session push —
  // see `org2CloudSyncEngine.projectsPass.ts` for the plane's rails.
  // Consume requests only after auth/schema/outbound setup succeeds; an
  // offline or mismatched backend must leave them pending for the next pass.
  const {
    requestedInboundOrgIds,
    requestedFullInboundOrgIds,
    forceAllInbound,
    pushProjects,
  } = host.takePendingPassRequests();
  if (
    await syncProjectsPlane(
      {
        projectsChannel: host.projectsChannel,
        orgBackoff: host.orgBackoff,
        isActiveOrg: (orgId) => host.isActiveOrg(orgId),
        isCurrentGeneration: host.isCurrentGeneration,
        scheduleProjectPushRetry: () => host.scheduleProjectPushRetry(),
      },
      {
        fresh,
        orgs,
        enabledByOrg,
        generation,
        passSupabaseUrl,
        requestedInboundOrgIds,
        requestedFullInboundOrgIds,
        forceAllInbound,
        pushProjects,
      }
    )
  ) {
    return;
  }

  // P2: retract-only reconcile for orgs the user is NOT looking at.
  // Background upload gives opted-in orgs a full session pass, but the
  // reconcile remains the safety net for every other inactive org — and for
  // background-upload orgs excluded from `targets` after their final scope
  // or tag disappears. Once per engine run: same admission decision, same
  // server-confirmed scope boundary, only rows THIS client push-marked. See
  // the module header for the rails.
  if (host.claimBackgroundReconcile(generation)) {
    const cursors = store.get(org2CloudPushCursorsAtom);
    const pushedMetadata = store.get(org2CloudPushedMetadataAtom);
    const markedOrgIds = orgsWithLocalPushMarkers(cursors, pushedMetadata);
    const backgroundOrgs = orgs.filter(
      (org) =>
        markedOrgIds.has(org.orgId) &&
        !host.isActiveOrg(org.orgId) &&
        enabledByOrg[org.orgId] !== false &&
        !host.orgBackoff.isOrgBackedOff(org.orgId)
    );
    if (backgroundOrgs.length > 0) {
      await host.repoScopeSync.hydrateRepoScopes(
        fresh,
        backgroundOrgs,
        generation,
        host.isCurrentGeneration
      );
      if (!host.isCurrentGeneration(generation)) return;
      log.info(
        `retract reconcile: covering ${backgroundOrgs.length} background org(s) with local push markers`
      );
      for (const org of backgroundOrgs) {
        if (!host.isCurrentGeneration(generation)) return;
        if (getCloudEndpoint().supabaseUrl !== passSupabaseUrl) return;
        await reconcileOrgRetracts(
          {
            store,
            accessByOrg,
            wasCloudPushed: (orgId, sessionId) =>
              host.sessionSync.wasCloudPushed(orgId, sessionId),
            retractSession: (orgId, sessionId) =>
              host.sessionSync.retractSession(fresh, orgId, sessionId),
            hasServerConfirmedScopes: (orgId) =>
              host.repoScopeSync.hasServerConfirmedScopes(orgId),
            isCurrentGeneration: () => host.isCurrentGeneration(generation),
          },
          org.orgId
        );
      }
    }
  }
}

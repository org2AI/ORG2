/**
 * Org2CloudSyncEngine — projects / work-items plane of one sync pass
 * (cloud-parity Phase B), run AFTER the session push.
 *
 * Deliberately over ALL orgs, not the session targets: shared work items
 * are org-wide (no repo-scope selection), so an org with neither scopes nor
 * tagged sessions still syncs its project plane. Only the local toggle and
 * entitlement-disable backoff gate it. Session replay quota backoff
 * deliberately does NOT: project/work-item tombstones are a control-plane
 * operation and must still drain while uploads are full.
 *
 * These planes are Realtime-driven and scoped to the invalidated org.
 * Ordinary signals retain their delta cursors; only reconnect/roster
 * recovery clears the full-listing latch.
 */
import { createLogger } from "@src/hooks/logger";

import { getCloudEndpoint } from "./config";
import type { Org2CloudAuthState } from "./org2CloudAuthAtom";
import type { Org2CloudOrg } from "./org2CloudOrgsAtom";
import {
  type Org2CloudOrgBackoffTracker,
  isCloudSyncBackoffError,
} from "./org2CloudSyncEngine.orgBackoff";
import type { Org2CloudProjectsChannel } from "./org2CloudSyncEngine.projectsChannel";

const log = createLogger("Org2CloudSyncEngine");

export interface ProjectsPassDeps {
  projectsChannel: Org2CloudProjectsChannel;
  orgBackoff: Org2CloudOrgBackoffTracker;
  isActiveOrg: (orgId: string) => boolean;
  isCurrentGeneration: (generation: number) => boolean;
  scheduleProjectPushRetry: () => void;
}

export interface ProjectsPassContext {
  fresh: Org2CloudAuthState;
  orgs: readonly Org2CloudOrg[];
  enabledByOrg: Record<string, boolean>;
  generation: number;
  /** Endpoint identity captured at pass start; see the engine's pass loop. */
  passSupabaseUrl: string;
  /** Inbound requests consumed from the lifecycle latches for this pass. */
  requestedInboundOrgIds: Set<string>;
  requestedFullInboundOrgIds: Set<string>;
  forceAllInbound: boolean;
  /** Whether this pass drains the durable project outbox for every org. */
  pushProjects: boolean;
}

/**
 * @returns `true` when the whole pass must abort (generation superseded or
 * the active endpoint diverged from the pass's backend).
 */
export async function syncProjectsPlane(
  deps: ProjectsPassDeps,
  ctx: ProjectsPassContext
): Promise<boolean> {
  const {
    projectsChannel,
    orgBackoff,
    isActiveOrg,
    isCurrentGeneration,
    scheduleProjectPushRetry,
  } = deps;
  const {
    fresh,
    orgs,
    enabledByOrg,
    generation,
    passSupabaseUrl,
    requestedInboundOrgIds,
    requestedFullInboundOrgIds,
    forceAllInbound,
    pushProjects,
  } = ctx;
  if (forceAllInbound) {
    // Complete listings are reserved for the org the user is looking at;
    // background orgs recover through their delta cursors here (the pulled
    // state includes LWW tombstones) and get their own authoritative full
    // listing from the SUBSCRIBED edge when they are next activated. This
    // keeps start/online/roster recovery from issuing O(orgs) full listings.
    for (const org of orgs) {
      if (isActiveOrg(org.orgId)) {
        requestedFullInboundOrgIds.add(org.orgId);
      } else {
        requestedInboundOrgIds.add(org.orgId);
      }
    }
  }
  for (const orgId of requestedFullInboundOrgIds) {
    requestedInboundOrgIds.add(orgId);
    projectsChannel.invalidateFullListing(orgId);
  }
  const inboundOrgIds = new Set(requestedInboundOrgIds);
  const projectOrgIds = pushProjects
    ? new Set(orgs.map((org) => org.orgId))
    : inboundOrgIds;
  if (projectOrgIds.size > 0) {
    for (const org of orgs) {
      if (!projectOrgIds.has(org.orgId)) continue;
      if (!isCurrentGeneration(generation)) return true;
      if (getCloudEndpoint().supabaseUrl !== passSupabaseUrl) return true;
      if (enabledByOrg[org.orgId] === false) continue;
      if (orgBackoff.isOrgProjectBackedOff(org.orgId)) continue;
      try {
        // Realtime-only pulls do not probe the local outbox. A concrete
        // local mutation/start/reconnect request drains it.
        await projectsChannel.syncOrgProjects(
          fresh,
          org,
          generation,
          { pushOutbox: pushProjects },
          {
            isCurrentGeneration,
            scheduleProjectPushRetry,
          }
        );
      } catch (error) {
        if (!isCurrentGeneration(generation)) return true;
        if (isCloudSyncBackoffError(error)) {
          orgBackoff.backOffOrg(org.orgId, error);
          continue;
        }
        // A listing can fail before ProjectSyncChannel gets far enough to
        // return per-row pushErrors. When this pass was supposed to drain
        // the durable outbox, keep a bounded one-shot retry rather than
        // stranding the write until another unrelated event.
        if (pushProjects) {
          scheduleProjectPushRetry();
        }
        log.warn(`cloud project sync failed for org ${org.orgId}:`, error);
      }
    }
  }
  return false;
}

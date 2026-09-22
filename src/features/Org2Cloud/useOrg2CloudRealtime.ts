/**
 * ORG2 Cloud inbound-sync Realtime manager (design: cloud-sync-supabase-realtime).
 *
 * Uses Supabase Postgres Changes instead of recurring inbound polls. Mounted
 * once in the router root beside `useOrg2CloudOrgs` /
 * `useOrg2CloudSyncEngine`. Owns one Realtime connection per signed-in
 * session/endpoint/active-org generation and drives two inbound slices:
 *
 *  - Slice A (roster):   while a cloud org is active, subscribe
 *                        `org_memberships` filtered to the current user; any
 *                        change → `refetchOrgs()` (`list_my_orgs`), the single
 *                        source of truth. The subscribe true-edge compensates
 *                        for membership changes missed while no org was open.
 *  - Slice B (signals):  subscribe the actively-used org's durable, coarse
 *                        `org_change_signals` row. Plane-specific Presence
 *                        broadcasts drive the normal live path; the coarse
 *                        row is rate-limited to one recovery pull per minute
 *                        so unrelated planes cannot invalidate one another
 *                        on every write. Broadcast backends carry the signal
 *                        as per-kind `org-db-changed` events on the org
 *                        channel instead, dispatched narrowly per plane with
 *                        the same 60s window per plane.
 *
 * Realtime is an INVALIDATION signal only: the data still arrives through the
 * existing RPC pull paths, so no cursor/tombstone logic is duplicated here. The
 * A dropped/released socket is recovered by the channel's reconnect true-edge,
 * visibility regain, and explicit user/network events; there is no recurring
 * cloud sync pass.
 *
 * On (re)subscribe the true-edge of `onStatus` forces a compensating full pull
 * (roster refetch for A; inbound/session/policy recovery for B) to recover any
 * events missed while disconnected.
 *
 * This file composes the subscription planes, each split into a sibling
 * hook: `useOrg2CloudRealtime.identityReset.ts` (identity-owned cache
 * eviction), `.planeBumps.ts` (per-plane invalidation callbacks),
 * `.foregroundRecovery.ts` (conversation-plane focus/online recovery),
 * `.connection.ts` (socket ownership + Slice A), `.signalDispatch.ts`
 * (coalescer, per-kind dispatch, SUBSCRIBED-edge recovery),
 * `.inboundPlanes.ts` (Slice B) and `.presence.ts` (Slice C + org broadcast
 * channel). The 0005 capability probe stays here.
 */
import { useAtomValue, useSetAtom, useStore } from "jotai";
import { useCallback, useEffect, useRef, useState } from "react";

import { sessionsAtom } from "@src/store/session/sessionAtom/atoms";
import type { Session } from "@src/store/session/sessionAtom/types";
import { activeSessionIdAtom } from "@src/store/session/viewAtom";
import { chatPanelSelectedCloudOrgAtom } from "@src/store/ui/chatPanel/selectionAtoms";

import { startCrossWindowFocusPublisher } from "./crossWindowFocus";
import { org2CloudSharingFloorAtom } from "./org2CloudAccessSettings";
import {
  commitRefreshedAuth,
  org2CloudAuthAtom,
  org2CloudAuthIdentityKey,
} from "./org2CloudAuthAtom";
import { getCloudCapabilities } from "./org2CloudCapabilities";
import { ensureFreshSession } from "./org2CloudClient";
import { refreshOrgEntitlement } from "./org2CloudEntitlementCoordinator";
import { endpointForOrigin } from "./org2CloudOrgEndpointRouter";
import {
  org2CloudOrgsAtom,
  sidebarActiveCloudOrgIdAtom,
  useRefetchOrg2CloudOrgs,
} from "./org2CloudOrgsAtom";
import { useOrg2CloudRealtimeLease } from "./org2CloudRealtimeLease";
import { resolveActiveRealtimeOrgId } from "./org2CloudRealtimeScope";
import { org2CloudSyncEngine } from "./org2CloudSyncEngine";
import { useSessionCommentTarget } from "./sessionCommentTarget";
import { useOrg2CloudRealtimeConnection } from "./useOrg2CloudRealtime.connection";
import { useOrg2CloudConversationForegroundRecovery } from "./useOrg2CloudRealtime.foregroundRecovery";
import { useOrg2CloudRealtimeIdentityReset } from "./useOrg2CloudRealtime.identityReset";
import { useOrg2CloudRealtimeInboundPlanes } from "./useOrg2CloudRealtime.inboundPlanes";
import { useOrg2CloudRealtimePlaneBumps } from "./useOrg2CloudRealtime.planeBumps";
import { useOrg2CloudRealtimePresence } from "./useOrg2CloudRealtime.presence";
import { useOrg2CloudRealtimeSignalDispatch } from "./useOrg2CloudRealtime.signalDispatch";

/**
 * Establish + maintain the inbound Realtime subscriptions for the signed-in
 * cloud user. No-op when signed out or outside a cloud-org scope.
 * Re-establishes on userId / endpoint / active-org change; refreshes the
 * socket auth token when it rotates.
 */
export function useOrg2CloudRealtime(): void {
  const auth = useAtomValue(org2CloudAuthAtom);
  const store = useStore();
  const activeSessionId = useAtomValue(activeSessionIdAtom) ?? "";
  const sessions = useAtomValue(sessionsAtom) as Session[];
  const activeCommentTarget = useSessionCommentTarget(
    sessions.find((session) => session.session_id === activeSessionId)
  );
  const activeCommentTargetRef = useRef(activeCommentTarget);
  useEffect(() => {
    activeCommentTargetRef.current = activeCommentTarget;
  }, [activeCommentTarget]);
  const setAuth = useSetAtom(org2CloudAuthAtom);
  const cloudOrgs = useAtomValue(org2CloudOrgsAtom);
  const requestedActiveCloudOrgId = useAtomValue(sidebarActiveCloudOrgIdAtom);
  const managedCloudOrgId =
    useAtomValue(chatPanelSelectedCloudOrgAtom)?.orgId ?? null;
  const requestedRealtimeOrgId = resolveActiveRealtimeOrgId(
    cloudOrgs,
    requestedActiveCloudOrgId,
    managedCloudOrgId
  );
  const realtimeLeaseHeld = useOrg2CloudRealtimeLease();
  const activeRealtimeOrgId = realtimeLeaseHeld ? requestedRealtimeOrgId : null;
  const refetchOrgs = useRefetchOrg2CloudOrgs();
  const bumps = useOrg2CloudRealtimePlaneBumps(activeCommentTargetRef);
  const { bumpRosterVersion, bumpRemoteSessionsVersion } = bumps;

  const userId = auth?.userId ?? null;
  const endpointUrl = auth?.supabaseUrl ?? null;
  const authIdentityKey = auth ? org2CloudAuthIdentityKey(auth) : null;
  useOrg2CloudRealtimeIdentityReset(authIdentityKey);
  // Stable refs so the per-org effect and status callbacks read current values
  // without forcing the connection to rebuild.
  const refetchRef = useRef(refetchOrgs);
  useEffect(() => {
    refetchRef.current = refetchOrgs;
  }, [refetchOrgs]);
  // Best-effort roster refetch shared by every plane: the fetch coordinator
  // owns its own failure surfacing, so callers fire and forget.
  const refetchOrgsBestEffort = useCallback(() => {
    void refetchRef.current();
  }, []);

  // Auth via ref: the connection rebuilds only on user/endpoint/org-set change.
  // Depending on the `auth` object itself would tear the socket down on every
  // token rotation / profile enrichment (each replaces the atom value), and
  // the Slice B/C subscriptions — whose effect does NOT re-run then — would
  // stay bound to the disposed connection and silently go dead.
  const authRef = useRef(auth);
  useEffect(() => {
    authRef.current = auth;
  }, [auth]);

  // 0005 capability: change signals arrive as server broadcasts on the org
  // channel instead of postgres_changes. `false` covers legacy backends AND
  // the unresolved-probe window — the legacy channels stay up until the probe
  // flips, so no signal is ever lost; pre-0005 backends never flip, so their
  // subscription topology never churns.
  const [broadcastSignals, setBroadcastSignals] = useState(false);
  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clear the previous identity/endpoint capability before the asynchronous probe can publish a result
    setBroadcastSignals(false);
    const current = authRef.current;
    if (!userId || !current) return undefined;
    void (async () => {
      const fresh = await ensureFreshSession(current);
      if (!fresh || cancelled) return;
      commitRefreshedAuth(setAuth, current, fresh);
      const capabilities = await getCloudCapabilities(
        fresh.accessToken,
        endpointForOrigin(fresh.supabaseUrl)
      );
      if (!cancelled && capabilities.broadcastSignals) {
        setBroadcastSignals(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, endpointUrl, setAuth]);

  // `org_change_signals` also carries rare sharing-floor changes. Refresh only
  // the affected org's entitlement through the shared coordinator
  // (store-keyed single-flight + TTL) instead of using list_my_orgs as a
  // policy cache invalidation mechanism.
  const refreshEntitlementForOrg = useCallback(
    async (orgId: string): Promise<boolean> => {
      const before = store.get(org2CloudSharingFloorAtom)[orgId];
      await refreshOrgEntitlement(store, orgId, async () => {
        const current = authRef.current;
        if (!current) return null;
        const fresh = await ensureFreshSession(current);
        if (!fresh) return null;
        commitRefreshedAuth(setAuth, current, fresh);
        return fresh.accessToken;
      });
      return store.get(org2CloudSharingFloorAtom)[orgId] !== before;
    },
    [setAuth, store]
  );
  // Every policy path (control-plane throttle, 'policy' signal, entitlement
  // control event, full edge recovery) resumes the org's push plane only when
  // the sharing floor actually moved.
  const resumeOrgIfFloorChanged = useCallback(
    (orgId: string) => {
      void refreshEntitlementForOrg(orgId).then((floorChanged) => {
        if (floorChanged) org2CloudSyncEngine.resumeOrg(orgId);
      });
    },
    [refreshEntitlementForOrg]
  );

  // EVERY window (main and detached) advertises its focus state so the main
  // window's lease treats "the app is foregrounded in ANY window" as
  // foreground — a user working in a detached window must not cost main its
  // socket after the blur grace.
  useEffect(() => startCrossWindowFocusPublisher(), []);

  useOrg2CloudConversationForegroundRecovery({
    activeRealtimeOrgId,
    bumpConversationPlaneVersion: bumps.bumpConversationPlaneVersion,
    bumpActiveSessionCommentsSignal: bumps.bumpActiveSessionCommentsSignal,
  });

  // Slice B and Slice C bind to the connection through this ref, so the
  // connection hook must be composed first (effects run in declaration order).
  const connectionRef = useOrg2CloudRealtimeConnection({
    userId,
    endpointUrl,
    activeRealtimeOrgId,
    authRef,
    accessToken: auth?.accessToken,
    refetchOrgsBestEffort,
  });

  const signals = useOrg2CloudRealtimeSignalDispatch({
    activeRealtimeOrgId,
    bumps,
    refetchOrgsBestEffort,
    resumeOrgIfFloorChanged,
  });

  useOrg2CloudRealtimeInboundPlanes({
    connectionRef,
    userId,
    endpointUrl,
    activeRealtimeOrgId,
    broadcastSignals,
    bumpRosterVersion,
    signals,
  });

  useOrg2CloudRealtimePresence({
    connectionRef,
    userId,
    endpointUrl,
    activeRealtimeOrgId,
    broadcastSignals,
    authRef,
    authIdentityKey,
    displayName: auth?.profile?.displayName ?? "",
    sessions,
    activeSessionId,
    signals,
    refetchOrgsBestEffort,
    resumeOrgIfFloorChanged,
    bumpRosterVersion,
    bumpRemoteSessionsVersion,
  });
}

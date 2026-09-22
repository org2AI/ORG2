/**
 * useOrg2CloudRealtime — connection ownership + Slice A (roster).
 *
 * Owns one Realtime connection per signed-in user / endpoint / active-org
 * generation and the signed-in user's OWN membership subscription. Slice B
 * and Slice C bind to the connection through the returned ref, so their
 * effects must run AFTER this hook's (compose it first).
 */
import { type RefObject, useEffect, useRef } from "react";

import { isMainAppWindow } from "@src/util/platform/tauri/windowIdentity";

import { getFreshCloudAccessToken } from "./cloudShortId";
import type { Org2CloudAuthState } from "./org2CloudAuthAtom";
import {
  type Org2CloudRealtimeConnection,
  createOrg2CloudRealtimeConnection,
} from "./org2CloudRealtimeClient";
import { decideSubscribedEdgeRecovery } from "./org2CloudRealtimeRecovery";

export function useOrg2CloudRealtimeConnection(args: {
  userId: string | null;
  endpointUrl: string | null;
  activeRealtimeOrgId: string | null;
  /** Current auth read through a ref — see the `authRef` comment in the
   * composing hook for why the connection must not depend on `auth`. */
  authRef: RefObject<Org2CloudAuthState | null>;
  accessToken: string | undefined;
  refetchOrgsBestEffort: () => void;
}): RefObject<Org2CloudRealtimeConnection | null> {
  const {
    userId,
    endpointUrl,
    activeRealtimeOrgId,
    authRef,
    accessToken,
    refetchOrgsBestEffort,
  } = args;
  const connectionRef = useRef<Org2CloudRealtimeConnection | null>(null);
  // Disconnect-duration bookkeeping for the SUBSCRIBED-edge recovery policy:
  // short gaps and rejoin storms downgrade to delta pulls, long gaps run the
  // authoritative full recovery (see org2CloudRealtimeRecovery).
  const connectionTeardownAtRef = useRef<number | undefined>(undefined);
  const rosterEdgeRefetchAtRef = useRef<number | undefined>(undefined);

  // --- Connection + Slice A (roster). Rebuilds on user / endpoint / active
  // org. A fresh connection on scope switch avoids supabase-js reusing a
  // presence topic whose asynchronous leave has not finished yet.
  useEffect(() => {
    const current = authRef.current;
    // Socket ownership is main-window-only: a secondary window opening a
    // second Realtime connection would double the billable socket count and
    // flap Presence (the presence key is the userId, so two windows publish
    // two metas for one user). Main's webview is never destroyed while the
    // app runs, so this ownership rule is stable.
    if (!isMainAppWindow() || !userId || !current || !activeRealtimeOrgId) {
      return undefined;
    }
    const connection = createOrg2CloudRealtimeConnection(
      getFreshCloudAccessToken
    );
    connectionRef.current = connection;

    // Slice A: the signed-in user's OWN membership rows. Filtering by user_id
    // (not org_id) is what lets a REMOVED member still receive their own
    // removal row — the second RLS SELECT policy (user_id = auth.uid()) keeps
    // it visible after is_org_member() would already return false.
    const unsubRoster = connection.subscribe({
      table: "org_memberships",
      filter: `user_id=eq.${userId}`,
      onChange: () => {
        // Any membership change (removed / re-activated / role change / new
        // org) → re-pull the authoritative roster. Never optimistically mutate.
        refetchOrgsBestEffort();
      },
      onStatus: (subscribed) => {
        if (!subscribed) return;
        // Compensate for events missed before/while (re)subscribing. Roster
        // changes are rare: a short gap (org switch, brief reconnect) keeps
        // the last authoritative roster instead of re-listing plus the ×N
        // entitlement fan-out on every edge.
        const decision = decideSubscribedEdgeRecovery({
          nowMs: Date.now(),
          teardownAtMs: connectionTeardownAtRef.current,
          lastFullRecoveryAtMs: rosterEdgeRefetchAtRef.current,
        });
        if (decision === "full") {
          rosterEdgeRefetchAtRef.current = Date.now();
          refetchOrgsBestEffort();
        }
      },
    });

    return () => {
      unsubRoster();
      connection.dispose();
      connectionRef.current = null;
      connectionTeardownAtRef.current = Date.now();
    };
    // authRef (not auth) on purpose — see the ref comment in the composing
    // hook. `authRef` and `refetchOrgsBestEffort` are stable (a ref object and
    // a ref-backed callback), so the connection still rebuilds only on user /
    // endpoint / active-org change.
  }, [
    userId,
    endpointUrl,
    activeRealtimeOrgId,
    authRef,
    refetchOrgsBestEffort,
  ]);

  // --- Nudge the socket to re-resolve its token as soon as the atom
  // rotates; the heartbeat-driven callback refresh covers the steady state.
  useEffect(() => {
    if (accessToken) {
      connectionRef.current?.setAuth();
    }
  }, [accessToken]);

  return connectionRef;
}

/**
 * useOrg2CloudRealtime — Slice B: change-signal + roster subscriptions for
 * the active org only (legacy postgres_changes backends).
 *
 * Inactive orgs catch up immediately when selected; they must not keep
 * reconnecting channels or pulling data while the user works elsewhere.
 * On 0005 backends both planes ride the org broadcast channel (Slice C)
 * instead and this effect keeps only the teardown bookkeeping.
 */
import { useSetAtom } from "jotai";
import { type RefObject, useEffect } from "react";

import { createLogger } from "@src/hooks/logger";

import { org2CloudRosterRealtimeConnectedAtom } from "./org2CloudOrgsAtom";
import type { Org2CloudRealtimeConnection } from "./org2CloudRealtimeClient";
import type { Org2CloudRealtimeSignalDispatch } from "./useOrg2CloudRealtime.signalDispatch";
import { CHANGE_SIGNALS_TABLE } from "./useOrg2CloudRealtime.signalPlanes";

const log = createLogger("Org2CloudRealtime");

export function useOrg2CloudRealtimeInboundPlanes(args: {
  connectionRef: RefObject<Org2CloudRealtimeConnection | null>;
  userId: string | null;
  endpointUrl: string | null;
  activeRealtimeOrgId: string | null;
  broadcastSignals: boolean;
  bumpRosterVersion: (orgId: string) => void;
  signals: Org2CloudRealtimeSignalDispatch;
}): void {
  const {
    connectionRef,
    userId,
    endpointUrl,
    activeRealtimeOrgId,
    broadcastSignals,
    bumpRosterVersion,
    signals,
  } = args;
  const {
    signalCoalescerRef,
    coarseSafetyNetTimerRef,
    orgTeardownAtRef,
    scheduleCoarseSignalRefresh,
    runSignalEdgeRecovery,
  } = signals;
  const setRosterRealtimeConnected = useSetAtom(
    org2CloudRosterRealtimeConnectedAtom
  );

  useEffect(() => {
    const connection = connectionRef.current;
    if (!connection || !userId || !activeRealtimeOrgId) return undefined;

    const unsubscribes: Array<() => void> = [];
    const orgTeardownAt = orgTeardownAtRef.current;
    const signalCoalescer = signalCoalescerRef.current;
    const orgId = activeRealtimeOrgId;
    if (!broadcastSignals) {
      unsubscribes.push(
        connection.subscribe({
          table: CHANGE_SIGNALS_TABLE,
          filter: `org_id=eq.${orgId}`,
          onChange: () => {
            // This row carries no plane/entity discriminator. Treat it only as
            // a bounded durable event; plane-specific Presence broadcasts
            // keep normal session/comment/control changes immediate.
            scheduleCoarseSignalRefresh();
          },
          onStatus: (subscribed) => {
            // On (re)subscribe compensate for events missed while
            // disconnected.
            if (subscribed) runSignalEdgeRecovery(orgId);
          },
        })
      );
      // Org-wide roster: a TEAMMATE joining/leaving/changing role (Slice A
      // only carries the signed-in user's OWN rows). Bumps the per-org
      // version counter; CloudOrgPanelView keys its fetch on it so the
      // members list updates live while the panel is open.
      unsubscribes.push(
        connection.subscribe({
          table: "org_memberships",
          filter: `org_id=eq.${orgId}`,
          onChange: () => {
            bumpRosterVersion(orgId);
          },
          onStatus: (subscribed) => {
            setRosterRealtimeConnected((current) =>
              current[orgId] === subscribed
                ? current
                : { ...current, [orgId]: subscribed }
            );
            // Compensate for roster events missed while disconnected.
            if (subscribed) bumpRosterVersion(orgId);
          },
        })
      );
      log.info(`realtime: subscribed inbound planes for active org ${orgId}`);
    }

    return () => {
      for (const unsub of unsubscribes) unsub();
      orgTeardownAt.set(orgId, Date.now());
      setRosterRealtimeConnected((current) => {
        if (!(orgId in current)) return current;
        const next = { ...current };
        delete next[orgId];
        return next;
      });
      signalCoalescer.reset();
      if (coarseSafetyNetTimerRef.current) {
        clearTimeout(coarseSafetyNetTimerRef.current);
        coarseSafetyNetTimerRef.current = null;
      }
    };
    // Connection identity follows the same activeRealtimeOrgId key in Slice A.
    // The ref objects are stable; listing them keeps exhaustive-deps honest
    // without changing when the effect re-runs.
  }, [
    activeRealtimeOrgId,
    userId,
    endpointUrl,
    broadcastSignals,
    bumpRosterVersion,
    scheduleCoarseSignalRefresh,
    runSignalEdgeRecovery,
    setRosterRealtimeConnected,
    connectionRef,
    orgTeardownAtRef,
    signalCoalescerRef,
    coarseSafetyNetTimerRef,
  ]);
}

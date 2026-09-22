/**
 * useOrg2CloudRealtime — signal coalescing + per-plane dispatch + edge
 * recovery.
 *
 * Shared by the Slice B postgres_changes path (legacy backends) and the
 * Slice C org broadcast channel (0005 backends): identical short coalescing
 * and refresh behavior regardless of transport. Owns the per-plane
 * coalescer, the control-plane throttle, the slow coarse safety net, and
 * the disconnect-duration bookkeeping the SUBSCRIBED-edge recovery policy
 * reads.
 */
import { type RefObject, useCallback, useRef } from "react";

import type { Org2CloudDbChangeKind } from "./org2CloudControlBus";
import { decideSubscribedEdgeRecovery } from "./org2CloudRealtimeRecovery";
import {
  Org2CloudRealtimeSignalCoalescer,
  STORM_SIGNAL_COALESCE_MS,
} from "./org2CloudRealtimeSignalCoalescer";
import { org2CloudSyncEngine } from "./org2CloudSyncEngine";
import type { Org2CloudRealtimePlaneBumps } from "./useOrg2CloudRealtime.planeBumps";
import {
  ALL_SIGNAL_PLANES,
  CONTROL_PLANE_REFRESH_THROTTLE_MS,
  type SignalPlane,
  isDocumentHidden,
} from "./useOrg2CloudRealtime.signalPlanes";

export interface Org2CloudRealtimeSignalDispatch {
  signalCoalescerRef: RefObject<Org2CloudRealtimeSignalCoalescer<SignalPlane>>;
  coarseSafetyNetTimerRef: RefObject<ReturnType<typeof setTimeout> | null>;
  orgTeardownAtRef: RefObject<Map<string, number>>;
  scheduleCoarseSignalRefresh: () => void;
  scheduleSessionsPlaneRefresh: (orgId: string) => void;
  dispatchDbChangeSignal: (orgId: string, kind: Org2CloudDbChangeKind) => void;
  runSignalEdgeRecovery: (orgId: string) => void;
}

export function useOrg2CloudRealtimeSignalDispatch(args: {
  activeRealtimeOrgId: string | null;
  bumps: Org2CloudRealtimePlaneBumps;
  refetchOrgsBestEffort: () => void;
  resumeOrgIfFloorChanged: (orgId: string) => void;
}): Org2CloudRealtimeSignalDispatch {
  const {
    activeRealtimeOrgId,
    bumps,
    refetchOrgsBestEffort,
    resumeOrgIfFloorChanged,
  } = args;
  const {
    bumpChannelsVersion,
    bumpChannelMessagesVersion,
    bumpConversationPlaneVersion,
    bumpRosterVersion,
    bumpMemberRuntimeVersion,
    bumpOrgCommentsSignal,
    bumpActiveSessionCommentsSignal,
    bumpRemoteSessionsVersion,
  } = bumps;
  // Stable refs so the per-org effect and status callbacks read current values
  // without forcing the connection to rebuild.
  const signalCoalescerRef = useRef(
    new Org2CloudRealtimeSignalCoalescer<SignalPlane>()
  );
  const controlPlaneRefreshAtRef = useRef(0);
  const coarseSafetyNetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  // Disconnect-duration bookkeeping for the SUBSCRIBED-edge recovery policy:
  // short gaps and rejoin storms downgrade to delta pulls, long gaps run the
  // authoritative full recovery (see org2CloudRealtimeRecovery).
  const orgTeardownAtRef = useRef(new Map<string, number>());
  const orgFullRecoveryAtRef = useRef(new Map<string, number>());

  // Low-frequency control-plane guard shared by every signal path: any
  // signal arms the 5-min refetchOrgs + entitlement TTL check.
  const maybeRefreshControlPlane = useCallback(
    (orgId: string) => {
      const now = Date.now();
      if (
        now - controlPlaneRefreshAtRef.current <
        CONTROL_PLANE_REFRESH_THROTTLE_MS
      ) {
        return;
      }
      controlPlaneRefreshAtRef.current = now;
      refetchOrgsBestEffort();
      resumeOrgIfFloorChanged(orgId);
    },
    [refetchOrgsBestEffort, resumeOrgIfFloorChanged]
  );

  // Shared by the Slice B postgres_changes path (legacy backends) and the
  // Slice C safety net (per-kind backends): identical short coalescing and
  // refresh behavior regardless of transport.
  const runCoarseSignalRefresh = useCallback(() => {
    const orgId = activeRealtimeOrgId;
    if (!orgId) return;
    // Hidden check FIRST (same reorder as the edge-recovery fix): the
    // safety-net timer calls this directly, and a hidden-skipped run must
    // not mark the planes handled while doing none of the refreshes.
    if (isDocumentHidden()) return;
    signalCoalescerRef.current.markHandled([
      "coarse",
      "sessions",
      "comments",
      "inbound",
      "channels",
      "channelMessages",
      "conversationEvents",
    ]);
    org2CloudSyncEngine.invalidateOrgInbound(orgId);
    bumpRemoteSessionsVersion(orgId);
    bumpOrgCommentsSignal(orgId);
    // Channels ride the same coarse net: a shadowed per-kind signal (or a
    // plain-0005 backend) must still converge the sidebar list here — this
    // is the only recovery path short of a reconnect edge.
    bumpChannelsVersion(orgId);
    // Same reasoning for the open channel transcript: a shadowed per-kind
    // signal must still converge the message list here.
    bumpChannelMessagesVersion(orgId);
    // Open conversation streams converge here too: a turn-plane append
    // broadcast while the socket was down must still be pulled on the
    // reconnect edge — the per-conversation after_seq pull is bounded.
    bumpConversationPlaneVersion(orgId);
    maybeRefreshControlPlane(orgId);
  }, [
    activeRealtimeOrgId,
    bumpRemoteSessionsVersion,
    bumpOrgCommentsSignal,
    bumpChannelsVersion,
    bumpChannelMessagesVersion,
    bumpConversationPlaneVersion,
    maybeRefreshControlPlane,
  ]);
  // Per-plane leading/trailing coalescer. A successful subscribe edge marks
  // the initial recovery as handled, so the next real server signal waits at
  // most the short live window rather than the old 60-second throttle.
  const schedulePlaneSignalRefresh = useCallback(
    (plane: SignalPlane, refresh: () => void, windowMs?: number) => {
      signalCoalescerRef.current.schedule(
        plane,
        () => {
          if (isDocumentHidden()) return;
          refresh();
        },
        windowMs
      );
    },
    []
  );
  const scheduleCoarseSignalRefresh = useCallback(() => {
    // The coarse refresh is the heaviest bundle (every plane at once), and on
    // legacy backends it fires for EVERY change kind — storm window required.
    schedulePlaneSignalRefresh(
      "coarse",
      runCoarseSignalRefresh,
      STORM_SIGNAL_COALESCE_MS
    );
  }, [schedulePlaneSignalRefresh, runCoarseSignalRefresh]);
  // Slow convergence net for narrowed dispatch: one trailing full coarse
  // refresh per control-plane TTL window while signals keep arriving.
  const armCoarseSignalSafetyNet = useCallback(() => {
    if (coarseSafetyNetTimerRef.current) return;
    coarseSafetyNetTimerRef.current = setTimeout(() => {
      coarseSafetyNetTimerRef.current = null;
      runCoarseSignalRefresh();
    }, CONTROL_PLANE_REFRESH_THROTTLE_MS);
  }, [runCoarseSignalRefresh]);

  // Single callback for every sessions-plane schedule: the coalescer keeps
  // the FIRST-armed refresh for a pending trailing window, so all entry
  // points (db-change signals, comment broadcasts) must request the same
  // full refresh or a weaker one could swallow a stronger one's work.
  const scheduleSessionsPlaneRefresh = useCallback(
    (orgId: string) => {
      schedulePlaneSignalRefresh(
        "sessions",
        () => {
          org2CloudSyncEngine.invalidateOrgInbound(orgId);
          bumpRemoteSessionsVersion(orgId);
        },
        STORM_SIGNAL_COALESCE_MS
      );
    },
    [schedulePlaneSignalRefresh, bumpRemoteSessionsVersion]
  );

  const dispatchDbChangeSignal = useCallback(
    (orgId: string, kind: Org2CloudDbChangeKind) => {
      armCoarseSignalSafetyNet();
      if (!isDocumentHidden()) maybeRefreshControlPlane(orgId);
      switch (kind) {
        case "sessions":
          scheduleSessionsPlaneRefresh(orgId);
          return;
        case "comments":
          schedulePlaneSignalRefresh(
            "comments",
            () => {
              bumpOrgCommentsSignal(orgId);
            },
            STORM_SIGNAL_COALESCE_MS
          );
          return;
        case "projects":
        case "workItems":
          schedulePlaneSignalRefresh(
            "inbound",
            () => {
              org2CloudSyncEngine.invalidateOrgInbound(orgId);
            },
            STORM_SIGNAL_COALESCE_MS
          );
          return;
        case "roster":
          schedulePlaneSignalRefresh("roster", () => {
            bumpRosterVersion(orgId);
          });
          return;
        case "policy":
          schedulePlaneSignalRefresh("policy", () => {
            resumeOrgIfFloorChanged(orgId);
            bumpRosterVersion(orgId);
          });
          return;
        case "channels":
          schedulePlaneSignalRefresh(
            "channels",
            () => {
              bumpChannelsVersion(orgId);
            },
            STORM_SIGNAL_COALESCE_MS
          );
          return;
        case "channelMessages":
          // Live-chat delta (p_since, server-capped): the short window is a
          // deliberate latency choice, and the pull is bounded.
          schedulePlaneSignalRefresh("channelMessages", () => {
            bumpChannelMessagesVersion(orgId);
          });
          return;
        case "conversationEvents":
          // Turn-plane appends move only the open conversation streams; the
          // per-conversation after_seq pull is bounded and cheap.
          schedulePlaneSignalRefresh("conversationEvents", () => {
            bumpConversationPlaneVersion(orgId);
          });
          return;
        case "member_runtime":
          // Telemetry heartbeats only move the Team Runtime roster. Routing
          // them to their own plane keeps a teammate's 15-minute push from
          // triggering the coarse full-plane fallback on every client.
          schedulePlaneSignalRefresh("memberRuntime", () => {
            bumpMemberRuntimeVersion(orgId);
          });
          return;
      }
    },
    [
      armCoarseSignalSafetyNet,
      maybeRefreshControlPlane,
      schedulePlaneSignalRefresh,
      scheduleSessionsPlaneRefresh,
      bumpOrgCommentsSignal,
      bumpRosterVersion,
      bumpMemberRuntimeVersion,
      bumpChannelsVersion,
      bumpChannelMessagesVersion,
      bumpConversationPlaneVersion,
      resumeOrgIfFloorChanged,
    ]
  );

  // Recovery for missed signals on a (re)subscribed org scope. Legacy: the
  // signal channel's SUBSCRIBED edge. 0005: the org broadcast channel's edge.
  const runSignalEdgeRecovery = useCallback(
    (orgId: string) => {
      // Hidden check FIRST: an edge that races a visibility flip must not
      // stamp the control-plane throttle or mark the coalescer handled while
      // skipping the actual refreshes — that claimed a recovery that never
      // ran and muted the next real one for up to the 5-min window.
      if (isDocumentHidden()) return;
      signalCoalescerRef.current.markHandled(ALL_SIGNAL_PLANES);
      controlPlaneRefreshAtRef.current = Date.now();
      // Broadcast signals are at-most-once: a frame lost with no follow-up
      // signal would otherwise never arm any convergence path. One trailing
      // coarse refresh per control-plane window bounds that staleness.
      armCoarseSignalSafetyNet();
      // A LONG gap forces complete listings so tombstone-free absences
      // (revoked projects / retention shifts) are observed; a short gap or
      // a rejoin storm keeps the delta cursors, which already merge
      // deletedAt/LWW tombstones.
      const decision = decideSubscribedEdgeRecovery({
        nowMs: Date.now(),
        teardownAtMs: orgTeardownAtRef.current.get(orgId),
        lastFullRecoveryAtMs: orgFullRecoveryAtRef.current.get(orgId),
      });
      if (decision === "delta") {
        org2CloudSyncEngine.invalidateOrgInbound(orgId);
        bumpRemoteSessionsVersion(orgId);
        bumpOrgCommentsSignal(orgId);
        bumpChannelsVersion(orgId);
        bumpChannelMessagesVersion(orgId);
        bumpConversationPlaneVersion(orgId);
        return;
      }
      orgFullRecoveryAtRef.current.set(orgId, Date.now());
      org2CloudSyncEngine.invalidateOrgInbound(orgId, {
        full: true,
        pushSessions: true,
      });
      resumeOrgIfFloorChanged(orgId);
      // Force a complete listing after a disconnected window while the
      // last authorized snapshot stays visible. The fetch coordinator
      // replaces it atomically only if the server truth changed.
      bumpRemoteSessionsVersion(orgId, { full: true });
      bumpOrgCommentsSignal(orgId);
      // The org-level bump above is TTL-gated; the session broadcast the
      // released socket missed is exactly what the open thread needs, so
      // force the active session's thread past the TTL.
      bumpActiveSessionCommentsSignal(orgId);
      // Channel lifecycle broadcasts missed while disconnected re-pull here
      // (the list RPC is a single bounded read; no delta cursor to preserve).
      bumpChannelsVersion(orgId);
      // Messages posted/edited/deleted during the gap arrive through the
      // channel's own `p_since` delta, which already carries tombstones.
      bumpChannelMessagesVersion(orgId);
      bumpConversationPlaneVersion(orgId);
    },
    [
      armCoarseSignalSafetyNet,
      bumpRemoteSessionsVersion,
      bumpOrgCommentsSignal,
      bumpActiveSessionCommentsSignal,
      bumpChannelsVersion,
      bumpChannelMessagesVersion,
      bumpConversationPlaneVersion,
      resumeOrgIfFloorChanged,
    ]
  );

  return {
    signalCoalescerRef,
    coarseSafetyNetTimerRef,
    orgTeardownAtRef,
    scheduleCoarseSignalRefresh,
    scheduleSessionsPlaneRefresh,
    dispatchDbChangeSignal,
    runSignalEdgeRecovery,
  };
}

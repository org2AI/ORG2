/**
 * useOrg2CloudRealtime — Slice C: org-level presence for the actively-used
 * org only, plus the org broadcast channel (0005 backends carry change
 * signals, control signals, comments and presence-view events on it).
 *
 * Presence follows the session the shared Chat pipeline is actually
 * rendering. Secondary/imported tabs intentionally diverge from the
 * WorkStation's remembered selection, so publishing that remembered id
 * makes two users viewing the same cloud replay advertise different rows.
 */
import { useAtomValue, useSetAtom } from "jotai";
import { type RefObject, useCallback, useEffect, useMemo, useRef } from "react";

import {
  cloudOrgIdsForSession,
  sessionOrgTagsAtom,
} from "@src/features/TeamCollaboration/sessionOrgTagsAtom";
import { createLogger } from "@src/hooks/logger";
import type { Session } from "@src/store/session/sessionAtom/types";

import type { Org2CloudAuthState } from "./org2CloudAuthAtom";
import {
  COMMENTS_CHANGED_EVENT,
  bumpCommentsSignalKey,
  org2CloudCommentsSignalAtom,
  registerCommentsBroadcaster,
  sessionCommentsKey,
} from "./org2CloudCommentsBus";
import {
  ORG_CONTROL_CHANGED_EVENT,
  ORG_DB_CHANGED_EVENT,
  parseOrgControlChangeKind,
  parseOrgDbChangeKind,
  registerOrgControlBroadcaster,
} from "./org2CloudControlBus";
import { org2CloudRosterRealtimeConnectedAtom } from "./org2CloudOrgsAtom";
import {
  type Org2CloudPresenceEntry,
  type Org2CloudPresencePayload,
  PRESENCE_VIEW_CHANGED_EVENT,
  applyOrg2CloudPresenceViewChanged,
  latestPresenceMeta,
  org2CloudPresenceAtom,
  org2CloudPresenceOutboundAtom,
  org2CloudPresencePayloadKey,
  org2CloudPresenceRosterEquals,
  resolveCloudSessionRefs,
} from "./org2CloudPresenceAtom";
import type {
  Org2CloudPresenceHandle,
  Org2CloudRealtimeConnection,
} from "./org2CloudRealtimeClient";
import {
  org2CloudRemoteSessionsAtom,
  remoteSessionsEntryForIdentity,
} from "./org2CloudRemoteSessionsAtom";
import { org2CloudSyncEngine } from "./org2CloudSyncEngine";
import type { Org2CloudRealtimeSignalDispatch } from "./useOrg2CloudRealtime.signalDispatch";
import { isDocumentHidden } from "./useOrg2CloudRealtime.signalPlanes";

const log = createLogger("Org2CloudRealtime");

export function useOrg2CloudRealtimePresence(args: {
  connectionRef: RefObject<Org2CloudRealtimeConnection | null>;
  userId: string | null;
  endpointUrl: string | null;
  activeRealtimeOrgId: string | null;
  broadcastSignals: boolean;
  authRef: RefObject<Org2CloudAuthState | null>;
  authIdentityKey: string | null;
  displayName: string;
  sessions: Session[];
  activeSessionId: string;
  signals: Org2CloudRealtimeSignalDispatch;
  refetchOrgsBestEffort: () => void;
  resumeOrgIfFloorChanged: (orgId: string) => void;
  bumpRosterVersion: (orgId: string) => void;
  bumpRemoteSessionsVersion: (
    orgId: string,
    options?: { full?: boolean }
  ) => void;
}): void {
  const {
    connectionRef,
    userId,
    endpointUrl,
    activeRealtimeOrgId,
    broadcastSignals,
    authRef,
    authIdentityKey,
    displayName,
    sessions,
    activeSessionId,
    signals,
    refetchOrgsBestEffort,
    resumeOrgIfFloorChanged,
    bumpRosterVersion,
    bumpRemoteSessionsVersion,
  } = args;
  const {
    dispatchDbChangeSignal,
    scheduleCoarseSignalRefresh,
    scheduleSessionsPlaneRefresh,
    runSignalEdgeRecovery,
  } = signals;
  const setCommentsSignal = useSetAtom(org2CloudCommentsSignalAtom);
  const setPresence = useSetAtom(org2CloudPresenceAtom);
  const setOutboundPresence = useSetAtom(org2CloudPresenceOutboundAtom);
  const setRosterRealtimeConnected = useSetAtom(
    org2CloudRosterRealtimeConnectedAtom
  );
  const sessionOrgTags = useAtomValue(sessionOrgTagsAtom);
  const remoteSessions = useAtomValue(org2CloudRemoteSessionsAtom);

  const viewing = useMemo(() => {
    if (!activeSessionId) return [];
    const session = sessions.find(
      (candidate) => candidate.session_id === activeSessionId
    );
    if (!session || !activeRealtimeOrgId) return [];
    return resolveCloudSessionRefs(
      session,
      cloudOrgIdsForSession(sessionOrgTags, session.session_id),
      remoteSessionsEntryForIdentity(
        remoteSessions[activeRealtimeOrgId],
        authIdentityKey
      )?.rows ?? [],
      userId
    ).filter((ref) => ref.orgId === activeRealtimeOrgId);
  }, [
    activeRealtimeOrgId,
    activeSessionId,
    authIdentityKey,
    remoteSessions,
    sessionOrgTags,
    sessions,
    userId,
  ]);
  const viewingRef = useRef(viewing);
  useEffect(() => {
    viewingRef.current = viewing;
  }, [viewing]);

  const presenceHandlesRef = useRef(new Map<string, Org2CloudPresenceHandle>());
  const presencePayloadKeysRef = useRef(new Map<string, string | null>());
  const buildPayload = useCallback(
    (orgId: string): Org2CloudPresencePayload | null => {
      const current = (viewingRef.current ?? []).find(
        (ref) => ref.orgId === orgId
      );
      // The active org channel may be open before a cloud session is selected;
      // avoid publishing an empty Presence meta in that state.
      if (!current) return null;
      return {
        displayName: authRef.current?.profile?.displayName ?? "",
        viewingSessionId: current.bareSessionId,
        updatedAt: Date.now(),
      };
    },
    [authRef]
  );

  useEffect(() => {
    const connection = connectionRef.current;
    if (!connection || !userId || !activeRealtimeOrgId) return undefined;
    const handles = presenceHandlesRef.current;
    const payloadKeys = presencePayloadKeysRef.current;
    const unregisters: Array<() => void> = [];
    const orgId = activeRealtimeOrgId;
    const initialPayload = buildPayload(orgId);
    const handle = connection.joinPresence({
      scope: `org:${orgId}`,
      key: userId,
      payload: initialPayload,
      onBroadcast: (event, payload) => {
        if (event === ORG_DB_CHANGED_EVENT) {
          // Server-originated signal (0005 Broadcast-from-Database),
          // dispatched per kind: 0006 debounces per (org, kind) — no kind
          // shadowing — and a member-floor RPC emits BOTH 'policy' and
          // 'roster', so each kind maps to exactly its own plane refresh.
          // A plain-0005 backend still debounces per org, where a burst can
          // shadow one kind behind another and starve that plane forever
          // under narrowed dispatch. There is no capability flag for the
          // per-kind debounce, so every kind also arms a slow trailing full
          // coarse refresh (control-plane TTL cadence): a shadowed plane
          // converges within 5 minutes instead of never.
          if (!broadcastSignals) return;
          const kind = parseOrgDbChangeKind(payload);
          if (!kind) {
            // A kind this build does not know (a newer backend's plane):
            // fall back to the coarse refresh instead of total silence, so
            // an unrecognized plane still converges (Layer-5 default).
            scheduleCoarseSignalRefresh();
            return;
          }
          dispatchDbChangeSignal(orgId, kind);
          return;
        }
        if (event === ORG_CONTROL_CHANGED_EVENT) {
          const kind = parseOrgControlChangeKind(payload);
          if (kind && isDocumentHidden()) return;
          if (kind === "entitlement") {
            resumeOrgIfFloorChanged(orgId);
          } else if (kind === "roster") {
            refetchOrgsBestEffort();
          } else if (kind === "scopes") {
            org2CloudSyncEngine.resumeOrg(orgId);
          } else if (kind === "sessions") {
            // Sent after EVERY successful peer push (250ms sender collapse
            // only) — a streaming teammate makes this a per-push storm, so
            // it must ride the same coalesced plane as the server signal.
            scheduleSessionsPlaneRefresh(orgId);
          }
          return;
        }
        if (event === PRESENCE_VIEW_CHANGED_EVENT) {
          setPresence((current) =>
            applyOrg2CloudPresenceViewChanged(current, orgId, payload)
          );
          return;
        }
        if (event !== COMMENTS_CHANGED_EVENT) return;
        const sessionId = payload.sessionId;
        if (typeof sessionId !== "string" || !sessionId) return;
        if (isDocumentHidden()) return;
        // The open thread stays live; the listing (comment/task counters)
        // rides the coalesced sessions plane so a comment storm cannot
        // re-list the org per broadcast.
        setCommentsSignal((current) =>
          bumpCommentsSignalKey(current, sessionCommentsKey(orgId, sessionId))
        );
        scheduleSessionsPlaneRefresh(orgId);
      },
      onSync: (state) => {
        const byUser: Record<string, Org2CloudPresenceEntry> = {};
        for (const [presenceKey, metas] of Object.entries(state)) {
          const meta = latestPresenceMeta(metas);
          byUser[presenceKey] = {
            userId: presenceKey,
            displayName: String(meta.displayName ?? ""),
            viewingSessionId:
              typeof meta.viewingSessionId === "string"
                ? meta.viewingSessionId
                : null,
            updatedAt: Number.isFinite(Number(meta.updatedAt))
              ? Number(meta.updatedAt)
              : undefined,
          };
        }
        // Presence sync fires for reconnects and same-truth re-tracks too.
        // Keep the previous atom value when the who-views-what roster is
        // semantically unchanged so every presence consumer (sidebar menu
        // tree, viewer chips) skips a full rebuild.
        setPresence((current) =>
          org2CloudPresenceRosterEquals(current[orgId], byUser)
            ? current
            : { ...current, [orgId]: byUser }
        );
      },
      onStatus: (subscribed) => {
        // On 0005 backends this channel carries the change signals, so its
        // edges own the roster-connected indicator and the missed-signal
        // recovery that the dedicated legacy channels' edges owned.
        if (!broadcastSignals) return;
        setRosterRealtimeConnected((current) =>
          current[orgId] === subscribed
            ? current
            : { ...current, [orgId]: subscribed }
        );
        // `org2CloudRealtimeClient` logs CHANNEL_ERROR/TIMED_OUT with the raw
        // status while suppressing normal CLOSED teardown. Do not duplicate
        // that diagnostic here from the lossy boolean edge.
        if (!subscribed) return;
        // The 0005 path previously logged NOTHING on success — "is realtime
        // up" was unanswerable from logs (legacy postgres_changes logs its
        // subscribe at the same spot). One line per true-edge, like legacy.
        log.info(
          `realtime: org broadcast channel subscribed for active org ${orgId}`
        );
        bumpRosterVersion(orgId);
        runSignalEdgeRecovery(orgId);
      },
    });
    handles.set(orgId, handle);
    payloadKeys.set(orgId, org2CloudPresencePayloadKey(initialPayload));
    setOutboundPresence((current) => ({
      ...current,
      [orgId]: {
        viewingSessionId: initialPayload?.viewingSessionId ?? null,
        updatedAt: initialPayload?.updatedAt ?? Date.now(),
        updateCount: (current[orgId]?.updateCount ?? 0) + 1,
      },
    }));
    const unregister = registerCommentsBroadcaster(orgId, (event, payload) =>
      handle.send(event, payload)
    );
    unregisters.push(unregister);
    unregisters.push(
      registerOrgControlBroadcaster(orgId, (event, payload) =>
        handle.send(event, payload)
      )
    );
    return () => {
      for (const unregister of unregisters.splice(0)) unregister();
      for (const [orgId, handle] of handles) {
        handle.leave();
        setPresence((current) => {
          const next = { ...current };
          delete next[orgId];
          return next;
        });
        setOutboundPresence((current) => {
          const next = { ...current };
          delete next[orgId];
          return next;
        });
      }
      handles.clear();
      payloadKeys.clear();
    };
    // Same lifetime contract as Slice B (connection identity via Slice A).
    // `connectionRef` is a stable ref object; listing it keeps
    // exhaustive-deps honest without changing when the effect re-runs.
  }, [
    activeRealtimeOrgId,
    userId,
    endpointUrl,
    broadcastSignals,
    buildPayload,
    setPresence,
    setOutboundPresence,
    setCommentsSignal,
    bumpRemoteSessionsVersion,
    scheduleSessionsPlaneRefresh,
    bumpRosterVersion,
    dispatchDbChangeSignal,
    scheduleCoarseSignalRefresh,
    runSignalEdgeRecovery,
    resumeOrgIfFloorChanged,
    refetchOrgsBestEffort,
    setRosterRealtimeConnected,
    connectionRef,
  ]);

  // Keep awareness attached to the session while this foreground lease owns
  // the active org channel. Blur/visibility teardown removes the entire
  // channel and its Presence meta; navigation updates only the payload within
  // a held lease.
  useEffect(() => {
    for (const [orgId, handle] of presenceHandlesRef.current) {
      const payload = buildPayload(orgId);
      const payloadKey = org2CloudPresencePayloadKey(payload);
      if (
        presencePayloadKeysRef.current.has(orgId) &&
        presencePayloadKeysRef.current.get(orgId) === payloadKey
      ) {
        continue;
      }
      presencePayloadKeysRef.current.set(orgId, payloadKey);
      handle.update(payload);
      const updatedAt = payload?.updatedAt ?? Date.now();
      handle.send(PRESENCE_VIEW_CHANGED_EVENT, {
        userId,
        viewingSessionId: payload?.viewingSessionId ?? null,
        updatedAt,
      });
      setOutboundPresence((current) => ({
        ...current,
        [orgId]: {
          viewingSessionId:
            payload && typeof payload.viewingSessionId === "string"
              ? payload.viewingSessionId
              : null,
          updatedAt,
          updateCount: (current[orgId]?.updateCount ?? 0) + 1,
        },
      }));
    }
  }, [viewing, displayName, userId, buildPayload, setOutboundPresence]);
}

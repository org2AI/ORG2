import { useCallback } from "react";

import type { MobileConnectionState } from "../connection/types";
import type { PermissionBusEnvelope } from "../lib/interactionQueue";
import type { TranscriptSnapshotEnvelope } from "../lib/transcriptLoadState";
import type { MobileRemoteState } from "./useMobileRemoteState";
import { terminalSignalFromBusEvent } from "./useMobileSend";

export function useMobileRpcNotifications(
  state: MobileRemoteState,
  releaseTransport: (close: boolean) => void
) {
  const {
    clientRef,
    permissionRevisionRef,
    activeSessionRef,
    activeConfigRef,
    generationRef,
    scheduleReconnectRef,
    setConnection,
    connectionRef,
    requestSessionList,
    refreshSubscribedSession,
    receiveSnapshot,
    receivePermissionEvent,
    receiveTerminal,
    receiveSendStatus,
  } = state;
  const handleRpcNotification = useCallback(
    (method: string, params: Record<string, unknown> | undefined) => {
      if (method === "interaction/pending_changed") {
        permissionRevisionRef.current++;
        return;
      }
      if (method === "relay/presence") {
        const previous = connectionRef.current;
        const next: MobileConnectionState = {
          ...previous,
          presence: params?.online === true ? "online" : "offline",
        };
        // Relay can retain the phone socket while replacing the Desktop actor.
        // Presence is an invalidation edge, not just a status-dot update. Write
        // the edge synchronously so duplicate notifications cannot refresh twice.
        connectionRef.current = next;
        setConnection(next);
        const client = clientRef.current;
        if (
          client &&
          previous.status === "connected" &&
          previous.presence !== "online" &&
          next.presence === "online"
        ) {
          // Roster failures keep the authenticated transport and recover through
          // the bounded list owner, independently of the online presence dot.
          const generation = generationRef.current;
          void requestSessionList(client).catch((error: unknown) => {
            // A recreated relay actor can lose initialize state while keeping
            // the phone socket. Only that authorization failure needs handshake
            // recovery; ordinary roster failures stay with the list retry owner.
            if (
              !(
                error &&
                typeof error === "object" &&
                "code" in error &&
                (error.code === -32001 || error.code === 401)
              ) ||
              clientRef.current !== client ||
              generationRef.current !== generation ||
              connectionRef.current.presence !== "online"
            )
              return;
            const config = activeConfigRef.current;
            if (!config || config.pairingCode) return;
            releaseTransport(true);
            setConnection((prev) => ({
              ...prev,
              status: "connecting",
              presence: "offline",
            }));
            scheduleReconnectRef.current(config, generation);
          });
          // Desktop's recreated actor also lost its active transcript subscription.
          if (activeSessionRef.current)
            refreshSubscribedSession(activeSessionRef.current);
        }
        return;
      }
      if (method === "orgii/event") {
        const envelope = params?.envelope as PermissionBusEnvelope | undefined;
        if (envelope) {
          receivePermissionEvent(envelope);
        }
        const terminal = terminalSignalFromBusEvent(params);
        if (terminal) {
          if (terminal.sessionId === activeSessionRef.current) {
            refreshSubscribedSession(terminal.sessionId);
          }
          receiveTerminal(terminal);
        }
        return;
      }
      if (method === "orgii/snapshot") {
        receiveSnapshot(params as TranscriptSnapshotEnvelope);
        return;
      }
      if (method === "session/send_status") {
        const sessionId = receiveSendStatus(params);
        if (sessionId) refreshSubscribedSession(sessionId);
        return;
      }
      if (method === "session/list_changed") {
        const client = clientRef.current;
        if (client) {
          // Keep the previous successful list visible during invalidation.
          // The list owner exposes errors and retries; generation guards
          // prevent an old desktop reply from winning.
          void requestSessionList(client).catch(() => undefined);
        }
      }
    },
    [
      permissionRevisionRef,
      connectionRef,
      setConnection,
      clientRef,
      requestSessionList,
      activeSessionRef,
      activeConfigRef,
      generationRef,
      releaseTransport,
      scheduleReconnectRef,
      refreshSubscribedSession,
      receivePermissionEvent,
      receiveTerminal,
      receiveSnapshot,
      receiveSendStatus,
    ]
  );

  return handleRpcNotification;
}

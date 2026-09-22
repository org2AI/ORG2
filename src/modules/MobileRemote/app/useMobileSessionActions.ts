import { useCallback } from "react";

import type { PermissionSheetRequest } from "@src/components/PermissionPrompt";

import { isPendingPermissions } from "../connection/sessionDiscoveryContract";
import { DEMO_SESSIONS } from "../demo/demoFixtures";
import type { MobileRemoteState } from "./useMobileRemoteState";

export function useMobileSessionActions(state: MobileRemoteState) {
  const {
    clientRef,
    permissionRevisionRef,
    activeSessionRef,
    connection,
    connectionRef,
    readStateSync,
    sessionsHasMore,
    requestSessionList,
    resetSessions,
    releaseOpening,
    beginLoad,
    resetTranscript,
    showDemoTranscript,
    failLoad,
    requestSessionSnapshot,
    requireWritableClient,
    reconcileSessionPermissions,
    refreshSessionModel,
    resetSessionModel,
    resetSend,
  } = state;
  const refreshSessions = useCallback(async () => {
    if (connection.demoMode) {
      resetSessions(DEMO_SESSIONS);
      return;
    }
    const client = clientRef.current;
    if (!client || connection.presence !== "online") return;
    readStateSync.refresh();
    await requestSessionList(client, false, true);
  }, [
    connection.demoMode,
    connection.presence,
    clientRef,
    readStateSync,
    requestSessionList,
    resetSessions,
  ]);

  const loadMoreSessions = useCallback(async () => {
    const client = clientRef.current;
    if (!client || connection.presence !== "online" || !sessionsHasMore) return;
    await requestSessionList(client, true);
  }, [clientRef, connection.presence, sessionsHasMore, requestSessionList]);

  const subscribeSession = useCallback(
    async (sessionId: string) => {
      activeSessionRef.current = sessionId;
      resetSend();
      const subscriptionGeneration = beginLoad(sessionId);
      const currentConnection = connectionRef.current;
      if (currentConnection.demoMode) {
        showDemoTranscript(sessionId);
        await refreshSessionModel(sessionId);
        return;
      }
      const client = clientRef.current;
      if (!client || currentConnection.presence !== "online") {
        const error = new Error("Desktop is offline");
        failLoad(sessionId, subscriptionGeneration, error.message);
        throw error;
      }
      const applied = await requestSessionSnapshot(
        client,
        sessionId,
        subscriptionGeneration
      );
      if (!applied) return;
      const canonicalId = activeSessionRef.current;
      if (!canonicalId || clientRef.current !== client) return;
      // Model hydration must progress even when permission recovery stalls/fails.
      const modelReady = refreshSessionModel(canonicalId);
      if (currentConnection.capabilities?.pendingInteractions) {
        const revision = permissionRevisionRef.current;
        const pending = await client
          .call<{
            interactions: PermissionSheetRequest[];
            complete: boolean;
          }>("interaction/pending", { sessionId: canonicalId })
          .catch(() => null);
        if (
          clientRef.current === client &&
          activeSessionRef.current === canonicalId &&
          revision === permissionRevisionRef.current &&
          pending?.complete &&
          isPendingPermissions(pending.interactions)
        ) {
          reconcileSessionPermissions(canonicalId, pending.interactions);
        }
      }
      await modelReady;
    },
    [
      activeSessionRef,
      resetSend,
      beginLoad,
      connectionRef,
      clientRef,
      requestSessionSnapshot,
      refreshSessionModel,
      showDemoTranscript,
      failLoad,
      permissionRevisionRef,
      reconcileSessionPermissions,
    ]
  );

  const unsubscribeSession = useCallback(async () => {
    const sessionId = activeSessionRef.current;
    const releasedOpening = releaseOpening();
    activeSessionRef.current = null;
    resetTranscript();
    resetSend();
    resetSessionModel();
    const currentConnection = connectionRef.current;
    if (currentConnection.demoMode || !sessionId || releasedOpening) return;
    if (clientRef.current && currentConnection.presence === "online") {
      await clientRef.current.call("session/unsubscribe", { sessionId });
    }
  }, [
    activeSessionRef,
    releaseOpening,
    resetTranscript,
    resetSend,
    resetSessionModel,
    connectionRef,
    clientRef,
  ]);

  const openSessionFileInDesktop = useCallback(
    async (
      sessionId: string,
      roundId: string,
      eventId: string,
      targetIndex: number
    ) => {
      if (!sessionId || !roundId || !eventId) return;
      if (connection.demoMode) {
        throw new Error("Desktop file navigation is unavailable in demo mode");
      }
      await requireWritableClient().call("session/open_file", {
        sessionId,
        roundId,
        eventId,
        targetIndex,
      });
    },
    [connection.demoMode, requireWritableClient]
  );

  const stopSession = useCallback(
    async (sessionId: string) => {
      if (connection.demoMode) return;
      await requireWritableClient().call("session/cancel", { sessionId });
    },
    [connection.demoMode, requireWritableClient]
  );

  return {
    refreshSessions,
    loadMoreSessions,
    subscribeSession,
    unsubscribeSession,
    openSessionFileInDesktop,
    stopSession,
  };
}

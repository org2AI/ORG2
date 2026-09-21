import React, { useCallback, useEffect, useMemo } from "react";

import { createLogger } from "@src/hooks/logger";

import { MobileComposerDraftContext } from "../components/composer/MobileComposerDraftContext";
import { mobileComposerDesktopScope } from "../components/composer/mobileComposerDraftStore";
import { toMobileRpcError } from "../connection/mobileRpcClient";
import { MobileConnectionAuthorizationError } from "../connection/types";
import type { MobileConnectionConfig } from "../connection/types";
import { DEMO_DESKTOP_NAME, DEMO_SESSIONS } from "../demo/demoFixtures";
import {
  MobileRemoteContext,
  type MobileRemoteContextValue,
  type MobileRemoteProvidersProps,
} from "./MobileRemoteContext";
import {
  SupersededConnectionError,
  useMobileConnectionEstablish,
} from "./useMobileConnectionEstablish";
import { useMobileRemoteState } from "./useMobileRemoteState";
import { useMobileRpcNotifications } from "./useMobileRpcNotifications";
import { useMobileSessionActions } from "./useMobileSessionActions";

export { useMobileRemote } from "./MobileRemoteContext";
export type {
  MobileRemoteContextValue,
  MobileRemoteProvidersProps,
} from "./MobileRemoteContext";

export type { MobileSendStatus } from "./useMobileSend";

export function MobileRemoteProviders({
  children,
  authUserId,
  relayUrl,
  demoByDefault = true,
  suppressInitialBootstrap = false,
}: MobileRemoteProvidersProps) {
  const state = useMobileRemoteState({
    authUserId,
    relayUrl,
    demoByDefault,
    suppressInitialBootstrap,
  });
  const {
    platform,
    draftStore,
    preparationRef,
    clientRef,
    rpc,
    setRpc,
    socketRef,
    activeSessionRef,
    unsubscribeRpcRef,
    activeConfigRef,
    generationRef,
    selectionIntentRef,
    retryFlightRef,
    recoverRef,
    reconnect,
    connectionWriteChainRef,
    inventoryRevisionRef,
    scheduleReconnectRef,
    connection,
    setConnection,
    connectionConfig,
    setConnectionConfig,
    bootstrapPending,
    setBootstrapPending,
    pairedDesktops,
    setPairedDesktops,
    readStateSync,
    sessions,
    sessionsHasMore,
    rosterPhase,
    suspendSessionList,
    resetSessions,
    openingClient,
    openedSession,
    transcript,
    transcriptView,
    resetTranscript,
    showDemoTranscript,
    invalidateTranscriptRequests,
    selectRound,
    retrySelectedRound,
    activePermission,
    focusPermission,
    permissionQueueDepth,
    permissionSubmitting,
    permissionFailed,
    respondPermission,
    dismissPermissionHead,
    resetPermissions,
    pendingInbox,
    sessionModel,
    refreshSessionModel,
    loadSessionModels,
    setSessionModel,
    sendStatus,
    resetSend,
    sendMessage,
  } = state;
  const persistConnection = useCallback(
    (config: MobileConnectionConfig | null) => {
      const generation = generationRef.current;
      const inventoryRevision = ++inventoryRevisionRef.current;
      const operation = connectionWriteChainRef.current.then(async () => {
        if (generation !== generationRef.current) return;
        await platform.connection.save(authUserId, config);
        void platform.connection
          .listPairedDesktops(authUserId)
          .then((inventory) => {
            if (
              generation === generationRef.current &&
              inventoryRevision === inventoryRevisionRef.current
            )
              setPairedDesktops(inventory);
          })
          .catch(() => undefined);
      });
      connectionWriteChainRef.current = operation.catch(() => undefined);
      return operation;
    },
    [
      authUserId,
      connectionWriteChainRef,
      generationRef,
      inventoryRevisionRef,
      platform.connection,
      setPairedDesktops,
    ]
  );

  const clearReconnectTimer = useCallback(() => reconnect.clear(), [reconnect]);

  const releaseTransport = useCallback(
    (close: boolean) => {
      reconnect.invalidate();
      suspendSessionList();
      preparationRef.current?.abort();
      preparationRef.current = null;
      // Invalidate every in-flight subscribe/refresh from the old socket before
      // it can reject or resolve into the retained logical session state.
      invalidateTranscriptRequests();
      unsubscribeRpcRef.current?.();
      unsubscribeRpcRef.current = null;
      const client = clientRef.current;
      clientRef.current = null;
      setRpc(null);
      const socket = socketRef.current;
      socketRef.current = null;
      if (close) {
        if (client) client.close();
        else socket?.close();
      }
    },
    [
      reconnect,
      suspendSessionList,
      preparationRef,
      invalidateTranscriptRequests,
      unsubscribeRpcRef,
      clientRef,
      setRpc,
      socketRef,
    ]
  );

  const enterDemoMode = useCallback(() => {
    selectionIntentRef.current += 1;
    generationRef.current += 1;
    clearReconnectTimer();
    activeConfigRef.current = null;
    setConnectionConfig(null);
    releaseTransport(true);
    setConnection({
      status: "connected",
      presence: "online",
      desktopName: DEMO_DESKTOP_NAME,
      tier: "full",
      capabilities: { roundHistory: true, openSessionFile: false },
      demoMode: true,
    });
    resetSessions(DEMO_SESSIONS);
    showDemoTranscript(activeSessionRef.current ?? "demo");
    resetSend();
    resetPermissions();
  }, [
    selectionIntentRef,
    generationRef,
    clearReconnectTimer,
    activeConfigRef,
    setConnectionConfig,
    releaseTransport,
    setConnection,
    resetSessions,
    showDemoTranscript,
    activeSessionRef,
    resetSend,
    resetPermissions,
  ]);

  const handleRpcNotification = useMobileRpcNotifications(
    state,
    releaseTransport
  );
  const establishConnection = useMobileConnectionEstablish(
    state,
    authUserId,
    persistConnection,
    releaseTransport,
    handleRpcNotification
  );
  const runReconnect = useCallback(
    async (config: MobileConnectionConfig, generation: number) => {
      if (generation !== generationRef.current || platform.runtime.isHidden()) {
        return;
      }
      setConnection((prev) => ({
        ...prev,
        status: "connecting",
        presence: "offline",
        // Preserve the last failure until initialize succeeds, so backoff and
        // in-flight retries do not erase the user's explanation every attempt.
      }));
      try {
        await establishConnection(config, generation);
      } catch (error) {
        if (
          generation !== generationRef.current ||
          error instanceof SupersededConnectionError
        )
          return;
        const retryConfig = activeConfigRef.current;
        const denied = error instanceof MobileConnectionAuthorizationError;
        const retryable = !denied && retryConfig && !retryConfig.pairingCode;
        if (!retryable) activeConfigRef.current = null;
        setConnection((prev) => ({
          ...prev,
          status: retryable ? "connecting" : "error",
          presence: "offline",
          error: toMobileRpcError(error),
        }));
        if (retryable) scheduleReconnectRef.current(retryConfig, generation);
      }
    },
    [
      activeConfigRef,
      establishConnection,
      generationRef,
      platform.runtime,
      scheduleReconnectRef,
      setConnection,
    ]
  );

  recoverRef.current = runReconnect;
  scheduleReconnectRef.current = reconnect.schedule;

  const connectLive = useCallback(
    async (config: MobileConnectionConfig) => {
      setBootstrapPending(false);
      selectionIntentRef.current += 1;
      generationRef.current += 1;
      const generation = generationRef.current;
      clearReconnectTimer();
      releaseTransport(true);
      reconnect.reset();
      resetSessions();
      resetPermissions();
      resetSend();
      activeConfigRef.current = config;
      setConnectionConfig(config);
      setConnection((prev) => ({
        ...prev,
        status: "connecting",
        presence: "unknown",
        demoMode: false,
        error: undefined,
      }));
      let configurationSaved = false;
      try {
        await persistConnection(config);
        configurationSaved = true;
        if (generation !== generationRef.current) {
          throw new Error("Connection was superseded");
        }
        await establishConnection(config, generation);
      } catch (error) {
        if (
          generation === generationRef.current &&
          !(error instanceof SupersededConnectionError)
        ) {
          const retryConfig = activeConfigRef.current;
          const retryable =
            configurationSaved &&
            !(error instanceof MobileConnectionAuthorizationError) &&
            retryConfig &&
            !retryConfig.pairingCode;
          if (!retryable) activeConfigRef.current = null;
          setConnection({
            status: retryable ? "connecting" : "error",
            presence: "offline",
            demoMode: false,
            error: toMobileRpcError(error),
          });
          if (retryable) scheduleReconnectRef.current(retryConfig, generation);
        }
        throw error;
      }
    },
    [
      setBootstrapPending,
      selectionIntentRef,
      generationRef,
      clearReconnectTimer,
      releaseTransport,
      reconnect,
      resetSessions,
      resetPermissions,
      resetSend,
      activeConfigRef,
      setConnectionConfig,
      setConnection,
      persistConnection,
      establishConnection,
      scheduleReconnectRef,
    ]
  );

  // User-directed recovery preserves the selected pairing. It deliberately uses
  // the same authenticated handshake as first connect; policy errors never loop.
  const retryConnection = useCallback((): Promise<boolean> => {
    if (retryFlightRef.current) return retryFlightRef.current;
    const intent = ++selectionIntentRef.current;
    const operation = Promise.resolve().then(async () => {
      if (intent !== selectionIntentRef.current) return false;
      let config = connectionConfig;
      if (!config) {
        setBootstrapPending(true);
        try {
          config = relayUrl?.trim()
            ? { wsUrl: relayUrl.trim() }
            : await platform.connection.load(authUserId);
        } catch (error) {
          if (intent === selectionIntentRef.current) {
            setBootstrapPending(false);
            setConnection({
              status: "error",
              presence: "offline",
              demoMode: false,
              error: toMobileRpcError(error),
            });
          }
          throw error;
        }
        if (intent !== selectionIntentRef.current) return false;
        setBootstrapPending(false);
      }
      if (!config) {
        setConnection({
          status: "disconnected",
          presence: "unknown",
          demoMode: false,
        });
        return false;
      }
      await connectLive(config);
      return true;
    });
    retryFlightRef.current = operation;
    const settled = () => {
      if (retryFlightRef.current === operation) retryFlightRef.current = null;
    };
    void operation.then(settled, settled);
    return operation;
  }, [
    authUserId,
    connectLive,
    connectionConfig,
    platform.connection,
    relayUrl,
    retryFlightRef,
    selectionIntentRef,
    setBootstrapPending,
    setConnection,
  ]);

  const disconnect = useCallback(async () => {
    draftStore.clearDesktop(
      mobileComposerDesktopScope(activeConfigRef.current, connection)
    );
    setBootstrapPending(false);
    selectionIntentRef.current += 1;
    generationRef.current += 1;
    clearReconnectTimer();
    activeConfigRef.current = null;
    setConnectionConfig(null);
    releaseTransport(true);
    activeSessionRef.current = null;
    setConnection({
      status: "disconnected",
      presence: "unknown",
      demoMode: false,
    });
    resetSessions();
    resetTranscript();
    resetSend();
    resetPermissions();
    const generation = generationRef.current;
    try {
      await persistConnection(null);
    } catch (error) {
      if (generation === generationRef.current) {
        setConnection({
          status: "error",
          presence: "offline",
          demoMode: false,
          error: toMobileRpcError(error),
        });
      }
      throw error;
    }
  }, [
    draftStore,
    activeConfigRef,
    connection,
    setBootstrapPending,
    selectionIntentRef,
    generationRef,
    clearReconnectTimer,
    setConnectionConfig,
    releaseTransport,
    activeSessionRef,
    setConnection,
    resetSessions,
    resetTranscript,
    resetSend,
    resetPermissions,
    persistConnection,
  ]);

  const switchPairedDesktop = useCallback(
    async (desktopId: string) => {
      const selectionIntent = ++selectionIntentRef.current;
      const config = await platform.connection.selectPairedDesktop(
        authUserId,
        desktopId
      );
      if (selectionIntent !== selectionIntentRef.current) return;
      if (!config) throw new Error("Paired desktop is unavailable");
      await connectLive(config);
    },
    [authUserId, connectLive, platform.connection, selectionIntentRef]
  );

  const {
    refreshSessions,
    loadMoreSessions,
    subscribeSession,
    unsubscribeSession,
    openSessionFileInDesktop,
    stopSession,
  } = useMobileSessionActions(state);
  useEffect(() => {
    const handleVisible = () => {
      const config = activeConfigRef.current;
      clearReconnectTimer();
      if (platform.runtime.isHidden()) {
        preparationRef.current?.abort();
        if (clientRef.current || socketRef.current) {
          releaseTransport(true);
          setConnection((previous) => ({
            ...previous,
            status: "connecting",
            presence: "offline",
            error: undefined,
          }));
        }
        return;
      }
      if (config && !clientRef.current) {
        void reconnect
          .run(config, generationRef.current)
          .catch((error) => logger.warn("Background operation failed", error));
      }
    };
    return platform.runtime.subscribeVisibility(handleVisible);
  }, [
    clearReconnectTimer,
    platform.runtime,
    releaseTransport,
    reconnect,
    activeConfigRef,
    clientRef,
    preparationRef,
    socketRef,
    setConnection,
    generationRef,
  ]);

  useEffect(() => {
    if (suppressInitialBootstrap) {
      return () => {
        selectionIntentRef.current += 1;
        generationRef.current += 1;
        clearReconnectTimer();
        releaseTransport(true);
      };
    }
    let disposed = false;
    const bootstrapGeneration = generationRef.current;
    void (async () => {
      // Inventory is ancillary; it must not delay restoration of the selected device.
      void platform.connection
        .listPairedDesktops(authUserId)
        .then((inventory) => {
          if (!disposed && bootstrapGeneration === generationRef.current)
            setPairedDesktops(inventory);
        })
        .catch(() => undefined);
      const config = relayUrl?.trim()
        ? { wsUrl: relayUrl.trim() }
        : await platform.connection.load(authUserId);
      if (disposed || bootstrapGeneration !== generationRef.current) {
        return;
      }
      setConnectionConfig(config);
      setBootstrapPending(false);
      if (config?.wsUrl || config?.host) {
        await connectLive(config).catch(() => undefined);
      } else if (demoByDefault) {
        enterDemoMode();
      }
    })().catch((error) => {
      if (disposed || bootstrapGeneration !== generationRef.current) return;
      setBootstrapPending(false);
      setConnection({
        status: "error",
        presence: "offline",
        demoMode: false,
        error: toMobileRpcError(error),
      });
    });
    return () => {
      disposed = true;
      selectionIntentRef.current += 1;
      generationRef.current += 1;
      clearReconnectTimer();
      releaseTransport(true);
    };
    // Mount-only bootstrap; callbacks are stable over the provider lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo<MobileRemoteContextValue>(
    () => ({
      pendingInbox,
      focusPermission,
      bootstrapPending,
      connection,
      sessions,
      rosterPhase,
      transcriptItems: transcriptView.items,
      transcriptPhase: transcriptView.phase,
      transcriptSessionId: transcript.sessionId,
      openedSession,
      openingReady:
        openingClient === clientRef.current &&
        (transcript.indexPhase === "ready" ||
          transcript.indexPhase === "empty"),
      transcriptError: transcriptView.error,
      transcriptTruncated: transcriptView.truncated,
      transcriptRounds: transcript.rounds,
      transcriptRoundsComplete: transcript.roundsComplete,
      selectedRoundId: transcript.selectedRoundId,
      activeRoundId: transcriptView.roundId,
      sendStatus,
      activePermission,
      permissionQueueDepth,
      permissionSubmitting,
      permissionFailed,
      rpc,
      readStateSync,
      connectionConfig,
      pairedDesktops,
      connectLive,
      retryConnection,
      switchPairedDesktop,
      enterDemoMode,
      disconnect,
      refreshSessions,
      loadMoreSessions,
      sessionsHasMore,
      subscribeSession,
      unsubscribeSession,
      selectRound,
      retrySelectedRound,
      sendMessage,
      openSessionFileInDesktop,
      respondPermission,
      dismissPermissionHead,
      stopSession,
      sessionModel,
      refreshSessionModel,
      loadSessionModels,
      setSessionModel,
    }),
    [
      pendingInbox,
      focusPermission,
      bootstrapPending,
      connection,
      sessions,
      rosterPhase,
      transcriptView.items,
      transcriptView.phase,
      transcriptView.error,
      transcriptView.truncated,
      transcriptView.roundId,
      transcript.sessionId,
      transcript.indexPhase,
      transcript.rounds,
      transcript.roundsComplete,
      transcript.selectedRoundId,
      openedSession,
      openingClient,
      clientRef,
      sendStatus,
      activePermission,
      permissionQueueDepth,
      permissionSubmitting,
      permissionFailed,
      rpc,
      readStateSync,
      connectionConfig,
      pairedDesktops,
      connectLive,
      retryConnection,
      switchPairedDesktop,
      enterDemoMode,
      disconnect,
      refreshSessions,
      loadMoreSessions,
      sessionsHasMore,
      subscribeSession,
      unsubscribeSession,
      selectRound,
      retrySelectedRound,
      sendMessage,
      openSessionFileInDesktop,
      respondPermission,
      dismissPermissionHead,
      stopSession,
      sessionModel,
      refreshSessionModel,
      loadSessionModels,
      setSessionModel,
    ]
  );

  return (
    <MobileRemoteContext.Provider value={value}>
      <MobileComposerDraftContext.Provider value={draftStore}>
        {children}
      </MobileComposerDraftContext.Provider>
    </MobileRemoteContext.Provider>
  );
}

MobileRemoteProviders.displayName = "MobileRemoteProviders";

const logger = createLogger("MobileRemoteProviders");

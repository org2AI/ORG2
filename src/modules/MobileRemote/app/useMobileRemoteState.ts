import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { MobileAuthContext } from "../auth/MobileAuthContext";
import {
  createMobileComposerDraftStore,
  mobileComposerDesktopScope,
} from "../components/composer/mobileComposerDraftStore";
import { type MobileRpcClient } from "../connection/mobileRpcClient";
import { prefetchMobileSessionIdentities } from "../connection/mobileSessionIdentityCache";
import { createRemoteReconnectController } from "../connection/remoteReconnectController";
import type {
  MobileConnectionConfig,
  MobileConnectionState,
  MobilePairedDesktopSummary,
  MobileSessionRow,
} from "../connection/types";
import { DEMO_PERMISSION_REQUEST } from "../demo/demoFixtures";
import { useMobileRemotePlatform } from "../platform";
import type { MobileRemoteProvidersProps } from "./MobileRemoteContext";
import { useMobilePendingInbox } from "./useMobilePendingInbox";
import { useMobilePermissions } from "./useMobilePermissions";
import { useMobileReadStateSync } from "./useMobileReadStateSync";
import { useMobileSend } from "./useMobileSend";
import { useMobileSessionList } from "./useMobileSessionList";
import { useMobileSessionModel } from "./useMobileSessionModel";
import { useMobileTranscript } from "./useMobileTranscript";

export function useMobileRemoteState({
  authUserId,
  relayUrl,
  demoByDefault = true,
  suppressInitialBootstrap = false,
}: Omit<MobileRemoteProvidersProps, "children">) {
  const platform = useMobileRemotePlatform();
  const auth = useContext(MobileAuthContext);
  const draftScope = JSON.stringify([
    authUserId,
    auth?.session.supabaseUrl,
    relayUrl,
  ]);
  const draftStore = useMemo(() => {
    // A new authenticated desktop scope owns a fresh draft store.
    void draftScope;
    return createMobileComposerDraftStore();
  }, [draftScope]);
  useEffect(() => () => draftStore.clear(), [draftStore]);
  const authRef = useRef(auth);
  useLayoutEffect(() => {
    authRef.current = auth;
  }, [auth]);
  const preparationRef = useRef<AbortController | null>(null);
  const clientRef = useRef<MobileRpcClient | null>(null);
  const [rpc, setRpc] = useState<MobileRpcClient | null>(null);
  const permissionRevisionRef = useRef(0);
  const socketRef = useRef<WebSocket | null>(null);
  const activeSessionRef = useRef<string | null>(null);
  const unsubscribeRpcRef = useRef<(() => void) | null>(null);
  const activeConfigRef = useRef<MobileConnectionConfig | null>(null);
  const generationRef = useRef(0);
  const selectionIntentRef = useRef(0);
  const retryFlightRef = useRef<Promise<boolean> | null>(null);
  const recoverRef = useRef<
    (config: MobileConnectionConfig, generation: number) => Promise<void>
  >(async () => undefined);
  const isCurrentGeneration = useCallback(
    (generation: number) => generation === generationRef.current,
    []
  );
  const recoverConnection = useCallback(
    (config: MobileConnectionConfig, generation: number) =>
      recoverRef.current(config, generation),
    []
  );
  const reconnect = useMemo(
    () =>
      createRemoteReconnectController(
        platform.runtime,
        // Factory stores this predicate; it only reads refs when a recovery runs.
        // eslint-disable-next-line react-hooks/refs
        isCurrentGeneration,
        // Factory stores this callback without invoking it during render.
        // eslint-disable-next-line react-hooks/refs
        recoverConnection
      ),
    [platform.runtime, isCurrentGeneration, recoverConnection]
  );
  const connectionWriteChainRef = useRef<Promise<void>>(Promise.resolve());
  const inventoryRevisionRef = useRef(0);
  const scheduleReconnectRef = useRef<
    (config: MobileConnectionConfig, generation: number) => void
  >(() => undefined);

  const [connection, setConnection] = useState<MobileConnectionState>({
    status: "disconnected",
    presence: "unknown",
    demoMode: demoByDefault && !suppressInitialBootstrap,
  });
  const [connectionConfig, setConnectionConfig] =
    useState<MobileConnectionConfig | null>(null);
  const [bootstrapPending, setBootstrapPending] = useState(
    !suppressInitialBootstrap
  );
  const [pairedDesktops, setPairedDesktops] = useState<
    MobilePairedDesktopSummary[]
  >([]);
  const connectionRef = useRef(connection);
  useLayoutEffect(() => {
    connectionRef.current = connection;
  }, [connection]);
  const readStateSync = useMobileReadStateSync(
    connection.status === "connected" &&
      connection.presence === "online" &&
      connection.capabilities?.sessionReadState === true
      ? rpc
      : null,
    JSON.stringify([
      authUserId,
      auth?.session.supabaseUrl,
      mobileComposerDesktopScope(connectionConfig, connection),
    ])
  );
  const prepareLegacySessionIdentities = useCallback(
    (
      client: MobileRpcClient,
      sessions: readonly MobileSessionRow[],
      isCurrent: () => boolean
    ) => {
      const capabilities = connectionRef.current.capabilities;
      if (
        capabilities?.sessionIdentity !== true ||
        capabilities.sessionOpen === true
      ) {
        return;
      }
      // The authenticated client owns this bounded background batch. Route
      // opening shares its single-flight entries; disconnect/hidden state
      // prevents workers from taking more items, and misses retry on demand.
      return prefetchMobileSessionIdentities(client, sessions, () => {
        const current = connectionRef.current;
        return (
          isCurrent() &&
          clientRef.current === client &&
          current.status === "connected" &&
          current.presence === "online" &&
          !platform.runtime.isHidden()
        );
      });
    },
    [platform.runtime]
  );
  const {
    sessions,
    sessionsHasMore,
    rosterPhase,
    requestSessionList,
    resetSessions,
    suspendSessionList,
  } = useMobileSessionList(
    clientRef,
    prepareLegacySessionIdentities,
    platform.runtime
  );
  const {
    openingClient,
    openedSession,
    releaseOpening,
    transcript,
    setTranscript,
    transcriptView,
    beginLoad,
    resetTranscript,
    showDemoTranscript,
    failLoad,
    invalidateTranscriptRequests,
    requestSessionSnapshot,
    refreshSubscribedSession,
    receiveSnapshot,
    selectRound,
    retrySelectedRound,
  } = useMobileTranscript({
    clientRef,
    connectionRef,
    activeSessionRef,
    connection,
  });
  const requireWritableClient = useCallback((): MobileRpcClient => {
    const client = clientRef.current;
    if (
      !client ||
      connection.status !== "connected" ||
      connection.presence !== "online"
    ) {
      throw new Error("Desktop is offline");
    }
    if (connection.tier === "read_only") {
      throw new Error("This device has read-only access");
    }
    return client;
  }, [connection.presence, connection.status, connection.tier]);

  const {
    activePermission,
    focusPermission,
    permissionQueueDepth,
    permissionSubmitting,
    permissionFailed,
    respondPermission,
    dismissPermissionHead,
    resetPermissions,
    receivePermissionEvent,
    reconcilePermissions,
    reconcileSessionPermissions,
  } = useMobilePermissions({
    sessionId: transcript.sessionId,
    demoMode: connection.demoMode,
    requireWritableClient,
  });

  const pendingInbox = useMobilePendingInbox({
    client: rpc,
    scope: JSON.stringify([
      authUserId,
      relayUrl,
      connectionConfig?.desktopId ?? connection.desktopId,
      connectionConfig?.host,
      connectionConfig?.port,
    ]),
    online:
      connection.status === "connected" && connection.presence === "online",
    supported: connection.capabilities?.pendingInteractions === true,
    runtime: platform.runtime,
    onSnapshot: reconcilePermissions,
  });

  const {
    sessionModel,
    refreshSessionModel,
    loadSessionModels,
    setSessionModel,
    resetSessionModel,
  } = useMobileSessionModel({
    clientRef,
    connectionRef,
    activeSessionRef,
    requireWritableClient,
  });

  const onDemoSend = useCallback(
    (sessionId: string) =>
      resetPermissions([{ ...DEMO_PERMISSION_REQUEST, sessionId }]),
    [resetPermissions]
  );
  const {
    sendStatus,
    resetSend,
    receiveTerminal,
    receiveSendStatus,
    sendMessage,
  } = useMobileSend({
    demoMode: connection.demoMode,
    runtime: platform.runtime,
    model: sessionModel.config?.model,
    requireWritableClient,
    setTranscript,
    onDemoSend,
  });

  return {
    platform,
    auth,
    draftStore,
    authRef,
    preparationRef,
    clientRef,
    rpc,
    setRpc,
    permissionRevisionRef,
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
    connectionRef,
    readStateSync,
    sessions,
    sessionsHasMore,
    rosterPhase,
    suspendSessionList,
    requestSessionList,
    resetSessions,
    openingClient,
    openedSession,
    releaseOpening,
    transcript,
    setTranscript,
    transcriptView,
    beginLoad,
    resetTranscript,
    showDemoTranscript,
    failLoad,
    invalidateTranscriptRequests,
    requestSessionSnapshot,
    refreshSubscribedSession,
    receiveSnapshot,
    selectRound,
    retrySelectedRound,
    requireWritableClient,
    activePermission,
    focusPermission,
    permissionQueueDepth,
    permissionSubmitting,
    permissionFailed,
    respondPermission,
    dismissPermissionHead,
    resetPermissions,
    receivePermissionEvent,
    reconcilePermissions,
    reconcileSessionPermissions,
    pendingInbox,
    sessionModel,
    refreshSessionModel,
    loadSessionModels,
    setSessionModel,
    resetSessionModel,
    onDemoSend,
    sendStatus,
    resetSend,
    receiveTerminal,
    receiveSendStatus,
    sendMessage,
  };
}
export type MobileRemoteState = ReturnType<typeof useMobileRemoteState>;

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { PermissionSheetRequest } from "@src/components/PermissionPrompt";

import { MobileAuthContext } from "../auth/MobileAuthContext";
import {
  type MobileRpcClient,
  createMobileRpcClient,
  toMobileRpcError,
} from "../connection/mobileRpcClient";
import { createRemoteReconnectController } from "../connection/remoteReconnectController";
import { resolveMobileDeviceLabel } from "../connection/resolveMobileDeviceLabel";
import { MobileConnectionAuthorizationError } from "../connection/types";
import type {
  InitializeResult,
  MobileConnectionConfig,
  MobileConnectionState,
  MobileModelOption,
  MobilePairedDesktopSummary,
  MobileSendAttachment,
  MobileSessionModelState,
  MobileSessionRow,
} from "../connection/types";
import {
  DEMO_DESKTOP_NAME,
  DEMO_PERMISSION_REQUEST,
  DEMO_SESSIONS,
} from "../demo/demoFixtures";
import type { PermissionBusEnvelope } from "../lib/interactionQueue";
import type {
  TranscriptLoadPhase,
  TranscriptRoundSummary,
  TranscriptSnapshotEnvelope,
} from "../lib/transcriptLoadState";
import type { TranscriptItem } from "../lib/transcriptReducer";
import { useMobileRemotePlatform } from "../platform";
import type { MobileRemoteRuntimePort } from "../platform/types";
import { useMobilePermissions } from "./useMobilePermissions";
import {
  type MobileSendStatus,
  terminalSignalFromBusEvent,
  useMobileSend,
} from "./useMobileSend";
import { useMobileSessionList } from "./useMobileSessionList";
import { useMobileSessionModel } from "./useMobileSessionModel";
import { useMobileTranscript } from "./useMobileTranscript";

export type { MobileSendStatus } from "./useMobileSend";

const CONNECT_TIMEOUT_MS = 15_000;
const PAIRING_TIMEOUT_MS = 130_000;

export interface MobileRemoteContextValue {
  connection: MobileConnectionState;
  sessions: MobileSessionRow[];
  transcriptItems: TranscriptItem[];
  transcriptPhase: TranscriptLoadPhase;
  transcriptError?: string;
  transcriptTruncated: boolean;
  transcriptRounds: TranscriptRoundSummary[];
  transcriptRoundsComplete: boolean;
  /** Null means follow the latest round as the index grows. */
  selectedRoundId: string | null;
  activeRoundId: string | null;
  sendStatus: MobileSendStatus | null;
  activePermission: PermissionSheetRequest | null;
  permissionQueueDepth: number;
  /** True while an answer is on the wire; the sheet must stay disabled. */
  permissionSubmitting: boolean;
  rpc: MobileRpcClient | null;
  connectionConfig: MobileConnectionConfig | null;
  pairedDesktops: MobilePairedDesktopSummary[];
  connectLive: (config: MobileConnectionConfig) => Promise<void>;
  switchPairedDesktop: (desktopId: string) => Promise<void>;
  enterDemoMode: () => void;
  disconnect: () => Promise<void>;
  refreshSessions: () => Promise<void>;
  loadMoreSessions: () => Promise<void>;
  sessionsHasMore: boolean;
  subscribeSession: (sessionId: string) => Promise<void>;
  unsubscribeSession: () => Promise<void>;
  selectRound: (roundId: string | null) => void;
  retrySelectedRound: () => void;
  sendMessage: (
    sessionId: string,
    content: string,
    attachments?: MobileSendAttachment[]
  ) => Promise<void>;
  openSessionFileInDesktop: (
    sessionId: string,
    roundId: string,
    eventId: string,
    targetIndex: number
  ) => Promise<void>;
  respondPermission: (
    response: "allow" | "deny" | "always_allow"
  ) => Promise<void>;
  dismissPermissionHead: () => void;
  stopSession: (sessionId: string) => Promise<void>;
  sessionModel: MobileSessionModelState;
  refreshSessionModel: (sessionId: string) => Promise<void>;
  setSessionModel: (
    sessionId: string,
    option: MobileModelOption
  ) => Promise<void>;
}

const MobileRemoteContext = createContext<MobileRemoteContextValue | null>(
  null
);

function waitForSocketOpen(
  socket: WebSocket,
  runtime: Pick<MobileRemoteRuntimePort, "setTimeout" | "clearTimeout">
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      runtime.clearTimeout(timeoutId);
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("error", onError);
      socket.removeEventListener("close", onClose);
    };
    const onOpen = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("WebSocket connection failed"));
    };
    const onClose = () => {
      cleanup();
      reject(new Error("WebSocket closed before connecting"));
    };
    const timeoutId = runtime.setTimeout(() => {
      cleanup();
      reject(new Error("WebSocket connection timed out"));
    }, CONNECT_TIMEOUT_MS);
    socket.addEventListener("open", onOpen, { once: true });
    socket.addEventListener("error", onError, { once: true });
    socket.addEventListener("close", onClose, { once: true });
  });
}

function waitForPairingApproval(
  socket: WebSocket,
  client: MobileRpcClient,
  runtime: Pick<MobileRemoteRuntimePort, "setTimeout" | "clearTimeout">
): Promise<void> {
  return new Promise((resolve, reject) => {
    let unsubscribe: () => void = () => undefined;
    const cleanup = () => {
      runtime.clearTimeout(timeoutId);
      unsubscribe();
      socket.removeEventListener("close", onClose);
    };
    const onClose = () => {
      cleanup();
      reject(new Error("Connection closed before pairing was approved"));
    };
    const timeoutId = runtime.setTimeout(() => {
      cleanup();
      reject(new Error("Pairing confirmation expired"));
    }, PAIRING_TIMEOUT_MS);
    unsubscribe = client.onNotification((method) => {
      if (method === "pairing/approved") {
        cleanup();
        resolve();
      }
    });
    socket.addEventListener("close", onClose, { once: true });
  });
}

export interface MobileRemoteProvidersProps {
  children: React.ReactNode;
  /** Authenticated ORG2 Cloud subject; scopes all retained pairing state. */
  authUserId: string;
  relayUrl?: string;
  demoByDefault?: boolean;
  /** A freshly scanned QR must take precedence over a stored old desktop. */
  suppressInitialBootstrap?: boolean;
}

export function MobileRemoteProviders({
  children,
  authUserId,
  relayUrl,
  demoByDefault = true,
  suppressInitialBootstrap = false,
}: MobileRemoteProvidersProps) {
  const platform = useMobileRemotePlatform();
  const auth = useContext(MobileAuthContext);
  const authRef = useRef(auth);
  authRef.current = auth;
  const preparationRef = useRef<AbortController | null>(null);
  const clientRef = useRef<MobileRpcClient | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const activeSessionRef = useRef<string | null>(null);
  const unsubscribeRpcRef = useRef<(() => void) | null>(null);
  const activeConfigRef = useRef<MobileConnectionConfig | null>(null);
  const generationRef = useRef(0);
  const selectionIntentRef = useRef(0);
  const recoverRef = useRef<
    (config: MobileConnectionConfig, generation: number) => Promise<void>
  >(async () => undefined);
  const reconnect = useMemo(
    () =>
      createRemoteReconnectController(
        platform.runtime,
        (generation) => generation === generationRef.current,
        (config, generation) => recoverRef.current(config, generation)
      ),
    [platform.runtime]
  );
  const connectionWriteChainRef = useRef<Promise<void>>(Promise.resolve());
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
  const [pairedDesktops, setPairedDesktops] = useState<
    MobilePairedDesktopSummary[]
  >([]);
  const connectionRef = useRef(connection);
  connectionRef.current = connection;
  const { sessions, sessionsHasMore, requestSessionList, resetSessions } =
    useMobileSessionList(clientRef);
  const {
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
    permissionQueueDepth,
    permissionSubmitting,
    respondPermission,
    dismissPermissionHead,
    resetPermissions,
    receivePermissionEvent,
  } = useMobilePermissions({
    sessionId: transcript.sessionId,
    demoMode: connection.demoMode,
    requireWritableClient,
  });

  const {
    sessionModel,
    refreshSessionModel,
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

  const persistConnection = useCallback(
    (config: MobileConnectionConfig | null) => {
      const operation = connectionWriteChainRef.current.then(async () => {
        await platform.connection.save(authUserId, config);
        setPairedDesktops(
          await platform.connection.listPairedDesktops(authUserId)
        );
      });
      connectionWriteChainRef.current = operation.catch(() => undefined);
      return operation;
    },
    [authUserId, platform.connection]
  );

  const clearReconnectTimer = useCallback(() => reconnect.clear(), [reconnect]);

  const releaseTransport = useCallback(
    (close: boolean) => {
      reconnect.invalidate();
      preparationRef.current?.abort();
      preparationRef.current = null;
      // Invalidate every in-flight subscribe/refresh from the old socket before
      // it can reject or resolve into the retained logical session state.
      invalidateTranscriptRequests();
      unsubscribeRpcRef.current?.();
      unsubscribeRpcRef.current = null;
      const client = clientRef.current;
      clientRef.current = null;
      const socket = socketRef.current;
      socketRef.current = null;
      if (close) {
        if (client) client.close();
        else socket?.close();
      }
    },
    [reconnect, invalidateTranscriptRequests]
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
    showDemoTranscript,
    clearReconnectTimer,
    releaseTransport,
    resetSessions,
    resetPermissions,
    resetSend,
  ]);

  const handleRpcNotification = useCallback(
    (method: string, params: Record<string, unknown> | undefined) => {
      if (method === "relay/presence") {
        setConnection((prev) => ({
          ...prev,
          presence: params?.online === true ? "online" : "offline",
        }));
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
          // A failed refresh is retried by the next change/reconnect/manual
          // refresh; the generation guard prevents an older reply winning.
          void requestSessionList(client).catch(() => undefined);
        }
      }
    },
    [
      requestSessionList,
      receivePermissionEvent,
      receiveTerminal,
      receiveSendStatus,
      receiveSnapshot,
      refreshSubscribedSession,
    ]
  );

  const establishConnection = useCallback(
    async (config: MobileConnectionConfig, generation: number) => {
      const deviceLabel =
        config.deviceLabel?.trim() ||
        platform.clientInfo.defaultDeviceLabel ||
        resolveMobileDeviceLabel();
      const transportConfig = { ...config, deviceLabel };
      preparationRef.current?.abort();
      const preparation = new AbortController();
      preparationRef.current = preparation;
      let preparedUrl: string;
      try {
        preparedUrl = await platform.connection.prepareSocketUrl(
          transportConfig,
          {
            authUserId,
            signal: preparation.signal,
            getSession: async () => {
              const getSession = authRef.current?.getConnectionSession;
              if (!getSession) throw new Error("Sign in to connect to Relay");
              return getSession();
            },
          }
        );
        preparation.signal.throwIfAborted();
        if (generation !== generationRef.current || platform.runtime.isHidden())
          throw new Error("Connection was superseded");
      } finally {
        if (preparationRef.current === preparation)
          preparationRef.current = null;
      }
      const socket = platform.connection.createSocket(preparedUrl);
      let authenticated = false;
      let intentionalClose = false;
      socketRef.current = socket;

      try {
        await waitForSocketOpen(socket, platform.runtime);
        if (generation !== generationRef.current) {
          intentionalClose = true;
          socket.close();
          throw new Error("Connection was superseded");
        }

        const client = createMobileRpcClient(socket, platform.runtime);
        clientRef.current = client;
        unsubscribeRpcRef.current = client.onNotification(
          handleRpcNotification
        );
        if (config.pairingCode) {
          await waitForPairingApproval(socket, client, platform.runtime);
        }

        const init = await client.call<InitializeResult>("initialize", {
          protocolVersion: 1,
          clientInfo: {
            name: platform.clientInfo.name,
            version: platform.clientInfo.version,
          },
          capabilities: { interactions: ["permission"], streaming: true },
          deviceLabel,
        });
        if (generation !== generationRef.current) {
          intentionalClose = true;
          client.close();
          throw new Error("Connection was superseded");
        }

        authenticated = true;
        reconnect.reset();
        setConnection({
          status: "connected",
          presence: "online",
          desktopId: init.desktopId ?? config.desktopId,
          desktopName: init.desktopName ?? DEMO_DESKTOP_NAME,
          // Authorization is server-owned. An older/incomplete initialize
          // response must never silently upgrade the phone to write access.
          tier: init.tier ?? "read_only",
          capabilities: init.capabilities,
          demoMode: false,
        });
        socket.addEventListener(
          "close",
          (event) => {
            if (
              intentionalClose ||
              !authenticated ||
              generation !== generationRef.current ||
              socketRef.current !== socket
            ) {
              return;
            }
            releaseTransport(false);
            if (event.code === 1008) {
              activeConfigRef.current = null;
              setConnection((prev) => ({
                ...prev,
                status: "error",
                presence: "offline",
                error: toMobileRpcError(
                  new MobileConnectionAuthorizationError(
                    "Device access was revoked or pairing expired"
                  )
                ),
              }));
              return;
            }
            setConnection((prev) => ({
              ...prev,
              status: "connecting",
              presence: "offline",
              error: undefined,
            }));
            scheduleReconnectRef.current(config, generation);
          },
          { once: true }
        );
        await requestSessionList(client);
        if (
          socketRef.current !== socket ||
          generation !== generationRef.current
        )
          return;
        if (activeSessionRef.current) {
          const sessionId = activeSessionRef.current;
          const subscriptionGeneration = beginLoad(sessionId);
          await requestSessionSnapshot(
            client,
            sessionId,
            subscriptionGeneration
          ).catch(() => undefined);
        }
      } catch (error) {
        intentionalClose = true;
        if (socketRef.current === socket) releaseTransport(true);
        throw error;
      }
    },
    [
      authUserId,
      reconnect,
      handleRpcNotification,
      platform.clientInfo,
      platform.connection,
      platform.runtime,
      releaseTransport,
      requestSessionList,
      requestSessionSnapshot,
      beginLoad,
    ]
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
        error: undefined,
      }));
      try {
        await establishConnection(config, generation);
      } catch (error) {
        if (generation !== generationRef.current) return;
        const denied = error instanceof MobileConnectionAuthorizationError;
        if (denied) activeConfigRef.current = null;
        setConnection((prev) => ({
          ...prev,
          status: denied ? "error" : "connecting",
          presence: "offline",
          error: toMobileRpcError(error),
        }));
        if (!denied) scheduleReconnectRef.current(config, generation);
      }
    },
    [establishConnection, platform.runtime]
  );

  recoverRef.current = runReconnect;
  scheduleReconnectRef.current = reconnect.schedule;

  const connectLive = useCallback(
    async (config: MobileConnectionConfig) => {
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
      await persistConnection(config);
      if (generation !== generationRef.current) {
        throw new Error("Connection was superseded");
      }
      setConnection((prev) => ({
        ...prev,
        status: "connecting",
        presence: "unknown",
        demoMode: false,
        error: undefined,
      }));
      try {
        await establishConnection(config, generation);
      } catch (error) {
        if (generation === generationRef.current) {
          if (error instanceof MobileConnectionAuthorizationError)
            activeConfigRef.current = null;
          setConnection({
            status: "error",
            presence: "offline",
            demoMode: false,
            error: toMobileRpcError(error),
          });
        }
        throw error;
      }
    },
    [
      clearReconnectTimer,
      reconnect,
      establishConnection,
      persistConnection,
      releaseTransport,
      resetSessions,
      resetPermissions,
      resetSend,
    ]
  );

  const disconnect = useCallback(async () => {
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
    await persistConnection(null);
  }, [
    resetTranscript,
    clearReconnectTimer,
    persistConnection,
    releaseTransport,
    resetSessions,
    resetPermissions,
    resetSend,
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
    [authUserId, connectLive, platform.connection]
  );

  const refreshSessions = useCallback(async () => {
    if (connection.demoMode) {
      resetSessions(DEMO_SESSIONS);
      return;
    }
    const client = clientRef.current;
    if (!client || connection.presence !== "online") return;
    await requestSessionList(client);
  }, [
    connection.demoMode,
    connection.presence,
    requestSessionList,
    resetSessions,
  ]);

  const loadMoreSessions = useCallback(async () => {
    const client = clientRef.current;
    if (!client || connection.presence !== "online" || !sessionsHasMore) return;
    await requestSessionList(client, true);
  }, [connection.presence, sessionsHasMore, requestSessionList]);

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
      await refreshSessionModel(sessionId);
    },
    [
      refreshSessionModel,
      requestSessionSnapshot,
      resetSend,
      beginLoad,
      failLoad,
      showDemoTranscript,
    ]
  );

  const unsubscribeSession = useCallback(async () => {
    const sessionId = activeSessionRef.current;
    activeSessionRef.current = null;
    resetTranscript();
    resetSend();
    resetSessionModel();
    const currentConnection = connectionRef.current;
    if (currentConnection.demoMode || !sessionId) return;
    if (clientRef.current && currentConnection.presence === "online") {
      await clientRef.current.call("session/unsubscribe", { sessionId });
    }
  }, [resetSessionModel, resetSend, resetTranscript]);

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
          .catch(() => undefined);
      }
    };
    return platform.runtime.subscribeVisibility(handleVisible);
  }, [clearReconnectTimer, platform.runtime, releaseTransport, reconnect]);

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
      const inventoryPromise =
        platform.connection.listPairedDesktops(authUserId);
      const config = relayUrl?.trim()
        ? { wsUrl: relayUrl.trim() }
        : await platform.connection.load(authUserId);
      const inventory = await inventoryPromise;
      if (disposed || bootstrapGeneration !== generationRef.current) {
        return;
      }
      setPairedDesktops(inventory);
      setConnectionConfig(config);
      if (config?.wsUrl || config?.host) {
        await connectLive(config).catch(() => undefined);
      } else if (demoByDefault) {
        enterDemoMode();
      }
    })();
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
      connection,
      sessions,
      transcriptItems: transcriptView.items,
      transcriptPhase: transcriptView.phase,
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
      rpc: clientRef.current,
      connectionConfig,
      pairedDesktops,
      connectLive,
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
      setSessionModel,
    }),
    [
      activePermission,
      connectLive,
      connectionConfig,
      connection,
      dismissPermissionHead,
      disconnect,
      enterDemoMode,
      permissionQueueDepth,
      permissionSubmitting,
      refreshSessionModel,
      refreshSessions,
      loadMoreSessions,
      sessionsHasMore,
      openSessionFileInDesktop,
      pairedDesktops,
      respondPermission,
      retrySelectedRound,
      selectRound,
      sendMessage,
      sendStatus,
      sessionModel,
      sessions,
      setSessionModel,
      stopSession,
      subscribeSession,
      switchPairedDesktop,
      transcript.rounds,
      transcript.roundsComplete,
      transcript.selectedRoundId,
      transcriptView.error,
      transcriptView.items,
      transcriptView.phase,
      transcriptView.roundId,
      transcriptView.truncated,
      unsubscribeSession,
    ]
  );

  return (
    <MobileRemoteContext.Provider value={value}>
      {children}
    </MobileRemoteContext.Provider>
  );
}

export function useMobileRemote(): MobileRemoteContextValue {
  const value = useContext(MobileRemoteContext);
  if (!value) {
    throw new Error(
      "useMobileRemote must be used within MobileRemoteProviders"
    );
  }
  return value;
}

MobileRemoteProviders.displayName = "MobileRemoteProviders";

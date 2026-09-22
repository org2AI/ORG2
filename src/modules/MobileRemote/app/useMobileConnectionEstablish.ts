import { useCallback } from "react";

import { mobileComposerDesktopScope } from "../components/composer/mobileComposerDraftStore";
import {
  desktopIdentityName,
  pairedDesktopId,
  withInitializedDesktop,
} from "../connection/mobileDesktopIdentity";
import {
  createMobileRpcClient,
  toMobileRpcError,
} from "../connection/mobileRpcClient";
import { resolveMobileDeviceLabel } from "../connection/resolveMobileDeviceLabel";
import { MobileConnectionAuthorizationError } from "../connection/types";
import type {
  InitializeResult,
  MobileConnectionConfig,
  MobileConnectionState,
} from "../connection/types";
import {
  waitForPairingApproval,
  waitForSocketOpen,
} from "./mobileSocketHandshake";
import type { MobileRemoteState } from "./useMobileRemoteState";

export class SupersededConnectionError extends Error {
  constructor() {
    super("Connection was superseded");
  }
}

export function useMobileConnectionEstablish(
  state: MobileRemoteState,
  authUserId: string,
  persistConnection: (config: MobileConnectionConfig | null) => Promise<void>,
  releaseTransport: (close: boolean) => void,
  handleRpcNotification: (
    method: string,
    params: Record<string, unknown> | undefined
  ) => void
) {
  const {
    platform,
    draftStore,
    authRef,
    preparationRef,
    clientRef,
    setRpc,
    socketRef,
    activeSessionRef,
    unsubscribeRpcRef,
    activeConfigRef,
    generationRef,
    reconnect,
    scheduleReconnectRef,
    setConnection,
    setConnectionConfig,
    setPairedDesktops,
    connectionRef,
    requestSessionList,
    beginLoad,
    requestSessionSnapshot,
  } = state;
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
          throw new SupersededConnectionError();
      } catch (error) {
        if (preparation.signal.aborted) throw new SupersededConnectionError();
        if (error instanceof MobileConnectionAuthorizationError) {
          draftStore.clearDesktop(mobileComposerDesktopScope(config, {}));
        }
        throw error;
      } finally {
        if (preparationRef.current === preparation)
          preparationRef.current = null;
      }
      const socket = platform.connection.createSocket(preparedUrl);
      let authenticated = false;
      let intentionalClose = false;
      let authorizationDenied = false;
      let pairedConfig = config;
      // Policy closes during initialize are just as terminal as post-handshake
      // revocation. The RPC client's generic close error must not trigger retries.
      socket.addEventListener(
        "close",
        (event) => {
          authorizationDenied = event.code === 1008;
        },
        { once: true }
      );
      socketRef.current = socket;

      try {
        await waitForSocketOpen(socket, platform.runtime);
        if (generation !== generationRef.current) {
          intentionalClose = true;
          socket.close();
          throw new SupersededConnectionError();
        }

        const client = createMobileRpcClient(socket, platform.runtime);
        clientRef.current = client;
        setRpc(client);
        unsubscribeRpcRef.current = client.onNotification(
          handleRpcNotification
        );
        if (config.pairingCode) {
          await waitForPairingApproval(socket, client, platform.runtime);
          if (
            generation !== generationRef.current ||
            socketRef.current !== socket
          )
            throw new SupersededConnectionError();
          // Relay approval, not Desktop availability, finalizes pairing. Keep
          // the durable device credential, but never replay the one-time code.
          const { pairingCode: _approvedCode, ...confirmed } = config;
          pairedConfig = confirmed;
          activeConfigRef.current = confirmed;
          setConnectionConfig(confirmed);
          void persistConnection(confirmed).catch(() => undefined);
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
        if (
          generation !== generationRef.current ||
          socketRef.current !== socket
        ) {
          intentionalClose = true;
          client.close();
          throw new SupersededConnectionError();
        }

        authenticated = true;
        reconnect.reset();
        const identifiedConfig = withInitializedDesktop(pairedConfig, init);
        const desktopName = desktopIdentityName(
          identifiedConfig.desktopIdentity
        );
        if (identifiedConfig !== config) {
          activeConfigRef.current = identifiedConfig;
          setConnectionConfig(identifiedConfig);
          // Publish verified metadata immediately; secure-storage latency must not
          // delay sessions or display an opaque ID after initialize succeeds.
          setPairedDesktops((desktops) => {
            const id = pairedDesktopId(config);
            const existing = desktops.find((desktop) => desktop.id === id);
            return [
              {
                id,
                name: desktopName ?? existing?.name ?? id,
                active: true,
                updatedAtMs: existing?.updatedAtMs ?? platform.runtime.now(),
                desktopIdentity: identifiedConfig.desktopIdentity,
              },
              ...desktops
                .filter((desktop) => desktop.id !== id)
                .map((desktop) => ({ ...desktop, active: false })),
            ].slice(0, 20);
          });
        }
        // Retry the confirmed credential write even without desktop metadata:
        // an earlier approval save may have failed before Desktop came online.
        void persistConnection(identifiedConfig).catch(() => undefined);
        const connected: MobileConnectionState = {
          status: "connected",
          presence: "online",
          desktopId: init.desktopId ?? config.desktopId,
          desktopName: desktopName ?? config.desktopId ?? config.host,
          // Authorization is server-owned. An older/incomplete initialize
          // response must never silently upgrade the phone to write access.
          tier: init.tier ?? "read_only",
          capabilities: init.capabilities,
          demoMode: false,
        };
        // Restoration runs before React commits; use this handshake's capabilities.
        connectionRef.current = connected;
        setConnection(connected);
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
              draftStore.clearDesktop(
                mobileComposerDesktopScope(identifiedConfig, {
                  desktopId: identifiedConfig.desktopId,
                })
              );
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
            scheduleReconnectRef.current(identifiedConfig, generation);
          },
          { once: true }
        );
        // The roster is independent of the selected conversation. A slow list
        // must not serialize reconnect → latest body behind unrelated sessions.
        const restoreActiveSession = async () => {
          if (
            socketRef.current !== socket ||
            generation !== generationRef.current
          )
            return;
          const sessionId = activeSessionRef.current;
          if (!sessionId) return;
          const subscriptionGeneration = beginLoad(sessionId);
          await requestSessionSnapshot(
            client,
            sessionId,
            subscriptionGeneration
          ).catch(() => undefined);
        };
        await Promise.all([
          restoreActiveSession(),
          // An authenticated socket is healthy even when its roster read fails.
          // List state and bounded retries are owned by useMobileSessionList.
          requestSessionList(client).catch(() => undefined),
        ]);
      } catch (error) {
        intentionalClose = true;
        if (socketRef.current !== socket) throw new SupersededConnectionError();
        releaseTransport(true);
        if (
          authorizationDenied ||
          error instanceof MobileConnectionAuthorizationError
        ) {
          draftStore.clearDesktop(mobileComposerDesktopScope(config, {}));
        }
        if (authorizationDenied)
          throw new MobileConnectionAuthorizationError(
            "Device access was revoked or pairing expired"
          );
        throw error;
      }
    },
    [
      platform.clientInfo.defaultDeviceLabel,
      platform.clientInfo.name,
      platform.clientInfo.version,
      platform.connection,
      platform.runtime,
      preparationRef,
      socketRef,
      authUserId,
      generationRef,
      authRef,
      draftStore,
      clientRef,
      setRpc,
      unsubscribeRpcRef,
      handleRpcNotification,
      reconnect,
      persistConnection,
      connectionRef,
      setConnection,
      requestSessionList,
      activeConfigRef,
      setConnectionConfig,
      setPairedDesktops,
      releaseTransport,
      scheduleReconnectRef,
      activeSessionRef,
      beginLoad,
      requestSessionSnapshot,
    ]
  );

  return establishConnection;
}

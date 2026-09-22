import { useCallback, useEffect, useReducer, useRef, useState } from "react";

import { useMobileRemote } from "../app";
import { parseMobileRemoteWsUrl } from "../connection/parseMobileRemoteWsUrl";
import type { MobileConnectionConfig } from "../connection/types";
import { resolveMobileSessionTitle } from "../lib/sessionPresentation";
import {
  type MobileRemoteNavAction,
  createInitialMobileRemoteNavState,
  reduceMobileRemoteNav,
} from "./mobileRemoteNavigation";

/** Route intent owner; connection execution remains in ConnectingLiveBridge. */
export function useMobileRemoteCoordinator(
  recoveredPairingIntent: string | null
) {
  const {
    connection,
    connectionConfig,
    sessions,
    stopSession,
    disconnect,
    retryConnection,
  } = useMobileRemote();
  const [connectionRecovering, setConnectionRecovering] = useState(false);
  const [connectionRecoveryError, setConnectionRecoveryError] = useState<
    "retry" | "repair" | null
  >(null);
  const recoveryAttemptRef = useRef<symbol | null>(null);
  useEffect(
    () => () => {
      recoveryAttemptRef.current = null;
    },
    []
  );
  const [storedNav, reduce] = useReducer(
    reduceMobileRemoteNav,
    undefined,
    createInitialMobileRemoteNavState
  );
  // Project the restored route during render, before effects: no welcome-frame flash.
  const nav =
    storedNav.screen === "welcome" &&
    !recoveredPairingIntent &&
    !connection.demoMode &&
    (connection.status === "connected" ||
      (connectionConfig && !connectionConfig.pairingCode))
      ? reduceMobileRemoteNav(storedNav, { type: "connecting_complete" })
      : storedNav;
  const [stopConfirming, setStopConfirming] = useState(false);
  const [stopFailed, setStopFailed] = useState(false);
  const stopAttemptRef = useRef<symbol | null>(null);
  const dispatch = useCallback((action: MobileRemoteNavAction) => {
    // Navigation supersedes modal-local work, but does not cancel the remote command.
    if (action.type !== "open_stop_modal") {
      stopAttemptRef.current = null;
      setStopConfirming(false);
      setStopFailed(false);
    }
    reduce(action);
  }, []);
  useEffect(
    () => () => {
      stopAttemptRef.current = null;
    },
    []
  );
  useEffect(() => {
    stopAttemptRef.current = null;
    setStopConfirming(false);
    setStopFailed(false);
  }, [
    connection.desktopId,
    connectionConfig?.desktopId,
    connectionConfig?.wsUrl,
    connectionConfig?.host,
    connectionConfig?.port,
  ]);
  const consumedPairingLinkRef = useRef<string | null>(null);

  const showTabBar = nav.screen === "sessions" && !nav.selectedSessionId;
  const selectedSessionName = nav.selectedSessionId
    ? resolveMobileSessionTitle(sessions, nav.selectedSessionId)
    : "";
  const selectedSessionSendCapability = nav.selectedSessionId
    ? sessions.find((session) => session.id === nav.selectedSessionId)
        ?.sendCapability
    : undefined;

  useEffect(() => {
    if (
      (connection.status === "connected" ||
        (connectionConfig && !connectionConfig.pairingCode)) &&
      !connection.demoMode &&
      !recoveredPairingIntent &&
      storedNav.screen === "welcome"
    ) {
      dispatch({ type: "connecting_complete" });
    }
  }, [
    connection.demoMode,
    connection.status,
    connectionConfig,
    recoveredPairingIntent,
    storedNav.screen,
    dispatch,
  ]);

  useEffect(() => {
    if (
      !recoveredPairingIntent ||
      consumedPairingLinkRef.current === recoveredPairingIntent
    ) {
      return;
    }
    consumedPairingLinkRef.current = recoveredPairingIntent;
    const parsed = parseMobileRemoteWsUrl(recoveredPairingIntent);
    if (parsed.ok) {
      dispatch({ type: "accept_pairing", ...parsed });
    }
  }, [recoveredPairingIntent, dispatch]);

  const handleConnectingComplete = useCallback(() => {
    dispatch({ type: "connecting_complete" });
  }, [dispatch]);

  const handleAcceptPairing = useCallback(
    (args: {
      config: MobileConnectionConfig;
      requiresSas: boolean;
      sasPhrase?: string;
    }) => {
      dispatch({ type: "accept_pairing", ...args });
    },
    [dispatch]
  );

  const handleConfirmStop = useCallback(async () => {
    if (!nav.selectedSessionId || stopAttemptRef.current) return;
    const attempt = Symbol("mobile-stop");
    stopAttemptRef.current = attempt;
    setStopConfirming(true);
    setStopFailed(false);
    try {
      await stopSession(nav.selectedSessionId);
      if (stopAttemptRef.current === attempt) {
        dispatch({ type: "close_stop_modal" });
      }
    } catch {
      if (stopAttemptRef.current === attempt) setStopFailed(true);
    } finally {
      if (stopAttemptRef.current === attempt) {
        stopAttemptRef.current = null;
        setStopConfirming(false);
      }
    }
  }, [nav.selectedSessionId, stopSession, dispatch]);

  const recoverConnection = useCallback(
    async (kind: "retry" | "repair") => {
      if (recoveryAttemptRef.current) return;
      const attempt = Symbol("connection-recovery");
      recoveryAttemptRef.current = attempt;
      setConnectionRecovering(true);
      setConnectionRecoveryError(null);
      try {
        if (kind === "retry") {
          // The provider now owns this attempt. Consume the old pairing intent
          // before leaving the error gate so its bridge cannot start a second one.
          if (nav.pendingConfig) dispatch({ type: "back_to_welcome" });
          await retryConnection();
        } else {
          await disconnect();
          if (recoveryAttemptRef.current === attempt)
            dispatch({ type: "back_to_welcome" });
        }
      } catch {
        if (recoveryAttemptRef.current === attempt)
          setConnectionRecoveryError(kind);
      } finally {
        if (recoveryAttemptRef.current === attempt) {
          recoveryAttemptRef.current = null;
          setConnectionRecovering(false);
        }
      }
    },
    [disconnect, dispatch, nav.pendingConfig, retryConnection]
  );
  const handleConnectionRetry = useCallback(
    () => recoverConnection("retry"),
    [recoverConnection]
  );
  const handleConnectionRepair = useCallback(
    () => recoverConnection("repair"),
    [recoverConnection]
  );

  return {
    connection,
    nav,
    dispatch,
    stopConfirming,
    stopFailed,
    showTabBar,
    selectedSessionName,
    selectedSessionSendCapability,
    handleConnectingComplete,
    handleAcceptPairing,
    handleConfirmStop,
    handleConnectionRetry,
    handleConnectionRepair,
    connectionRecovering,
    connectionRecoveryError,
  };
}

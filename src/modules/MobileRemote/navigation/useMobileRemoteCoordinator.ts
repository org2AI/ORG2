import { useCallback, useEffect, useReducer, useRef } from "react";

import { useMobileRemote } from "../app";
import { parseMobileRemoteWsUrl } from "../connection/parseMobileRemoteWsUrl";
import type { MobileConnectionConfig } from "../connection/types";
import { resolveMobileSessionTitle } from "../lib/sessionPresentation";
import {
  type MobileRemoteNavAction,
  createInitialMobileRemoteNavState,
  reduceMobileRemoteNav,
} from "./mobileRemoteNavigation";

type CoordinatorState = {
  nav: ReturnType<typeof createInitialMobileRemoteNavState>;
  stopConfirming: boolean;
  stopFailed: boolean;
};
type CoordinatorAction =
  | MobileRemoteNavAction
  | { type: "stop_pending" }
  | { type: "stop_failed" };
function reduceCoordinator(
  state: CoordinatorState,
  action: CoordinatorAction
): CoordinatorState {
  if (action.type === "stop_pending")
    return { ...state, stopConfirming: true, stopFailed: false };
  if (action.type === "stop_failed")
    return { ...state, stopConfirming: false, stopFailed: true };
  return {
    nav: reduceMobileRemoteNav(state.nav, action),
    stopConfirming: action.type === "open_stop_modal" && state.stopConfirming,
    stopFailed: false,
  };
}

/** Route intent owner; connection execution remains in ConnectingLiveBridge. */
export function useMobileRemoteCoordinator(
  recoveredPairingIntent: string | null
) {
  const { connection, sessions, stopSession, disconnect } = useMobileRemote();
  const [{ nav, stopConfirming, stopFailed }, reduce] = useReducer(
    reduceCoordinator,
    undefined,
    () => ({
      nav: createInitialMobileRemoteNavState(),
      stopConfirming: false,
      stopFailed: false,
    })
  );
  const stopAttemptRef = useRef<symbol | null>(null);
  const dispatch = useCallback((action: MobileRemoteNavAction) => {
    // Navigation supersedes modal-local work, but does not cancel the remote command.
    if (action.type !== "open_stop_modal") {
      stopAttemptRef.current = null;
    }
    reduce(action);
  }, []);
  useEffect(
    () => () => {
      stopAttemptRef.current = null;
    },
    []
  );
  const consumedPairingLinkRef = useRef<string | null>(null);

  const showTabBar =
    nav.screen === "sessions" &&
    connection.status === "connected" &&
    !nav.selectedSessionId;
  const selectedSessionName = nav.selectedSessionId
    ? resolveMobileSessionTitle(sessions, nav.selectedSessionId)
    : "";
  const selectedSessionSendCapability = nav.selectedSessionId
    ? sessions.find((session) => session.id === nav.selectedSessionId)
        ?.sendCapability
    : undefined;

  useEffect(() => {
    if (
      connection.status === "connected" &&
      !connection.demoMode &&
      nav.screen === "welcome"
    ) {
      dispatch({ type: "connecting_complete" });
    }
  }, [connection.demoMode, connection.status, nav.screen, dispatch]);

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
    reduce({ type: "stop_pending" });
    try {
      await stopSession(nav.selectedSessionId);
      if (stopAttemptRef.current === attempt) {
        dispatch({ type: "close_stop_modal" });
      }
    } catch {
      if (stopAttemptRef.current === attempt) {
        stopAttemptRef.current = null;
        reduce({ type: "stop_failed" });
      }
    }
  }, [nav.selectedSessionId, stopSession, dispatch]);

  const handleConnectionRetry = useCallback(() => {
    void disconnect().catch(() => undefined);
    dispatch({ type: "back_to_welcome" });
  }, [disconnect, dispatch]);

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
  };
}

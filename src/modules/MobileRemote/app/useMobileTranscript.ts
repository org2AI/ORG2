import {
  type MutableRefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  type MobileRpcClient,
  toMobileRpcError,
} from "../connection/mobileRpcClient";
import type { MobileConnectionState } from "../connection/types";
import { loadSubscriptionHistory } from "../lib/loadSubscriptionHistory";
import {
  type TranscriptRoundResult,
  type TranscriptSnapshotEnvelope,
  applyLiveTranscriptSnapshot,
  applyTranscriptRoundResult,
  applyTranscriptSubscribeResult,
  beginTranscriptLoad,
  beginTranscriptRoundLoad,
  createInitialTranscriptLoadState,
  failTranscriptLoad,
  failTranscriptRoundLoad,
  getSelectedTranscriptView,
  readyTranscriptLoadState,
  retrySelectedTranscriptRound,
  selectTranscriptRound as selectTranscriptRoundState,
  selectedTranscriptRoundId,
} from "../lib/transcriptLoadState";
import { demoTranscriptItems } from "../lib/transcriptReducer";

export function useMobileTranscript({
  clientRef,
  connectionRef,
  activeSessionRef,
  connection,
}: {
  clientRef: MutableRefObject<MobileRpcClient | null>;
  connectionRef: MutableRefObject<MobileConnectionState>;
  activeSessionRef: MutableRefObject<string | null>;
  connection: MobileConnectionState;
}) {
  const [openedSession, setOpenedSession] = useState<{
    requested: string;
    sessionId: string;
    managed: boolean;
  } | null>(null);
  const openingLeaseRef = useRef<{
    client: MobileRpcClient;
    subscriptionId: string;
  } | null>(null);
  const releaseOpening = useCallback(() => {
    const lease = openingLeaseRef.current;
    openingLeaseRef.current = null;
    if (!lease || lease.client !== clientRef.current) return false;
    void lease.client
      .call("session/unsubscribe", {
        subscriptionId: lease.subscriptionId,
      })
      .catch(() => undefined);
    return true;
  }, [clientRef]);
  const subscriptionGenerationRef = useRef(0);
  const roundRequestGenerationRef = useRef(0);
  const refreshInFlightRef = useRef<{
    token: symbol;
    sessionId: string;
    client: MobileRpcClient;
  } | null>(null);
  const queuedRefreshSessionRef = useRef<string | null>(null);
  const refreshSubscribedSessionRef = useRef<(sessionId: string) => void>(
    () => undefined
  );

  const [transcript, setTranscript] = useState(
    createInitialTranscriptLoadState
  );
  const invalidateTranscriptRequests = useCallback(() => {
    openingLeaseRef.current = null;
    subscriptionGenerationRef.current += 1;
    roundRequestGenerationRef.current += 1;
    refreshInFlightRef.current = null;
    queuedRefreshSessionRef.current = null;
  }, []);
  const beginLoad = useCallback((sessionId: string) => {
    const generation = ++subscriptionGenerationRef.current;
    setTranscript((prev) => beginTranscriptLoad(prev, sessionId, generation));
    return generation;
  }, []);
  const resetTranscript = useCallback(() => {
    invalidateTranscriptRequests();
    setOpenedSession(null);
    setTranscript(createInitialTranscriptLoadState());
  }, [invalidateTranscriptRequests]);
  const showDemoTranscript = useCallback(
    (sessionId: string) => {
      invalidateTranscriptRequests();
      setTranscript(
        readyTranscriptLoadState(
          sessionId,
          subscriptionGenerationRef.current,
          demoTranscriptItems()
        )
      );
    },
    [invalidateTranscriptRequests]
  );
  const failLoad = useCallback(
    (sessionId: string, generation: number, message: string) => {
      setTranscript((prev) =>
        failTranscriptLoad(prev, sessionId, generation, message)
      );
    },
    []
  );
  const requestSessionSnapshot = useCallback(
    async (
      client: MobileRpcClient,
      sessionId: string,
      subscriptionGeneration: number,
      latestOnly = true
    ) => {
      let resolvedId = sessionId;
      const opening = connectionRef.current.capabilities?.sessionOpen === true;
      const lease = opening
        ? { client, subscriptionId: `open-${subscriptionGeneration}` }
        : null;
      if (lease) openingLeaseRef.current = lease;
      const isCurrent = () =>
        clientRef.current === client &&
        activeSessionRef.current === resolvedId &&
        subscriptionGenerationRef.current === subscriptionGeneration;
      try {
        const applied = await loadSubscriptionHistory(
          client,
          sessionId,
          isCurrent,
          (result) =>
            setTranscript((prev) =>
              applyTranscriptSubscribeResult(
                prev,
                result,
                resolvedId,
                subscriptionGeneration
              )
            ),
          latestOnly,
          lease
            ? {
                subscriptionId: lease.subscriptionId,
                onIdentity: (canonical, managed) => {
                  resolvedId = canonical;
                  activeSessionRef.current = canonical;
                  setOpenedSession((previous) => ({
                    requested:
                      previous?.sessionId === sessionId
                        ? previous.requested
                        : sessionId,
                    sessionId: canonical,
                    managed,
                  }));
                  setTranscript((prev) => ({ ...prev, sessionId: canonical }));
                },
              }
            : undefined
        );
        if (!applied && lease)
          void client
            .call("session/unsubscribe", {
              subscriptionId: lease.subscriptionId,
            })
            .catch(() => undefined);
        return applied;
      } catch (error) {
        // This close queues behind an opening that timed out on the phone.
        // Its lease prevents a late close from removing a newer subscription.
        if (lease)
          void client
            .call("session/unsubscribe", {
              subscriptionId: lease.subscriptionId,
            })
            .catch(() => undefined);
        if (!isCurrent()) return;
        setTranscript((prev) =>
          failTranscriptLoad(
            prev,
            resolvedId,
            subscriptionGeneration,
            toMobileRpcError(error).message
          )
        );
        throw error;
      }
    },
    [activeSessionRef, clientRef, connectionRef]
  );

  refreshSubscribedSessionRef.current = (sessionId: string) => {
    const client = clientRef.current;
    if (
      !client ||
      activeSessionRef.current !== sessionId ||
      connectionRef.current.presence !== "online"
    ) {
      return;
    }
    if (refreshInFlightRef.current) {
      queuedRefreshSessionRef.current = sessionId;
      return;
    }
    const token = Symbol("mobile-transcript-refresh");
    refreshInFlightRef.current = { token, sessionId, client };
    const subscriptionGeneration = ++subscriptionGenerationRef.current;
    setTranscript((current) =>
      beginTranscriptLoad(current, sessionId, subscriptionGeneration)
    );
    void requestSessionSnapshot(
      client,
      sessionId,
      subscriptionGeneration,
      false
    )
      .catch(() => undefined)
      .finally(() => {
        if (refreshInFlightRef.current?.token !== token) return;
        refreshInFlightRef.current = null;
        const queuedSessionId = queuedRefreshSessionRef.current;
        queuedRefreshSessionRef.current = null;
        if (queuedSessionId) {
          refreshSubscribedSessionRef.current(queuedSessionId);
        }
      });
  };

  const refreshSubscribedSession = useCallback((sessionId: string) => {
    refreshSubscribedSessionRef.current(sessionId);
  }, []);
  const receiveSnapshot = useCallback(
    (params: TranscriptSnapshotEnvelope) => {
      if (params?.sessionId !== activeSessionRef.current) return;
      setTranscript((prev) => applyLiveTranscriptSnapshot(prev, params));
      if (params.snapshotDelta === true && params.streaming === false)
        refreshSubscribedSession(params.sessionId);
    },
    [activeSessionRef, refreshSubscribedSession]
  );
  const selectRound = useCallback((roundId: string | null) => {
    setTranscript((prev) => selectTranscriptRoundState(prev, roundId));
  }, []);

  const retrySelectedRound = useCallback(() => {
    setTranscript((prev) => retrySelectedTranscriptRound(prev));
  }, []);

  const activeRoundId = selectedTranscriptRoundId(transcript);
  const activeRoundBody = activeRoundId
    ? transcript.bodies[activeRoundId]
    : undefined;

  useEffect(() => {
    const sessionId = transcript.sessionId;
    if (
      !sessionId ||
      !activeRoundId ||
      activeRoundBody?.phase !== "unloaded" ||
      connection.demoMode
    ) {
      return;
    }

    const requestGeneration = ++roundRequestGenerationRef.current;
    const sessionGeneration = transcript.generation;
    setTranscript((prev) =>
      beginTranscriptRoundLoad(
        prev,
        sessionId,
        activeRoundId,
        requestGeneration
      )
    );
    const client = clientRef.current;
    if (!client || connection.presence !== "online") {
      setTranscript((prev) =>
        failTranscriptRoundLoad(
          prev,
          sessionId,
          activeRoundId,
          sessionGeneration,
          requestGeneration,
          "Desktop is offline"
        )
      );
      return;
    }

    void client
      .call<TranscriptRoundResult>("session/round", {
        sessionId,
        roundId: activeRoundId,
      })
      .then((result) => {
        if (
          clientRef.current !== client ||
          roundRequestGenerationRef.current !== requestGeneration
        )
          return;
        setTranscript((prev) =>
          applyTranscriptRoundResult(
            prev,
            result,
            sessionId,
            activeRoundId,
            sessionGeneration,
            requestGeneration
          )
        );
      })
      .catch((error) => {
        if (
          clientRef.current !== client ||
          roundRequestGenerationRef.current !== requestGeneration
        )
          return;
        setTranscript((prev) =>
          failTranscriptRoundLoad(
            prev,
            sessionId,
            activeRoundId,
            sessionGeneration,
            requestGeneration,
            toMobileRpcError(error).message
          )
        );
      });
  }, [
    clientRef,
    activeRoundBody?.phase,
    activeRoundId,
    connection.demoMode,
    connection.presence,
    transcript.generation,
    transcript.sessionId,
  ]);

  return {
    openingClient: openingLeaseRef.current?.client,
    openedSession,
    releaseOpening,
    transcript,
    setTranscript,
    transcriptView: getSelectedTranscriptView(transcript),
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
  };
}

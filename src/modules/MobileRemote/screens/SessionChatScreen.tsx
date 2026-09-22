import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import { PermissionSheet } from "@src/components/PermissionPrompt";
import { createLogger } from "@src/hooks/logger";
import { HugeiconsIcon, StopCircleIcon } from "@src/icons";

import { useMobileRemote } from "../app";
import { useMobileSessionIdentity } from "../app/useMobileSessionIdentity";
import { MobileAuthContext } from "../auth/MobileAuthContext";
import { MobileActionButton } from "../components/MobileActionButton";
import { MobileTopBar } from "../components/MobileTopBar";
import { MobileChangeReview } from "../components/changes/MobileChangeReview";
import { MobileComposer } from "../components/composer/MobileComposer";
import { mobileComposerDesktopScope } from "../components/composer/mobileComposerDraftStore";
import { ChatTranscript } from "../components/transcript/ChatTranscript";
import { MobileLoadingDots } from "../components/transcript/MobileTranscriptLoading";
import { RoundNavigator } from "../components/transcript/RoundNavigator";
import { mobileConnectionFailureKey } from "../connection/mobileConnectionFeedback";
import type {
  MobileModelOption,
  MobileSendAttachment,
} from "../connection/types";

export interface SessionChatScreenProps {
  sessionId: string;
  sessionName: string;
  sendCapability?: "native" | "external_codex" | "read_only";
  onBack?: () => void;
  onCanonicalSession?: (sessionId: string) => void;
  /** Opens the M-15 stop confirmation; stopping never bypasses it. */
  onOpenStopModal?: () => void;
}

export function SessionChatScreen(props: SessionChatScreenProps) {
  const { connection, rpc, retryConnection, openedSession, openingReady } =
    useMobileRemote();
  const combinedOpen = connection.capabilities?.sessionOpen === true;
  const { t } = useTranslation("mobileRemote");
  const identity = useMobileSessionIdentity(
    rpc,
    props.sessionId,
    connection.capabilities?.sessionIdentity === true && !combinedOpen,
    connection.presence === "online"
  );
  const { onCanonicalSession, sessionId } = props;
  useEffect(() => {
    const canonical =
      combinedOpen && openingReady && openedSession?.requested === sessionId
        ? openedSession.sessionId
        : identity.sessionId;
    if (canonical && canonical !== sessionId) onCanonicalSession?.(canonical);
  }, [
    combinedOpen,
    openingReady,
    openedSession,
    identity.sessionId,
    sessionId,
    onCanonicalSession,
  ]);
  if (!identity.sessionId) {
    const online = connection.presence === "online";
    const label = online
      ? t("connection.resolvingSession")
      : t("connection.reconnecting");
    return (
      <>
        <MobileTopBar title={props.sessionName} onBack={props.onBack} />
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6">
          {!identity.error && <MobileLoadingDots label={label} />}
          <p role={identity.error ? "alert" : undefined}>
            {online && identity.error
              ? t("transcript.errorDetail", { message: identity.error })
              : label}
          </p>
          {online && identity.error && (
            <MobileActionButton onClick={identity.retry}>
              {t("transcript.retry")}
            </MobileActionButton>
          )}
          <MobileActionButton
            variant="secondary"
            onClick={() => {
              // The provider owns single-flight recovery, credential scope,
              // and errors; do not retain a second reconnect state here.
              void retryConnection().catch(() => undefined);
            }}
          >
            {t("connectionRecovery.retry")}
          </MobileActionButton>
          {connection.error && (
            <p role="alert">
              {t(mobileConnectionFailureKey(connection.error))}
            </p>
          )}
        </div>
      </>
    );
  }
  return (
    <SessionChatContent
      {...props}
      sessionId={identity.sessionId}
      sendCapability={identity.managed ? "native" : props.sendCapability}
    />
  );
}

/** M-08 Chat + M-11 Permission Sheet (via interaction queue). */
function SessionChatContent({
  sessionId: requestedSessionId,
  sessionName,
  sendCapability = "native",
  onBack,
  onOpenStopModal,
}: SessionChatScreenProps) {
  const { t } = useTranslation("mobileRemote");
  const {
    connection,
    connectionConfig,
    rpc,
    openedSession,
    openingReady,
    transcriptItems,
    transcriptPhase,
    transcriptSessionId,
    transcriptError,
    transcriptTruncated,
    transcriptRounds,
    transcriptRoundsComplete,
    selectedRoundId,
    activeRoundId,
    sendStatus,
    activePermission,
    permissionQueueDepth,
    permissionSubmitting,
    permissionFailed,
    sessionModel,
    sendMessage,
    openSessionFileInDesktop,
    respondPermission,
    dismissPermissionHead,
    subscribeSession,
    unsubscribeSession,
    selectRound,
    retrySelectedRound,
    setSessionModel,
    loadSessionModels,
    readStateSync,
  } = useMobileRemote();
  const combinedOpen = connection.capabilities?.sessionOpen === true;
  const opened =
    combinedOpen &&
    openedSession &&
    (openedSession.requested === requestedSessionId ||
      openedSession.sessionId === requestedSessionId)
      ? openedSession
      : null;
  const sessionId =
    opened && openingReady ? opened.sessionId : requestedSessionId;
  // Canonical route replacement represents the same opening, not another subscription.
  const subscriptionKey = opened?.requested ?? requestedSessionId;
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const draftScope = JSON.stringify([
    mobileComposerDesktopScope(connectionConfig, connection),
    sessionId,
  ]);
  const auth = useContext(MobileAuthContext);
  const imageEndpointUrl = connectionConfig?.wsUrl;
  const imageScope = useMemo(() => {
    let endpoint = "";
    if (imageEndpointUrl) {
      try {
        const url = new URL(imageEndpointUrl);
        // Cache identity never contains credentials, query tickets or fragments.
        endpoint = `${url.origin}${url.pathname}`;
      } catch {
        endpoint = "invalid-endpoint";
      }
    }
    return JSON.stringify([
      auth?.session.supabaseUrl,
      auth?.session.userId,
      endpoint,
      connectionConfig?.host,
      connectionConfig?.port,
      connectionConfig?.desktopId ?? connection.desktopId,
    ]);
  }, [
    auth?.session.supabaseUrl,
    auth?.session.userId,
    imageEndpointUrl,
    connectionConfig?.host,
    connectionConfig?.port,
    connectionConfig?.desktopId,
    connection.desktopId,
  ]);

  const loadImage = useCallback(
    async (eventId: string, imageIndex: number) => {
      if (!rpc || !activeRoundId) throw new Error("Desktop is unavailable");
      const response = await rpc.call<{ dataUrl?: unknown }>("session/image", {
        sessionId,
        roundId: activeRoundId,
        eventId,
        imageIndex,
      });
      const url = response?.dataUrl;
      if (
        typeof url !== "string" ||
        url.length > 525000 ||
        !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(url)
      ) {
        throw new Error("Invalid image response");
      }
      return url;
    },
    [rpc, sessionId, activeRoundId]
  );

  useEffect(() => {
    void subscribeSession(subscriptionKey).catch(() => undefined);
    return () => {
      void unsubscribeSession();
    };
  }, [subscriptionKey, subscribeSession, unsubscribeSession]);

  const writable =
    connection.status === "connected" &&
    connection.presence === "online" &&
    connection.tier !== "read_only";
  useEffect(() => {
    if (
      (transcriptPhase === "ready" || transcriptPhase === "empty") &&
      transcriptSessionId === sessionId &&
      connection.status === "connected" &&
      connection.presence === "online" &&
      connection.capabilities?.sessionReadState === true
    ) {
      readStateSync?.markVisited(sessionId);
    }
  }, [
    transcriptPhase,
    transcriptSessionId,
    sessionId,
    connection.status,
    connection.presence,
    connection.capabilities?.sessionReadState,
    readStateSync,
  ]);
  const sendSupported =
    (opened?.managed || sendCapability !== "read_only") &&
    (!combinedOpen || (Boolean(opened) && openingReady));
  const composerDisabled = !writable || !sendSupported;
  const permissionOpen =
    activePermission != null && activePermission.sessionId === sessionId;
  const canOpenDesktopFile =
    writable &&
    (!combinedOpen || openingReady) &&
    Boolean(activeRoundId) &&
    connection.capabilities?.openSessionFile === true;

  const handleSend = useCallback(
    async (content: string, attachments: MobileSendAttachment[] = []) => {
      await sendMessage(sessionId, content, attachments);
    },
    [sendMessage, sessionId]
  );

  const handleOpenDesktopFile = useCallback(
    async (eventId: string, target: { targetIndex: number }) => {
      if (!activeRoundId) return;
      await openSessionFileInDesktop(
        sessionId,
        activeRoundId,
        eventId,
        target.targetIndex
      );
    },
    [activeRoundId, openSessionFileInDesktop, sessionId]
  );

  const activeSendStatus =
    sendStatus?.sessionId === sessionId ? sendStatus : null;
  const waitingForAgent =
    (activeSendStatus?.phase === "submitting" ||
      activeSendStatus?.phase === "accepted") &&
    !transcriptItems.some((item) => item.kind !== "user");
  const composerStatus = activeSendStatus
    ? activeSendStatus.phase === "submitting"
      ? t("composerSending")
      : activeSendStatus.phase === "accepted"
        ? t("composerAccepted")
        : activeSendStatus.phase === "uncertain"
          ? t("composerUncertain")
          : activeSendStatus.phase === "completed"
            ? t("composerCompleted")
            : activeSendStatus.message || t("composerSendFailed")
    : undefined;

  const handleRetryHistory = useCallback(() => {
    if (activeRoundId) {
      retrySelectedRound();
    } else {
      void subscribeSession(sessionId).catch(() => undefined);
    }
  }, [activeRoundId, retrySelectedRound, sessionId, subscribeSession]);

  // A failed answer leaves the prompt queued so the user can tap again;
  // swallow the rejection rather than leaking an unhandled promise.
  const handleAllow = useCallback(() => {
    void respondPermission("allow").catch(() => undefined);
  }, [respondPermission]);

  const handleDeny = useCallback(() => {
    void respondPermission("deny").catch(() => undefined);
  }, [respondPermission]);

  const handleAlwaysAllow = useCallback(() => {
    void respondPermission("always_allow").catch(() => undefined);
  }, [respondPermission]);

  const handleSelectModel = useCallback(
    async (option: MobileModelOption) => {
      await setSessionModel(sessionId, option);
    },
    [sessionId, setSessionModel]
  );

  const modelSelectionEnabled =
    connection.capabilities?.modelSelection !== false &&
    sessionModel.config?.modelEditable !== false;

  return (
    <>
      <MobileTopBar
        title={sessionName}
        onBack={onBack}
        trailing={
          <Button
            htmlType="button"
            size="mini"
            variant="tertiary"
            tone="danger"
            shape="circle"
            className="mobile-chrome-icon-button"
            style={{
              width: "var(--mobile-touch-size)",
              height: "var(--mobile-touch-size)",
            }}
            aria-label={t("stopConfirm.confirm")}
            onClick={onOpenStopModal}
            disabled={!writable || !sendSupported}
            iconOnly
            icon={<HugeiconsIcon icon={StopCircleIcon} size={18} />}
          />
        }
      />
      <div className="relative flex min-h-0 flex-1 flex-col bg-chat-container">
        <RoundNavigator
          rounds={transcriptRounds}
          roundsComplete={transcriptRoundsComplete}
          truncated={transcriptTruncated}
          selectedRoundId={selectedRoundId}
          onSelectRound={selectRound}
        />
        <ChatTranscript
          sessionId={sessionId}
          roundId={activeRoundId}
          round={transcriptRounds.find((round) => round.id === activeRoundId)}
          imageScope={imageScope}
          items={transcriptItems}
          phase={transcriptPhase}
          error={transcriptError}
          forceFollowKey={activeSendStatus?.turnIntentId}
          waitingForAgent={waitingForAgent}
          footer={
            connection.capabilities?.changeReview && activeRoundId ? (
              <MobileChangeReview
                key={`${sessionId}:${activeRoundId}`}
                client={rpc}
                sessionId={sessionId}
                roundId={activeRoundId}
                online={connection.presence === "online"}
                revision={transcriptItems
                  .filter((item) => item.kind === "tool")
                  .map((item) => `${item.id}:${item.toolStatus}`)
                  .join("|")}
              />
            ) : undefined
          }
          onOpenFile={canOpenDesktopFile ? handleOpenDesktopFile : undefined}
          onRetry={handleRetryHistory}
          loadImage={
            connection.presence === "online" &&
            connection.capabilities?.sessionImages
              ? loadImage
              : undefined
          }
        />
        <MobileComposer
          key={draftScope}
          draftScope={draftScope}
          disabled={composerDisabled}
          disabledReason={
            connection.tier === "read_only"
              ? t("composerDeviceReadOnly")
              : !sendSupported
                ? t("composerReadOnly")
                : composerDisabled
                  ? t("composerOffline")
                  : sessionModel.error
          }
          statusMessage={composerStatus}
          statusTone={
            activeSendStatus?.phase === "failed" ||
            activeSendStatus?.phase === "cancelled" ||
            activeSendStatus?.phase === "uncertain"
              ? "error"
              : "neutral"
          }
          onSend={handleSend}
          modelPicker={
            modelSelectionEnabled
              ? {
                  config: sessionModel.config,
                  options: sessionModel.options,
                  loading: sessionModel.loading,
                  optionsLoading: sessionModel.optionsLoading,
                  error: sessionModel.optionsError,
                  onActivate: () => {
                    void loadSessionModels(sessionId).catch((error) =>
                      logger.warn("Background operation failed", error)
                    );
                  },
                  onRetry: () => {
                    void loadSessionModels(sessionId).catch((error) =>
                      logger.warn("Background operation failed", error)
                    );
                  },
                  patching: sessionModel.patching,
                  open: modelPickerOpen,
                  onOpen: () => {
                    setModelPickerOpen(true);
                    void loadSessionModels(sessionId).catch((error) =>
                      logger.warn("Background operation failed", error)
                    );
                  },
                  onClose: () => setModelPickerOpen(false),
                  onSelect: handleSelectModel,
                }
              : undefined
          }
        />
      </div>
      <PermissionSheet
        open={permissionOpen}
        request={permissionOpen ? activePermission : null}
        desktopName={connection.desktopName}
        queueDepth={permissionQueueDepth}
        submitting={!writable || permissionSubmitting}
        error={permissionFailed ? t("permission.submitFailed") : undefined}
        notice={
          activePermission?.toolArgsTruncated ? t("inbox.truncated") : undefined
        }
        onAllow={handleAllow}
        onDeny={handleDeny}
        onAlwaysAllow={handleAlwaysAllow}
        onDismiss={permissionSubmitting ? undefined : dismissPermissionHead}
      />
    </>
  );
}

SessionChatScreen.displayName = "SessionChatScreen";

const logger = createLogger("SessionChatScreen");

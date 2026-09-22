import React, { useContext } from "react";
import { useTranslation } from "react-i18next";

import { createLogger } from "@src/hooks/logger";

import { MobileRemoteProviders, useMobileRemote } from "./app";
import { MobileAuthContext } from "./auth/MobileAuthContext";
import { MobileShell } from "./components/MobileShell";
import { MobileTabBar } from "./components/MobileTabBar";
import { StopConfirmModal } from "./components/modals/StopConfirmModal";
import { MobileProfileEntry } from "./components/profile/MobileProfileEntry";
import { mobileConnectionFailureKey } from "./connection/mobileConnectionFeedback";
import { useMobileRemoteCoordinator } from "./navigation/useMobileRemoteCoordinator";
import { ConnectingLiveBridge } from "./screens/ConnectingLiveBridge";
import { ConnectingScreen } from "./screens/ConnectingScreen";
import { ConnectionErrorScreen } from "./screens/ConnectionErrorScreen";
import { QRScanScreen } from "./screens/QRScanScreen";
import { SASConfirmScreen } from "./screens/SASConfirmScreen";
import { SessionChatScreen } from "./screens/SessionChatScreen";
import { SessionsScreen } from "./screens/SessionsScreen";
import { WelcomeScreen } from "./screens/WelcomeScreen";
import { ConnectionDevicesScreen } from "./screens/devices/ConnectionDevicesScreen";
import { SettingsTab } from "./screens/settings/SettingsTab";

export interface MobileRemoteAppProps {
  authUserId: string;
  /** Credential-bearing pairing URL captured opaquely before authentication. */
  recoveredPairingIntent?: string | null;
  /** Relay WebSocket URL — when set, skips demo fixtures. */
  relayUrl?: string;
}

interface MobileRemoteRoutesProps {
  recoveredPairingIntent: string | null;
}

function MobileRemoteRoutes({
  recoveredPairingIntent,
}: MobileRemoteRoutesProps) {
  const {
    connection,
    nav,
    dispatch,
    stopConfirming,
    stopFailed,
    connectionRecovering,
    connectionRecoveryError,
    showTabBar,
    selectedSessionName,
    selectedSessionSendCapability,
    handleConnectingComplete,
    handleAcceptPairing,
    handleConfirmStop,
    handleConnectionRetry,
    handleConnectionRepair,
  } = useMobileRemoteCoordinator(recoveredPairingIntent);
  const { t } = useTranslation("mobileRemote");
  const { bootstrapPending, connectionConfig } = useMobileRemote();

  // Manual recovery owns the handshake; do not remount ConnectingLiveBridge
  // with an old pending config and start a second connection in parallel.
  if (bootstrapPending || connectionRecovering) {
    return (
      <MobileShell>
        <ConnectingScreen restoring />
      </MobileShell>
    );
  }

  if (connection.status === "error") {
    return (
      <MobileShell>
        <ConnectionErrorScreen
          message={t(mobileConnectionFailureKey(connection.error))}
          onRetry={() => {
            void handleConnectionRetry().catch((error) =>
              logger.warn("Connection retry failed", error)
            );
          }}
          onRepair={() => {
            void handleConnectionRepair().catch((error) =>
              logger.warn("Connection repair failed", error)
            );
          }}
          busy={connectionRecovering}
          actionError={connectionRecoveryError}
        />
      </MobileShell>
    );
  }

  let body: React.ReactNode;
  switch (nav.screen) {
    case "welcome":
      body = (
        <WelcomeScreen
          profileAction={<MobileProfileEntry />}
          onOpenPairing={() => dispatch({ type: "open_qr_scan" })}
        />
      );
      break;
    case "qr_scan":
      body = (
        <QRScanScreen
          onBack={() => dispatch({ type: "back_from_qr_scan" })}
          onAcceptPairing={handleAcceptPairing}
        />
      );
      break;
    case "sas":
      body = (
        <SASConfirmScreen
          phrase={nav.sasPhrase}
          onBack={() => dispatch({ type: "back_from_sas" })}
          onConfirm={() => dispatch({ type: "confirm_sas" })}
        />
      );
      break;
    case "connecting":
      body = (
        <ConnectingLiveBridge
          pendingConfig={nav.pendingConfig}
          demoMode={connection.demoMode}
          onComplete={handleConnectingComplete}
        />
      );
      break;
    case "connection_devices":
      body = (
        <ConnectionDevicesScreen
          onBack={() => dispatch({ type: "back_from_devices" })}
          onAddDesktop={() => dispatch({ type: "open_qr_scan" })}
        />
      );
      break;
    case "sessions":
    case "chat":
      if (nav.selectedSessionId) {
        body = (
          <>
            <SessionChatScreen
              onCanonicalSession={(sessionId) =>
                dispatch({ type: "select_session", sessionId })
              }
              sessionId={nav.selectedSessionId}
              sessionName={selectedSessionName}
              sendCapability={selectedSessionSendCapability}
              onBack={() => dispatch({ type: "back_from_chat" })}
              onOpenStopModal={() => dispatch({ type: "open_stop_modal" })}
            />
            <StopConfirmModal
              visible={nav.stopModalOpen}
              confirming={stopConfirming}
              failed={stopFailed}
              onCancel={() => dispatch({ type: "close_stop_modal" })}
              onConfirm={() => void handleConfirmStop().catch(() => undefined)}
            />
          </>
        );
      } else if (nav.activeTab === "settings") {
        body = (
          <SettingsTab
            onOpenDevices={() => dispatch({ type: "open_devices" })}
          />
        );
      } else {
        body = null;
      }
      break;
    default:
      body = null;
  }

  return (
    <MobileShell
      footer={
        showTabBar ? (
          <MobileTabBar
            active={nav.activeTab}
            onChange={(tab) => dispatch({ type: "set_tab", tab })}
          />
        ) : null
      }
    >
      {nav.screen === "sessions" ||
      nav.screen === "chat" ||
      nav.screen === "connection_devices" ? (
        <SessionsScreen
          key={JSON.stringify([
            connectionConfig?.desktopId ?? connection.desktopId,
            connectionConfig?.host,
            connectionConfig?.port,
          ])}
          active={
            nav.screen === "sessions" &&
            !nav.selectedSessionId &&
            nav.activeTab === "sessions"
          }
          profileAction={<MobileProfileEntry />}
          onSelectSession={(sessionId) =>
            dispatch({ type: "select_session", sessionId })
          }
        />
      ) : null}
      {body}
    </MobileShell>
  );
}

/** Mobile Remote PWA root. @see docs/mobile-remote-2026-08-28/UI-SPEC.md */
export function MobileRemoteApp({
  authUserId,
  recoveredPairingIntent = null,
  relayUrl,
}: MobileRemoteAppProps) {
  const auth = useContext(MobileAuthContext);
  return (
    <MobileRemoteProviders
      key={JSON.stringify([authUserId, auth?.session.supabaseUrl, relayUrl])}
      authUserId={authUserId}
      relayUrl={relayUrl}
      demoByDefault={false}
      suppressInitialBootstrap={recoveredPairingIntent !== null}
    >
      <MobileRemoteRoutes recoveredPairingIntent={recoveredPairingIntent} />
    </MobileRemoteProviders>
  );
}

MobileRemoteApp.displayName = "MobileRemoteApp";

const logger = createLogger("MobileRemoteApp");

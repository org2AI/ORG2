import React from "react";

import { MobileRemoteProviders } from "./app";
import { MobileShell } from "./components/MobileShell";
import { MobileTabBar } from "./components/MobileTabBar";
import { StopConfirmModal } from "./components/modals/StopConfirmModal";
import { useMobileRemoteCoordinator } from "./navigation/useMobileRemoteCoordinator";
import { ConnectingLiveBridge } from "./screens/ConnectingLiveBridge";
import { ConnectionErrorScreen } from "./screens/ConnectionErrorScreen";
import { QRScanScreen } from "./screens/QRScanScreen";
import { SASConfirmScreen } from "./screens/SASConfirmScreen";
import { SessionChatScreen } from "./screens/SessionChatScreen";
import { SessionsScreen } from "./screens/SessionsScreen";
import { WelcomeScreen } from "./screens/WelcomeScreen";
import { DevicesTab } from "./screens/devices/DevicesTab";
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
    showTabBar,
    selectedSessionName,
    selectedSessionSendCapability,
    handleConnectingComplete,
    handleAcceptPairing,
    handleConfirmStop,
    handleConnectionRetry,
  } = useMobileRemoteCoordinator(recoveredPairingIntent);

  if (connection.status === "error") {
    return (
      <MobileShell>
        <ConnectionErrorScreen
          message={connection.error?.message}
          onRetry={handleConnectionRetry}
        />
      </MobileShell>
    );
  }

  let body: React.ReactNode;
  switch (nav.screen) {
    case "welcome":
      body = (
        <WelcomeScreen
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
    case "sessions":
    case "chat":
      if (nav.selectedSessionId) {
        body = (
          <>
            <SessionChatScreen
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
      } else if (nav.activeTab === "devices") {
        body = <DevicesTab />;
      } else if (nav.activeTab === "settings") {
        body = <SettingsTab />;
      } else {
        body = (
          <SessionsScreen
            onSelectSession={(sessionId) =>
              dispatch({ type: "select_session", sessionId })
            }
          />
        );
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
  return (
    <MobileRemoteProviders
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

import React, { useRef } from "react";
import { useTranslation } from "react-i18next";

import { OAuthSessionSetupShell } from "@src/features/SessionSetup/components/OAuthSessionSetupShell";
import { useCodexOAuthCapture } from "@src/features/SessionSetup/hooks/useCodexOAuthCapture";
import { useWebviewPositionSync } from "@src/features/SessionSetup/hooks/useWebviewPositionSync";

export interface CodexSessionValues {
  accessToken: string;
  refreshToken: string;
  idToken: string;
  expiresIn?: number;
}

interface CodexSessionSetupProps {
  onSessionCaptured?: (values: CodexSessionValues) => void;
  onBrowserStateChange?: (isOpen: boolean) => void;
  debug?: boolean;
  tokenDetected?: boolean;
  tokenError?: string | null;
  onClearTokenError?: () => void;
  closeSignal?: number;
  autoStart?: boolean;
}

const CodexSessionSetup: React.FC<CodexSessionSetupProps> = ({
  onSessionCaptured,
  onBrowserStateChange,
  debug = false,
  tokenDetected = false,
  tokenError = null,
  onClearTokenError,
  closeSignal = 0,
  autoStart = false,
}) => {
  const { t } = useTranslation("integrations");
  const containerRef = useRef<HTMLDivElement>(null);

  const capture = useCodexOAuthCapture({
    containerRef,
    debug,
    onTokenCaptured: (response) => {
      onSessionCaptured?.({
        accessToken: response.accessToken,
        refreshToken: response.refreshToken,
        idToken: response.idToken,
        expiresIn: response.expiresIn ?? undefined,
      });
    },
  });
  const {
    isWebviewOpen,
    currentUrl,
    accessToken,
    refreshToken,
    idToken,
    expiresIn,
    updatePosition,
  } = capture;

  useWebviewPositionSync(containerRef, isWebviewOpen, updatePosition);

  const hasToken = tokenDetected || capture.isSignedIn || Boolean(accessToken);

  return (
    <OAuthSessionSetupShell
      providerId="codex"
      containerRef={containerRef}
      capture={capture}
      hasToken={hasToken}
      tokenError={tokenError}
      onClearTokenError={onClearTokenError}
      onBrowserStateChange={onBrowserStateChange}
      closeSignal={closeSignal}
      initiallyOpen={autoStart}
      copy={{
        signInTitle: t("keyVault.codexSignInTitle"),
        signInDescription: t("keyVault.codexSignInDesc"),
        signInButton: t("keyVault.signInWithCodex"),
        signedInTitle: t("keyVault.codexSignedIn"),
        signedInStatus: t("keyVault.signedIn"),
        loginStep: t("keyVault.loginStep"),
        browserHint: t("keyVault.codexBrowserHint"),
        readyTitle: t("keyVault.codexReadyToSignIn"),
        oauthHint: t("keyVault.codexOAuthHint"),
        loading: t("keyVault.loadingText"),
        failedToLoadBrowser: t("keyVault.failedToLoadBrowser"),
        retry: t("common:actions.retry"),
        errorHint: t("keyVault.codexSignInErrorHint"),
      }}
      debugContent={
        debug ? (
          <>
            <div>
              Access Token:{" "}
              {accessToken ? `${accessToken.slice(0, 24)}...` : "null"}
            </div>
            <div>
              Refresh Token:{" "}
              {refreshToken ? `${refreshToken.slice(0, 24)}...` : "null"}
            </div>
            <div>
              Id Token: {idToken ? `${idToken.slice(0, 24)}...` : "null"}
            </div>
            <div>Expires In: {expiresIn ?? "null"}</div>
            <div>Is Webview Open: {String(isWebviewOpen)}</div>
            <div>Current URL: {currentUrl || "null"}</div>
          </>
        ) : undefined
      }
    />
  );
};

export default CodexSessionSetup;

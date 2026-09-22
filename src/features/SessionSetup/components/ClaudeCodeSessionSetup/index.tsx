import React, { useRef } from "react";
import { useTranslation } from "react-i18next";

import { OAuthSessionSetupShell } from "@src/features/SessionSetup/components/OAuthSessionSetupShell";
import { useClaudeCodeOAuthCapture } from "@src/features/SessionSetup/hooks/useClaudeCodeOAuthCapture";
import { useWebviewPositionSync } from "@src/features/SessionSetup/hooks/useWebviewPositionSync";

export interface ClaudeCodeSessionValues {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  accountMetadata?: Record<string, string>;
}

interface ClaudeCodeSessionSetupProps {
  onSessionCaptured?: (values: ClaudeCodeSessionValues) => void;
  onBrowserStateChange?: (isOpen: boolean) => void;
  debug?: boolean;
  tokenDetected?: boolean;
  tokenError?: string | null;
  onClearTokenError?: () => void;
  closeSignal?: number;
}

function toClaudeCodeAccountMetadata(
  metadata: Record<string, string | null | undefined> | null | undefined
): Record<string, string> | undefined {
  if (!metadata) return undefined;
  const entries: Array<[string, string | null | undefined]> = [
    ["email", metadata.email],
    ["organization_uuid", metadata.organizationUuid],
    ["organization_name", metadata.organizationName],
    ["organization_type", metadata.organizationType],
    ["rate_limit_tier", metadata.rateLimitTier],
  ];
  const out = Object.fromEntries(
    entries.filter(
      ([, value]) => typeof value === "string" && value.trim() !== ""
    )
  ) as Record<string, string>;
  return Object.keys(out).length > 0 ? out : undefined;
}

const ClaudeCodeSessionSetup: React.FC<ClaudeCodeSessionSetupProps> = ({
  onSessionCaptured,
  onBrowserStateChange,
  debug = false,
  tokenDetected = false,
  tokenError = null,
  onClearTokenError,
  closeSignal = 0,
}) => {
  const { t } = useTranslation("integrations");
  const containerRef = useRef<HTMLDivElement>(null);

  const capture = useClaudeCodeOAuthCapture({
    containerRef,
    debug,
    onTokenCaptured: (response) => {
      onSessionCaptured?.({
        accessToken: response.accessToken,
        refreshToken: response.refreshToken ?? undefined,
        expiresIn: response.expiresIn ?? undefined,
        accountMetadata: toClaudeCodeAccountMetadata(response.accountMetadata),
      });
    },
  });
  const {
    isWebviewOpen,
    currentUrl,
    accessToken,
    refreshToken,
    expiresIn,
    updatePosition,
  } = capture;

  useWebviewPositionSync(containerRef, isWebviewOpen, updatePosition);

  const hasToken = tokenDetected || capture.isSignedIn || Boolean(accessToken);

  return (
    <OAuthSessionSetupShell
      providerId="claude-code"
      containerRef={containerRef}
      capture={capture}
      hasToken={hasToken}
      tokenError={tokenError}
      onClearTokenError={onClearTokenError}
      onBrowserStateChange={onBrowserStateChange}
      closeSignal={closeSignal}
      copy={{
        signInTitle: t("keyVault.claudeCodeSignInTitle"),
        signInDescription: t("keyVault.claudeCodeSignInDesc"),
        signInButton: t("keyVault.signInWithClaudeCode"),
        signedInTitle: t("keyVault.claudeCodeSignedIn"),
        signedInStatus: t("keyVault.signedIn"),
        loginStep: t("keyVault.loginStep"),
        browserHint: t("keyVault.claudeCodeBrowserHint"),
        readyTitle: t("keyVault.claudeCodeReadyToSignIn"),
        oauthHint: t("keyVault.claudeCodeOAuthHint"),
        loading: t("keyVault.loadingText"),
        failedToLoadBrowser: t("keyVault.failedToLoadBrowser"),
        retry: t("common:actions.retry"),
        errorHint: t("keyVault.claudeCodeSignInErrorHint"),
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
            <div>Expires In: {expiresIn ?? "null"}</div>
            <div>Is Webview Open: {String(isWebviewOpen)}</div>
            <div>Current URL: {currentUrl || "null"}</div>
          </>
        ) : undefined
      }
    />
  );
};

export default ClaudeCodeSessionSetup;

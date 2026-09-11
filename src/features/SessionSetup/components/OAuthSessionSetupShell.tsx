import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import Button from "@src/components/Button";
import PageNotice from "@src/components/PageNotice";
import { SPINNER_TOKENS } from "@src/config/spinnerTokens";
import SessionSetupStepIndicator from "@src/features/SessionSetup/components/SessionSetupStepIndicator";
import { useOAuthBrowserAutoStart } from "@src/features/SessionSetup/hooks/useOAuthBrowserAutoStart";
import {
  AlertCircleIcon,
  ArrowRight01Icon,
  Cancel01Icon,
  CheckmarkCircle01Icon,
  HugeiconsIcon,
  Loading03Icon,
  Login01Icon,
  Refresh04Icon,
} from "@src/icons";
import {
  SectionContainer,
  SectionRow,
} from "@src/modules/shared/layouts/SectionLayout";

/**
 * Localized strings a provider supplies to the shared OAuth shell. Every key
 * maps 1:1 onto a `t()` call the provider component used to make inline.
 */
export interface OAuthSessionSetupCopy {
  signInTitle: string;
  signInDescription: string;
  signInButton: string;
  signedInTitle: string;
  signedInStatus: string;
  loginStep: string;
  browserHint: string;
  readyTitle: string;
  oauthHint: string;
  loading: string;
  failedToLoadBrowser: string;
  retry: string;
  close: string;
  errorHint: string;
}

/**
 * The slice of a provider's OAuth capture hook the shell drives. Both
 * `useClaudeCodeOAuthCapture` and `useCodexOAuthCapture` return a superset of
 * this shape; provider-only fields (tokens, id token, expiry) stay with the
 * provider component.
 */
export interface OAuthSessionSetupCaptureState {
  isSigningIn: boolean;
  isSignedIn: boolean;
  isWebviewOpen: boolean;
  isWebviewLoading: boolean;
  currentUrl: string;
  authUrl: string | null;
  error: string | null;
  startLogin: () => Promise<void>;
  closeWebview: () => Promise<void>;
  reset: () => void;
}

export interface OAuthSessionSetupShellProps {
  /** Prefix for every `data-testid` the shell renders (`claude-code`, `codex`). */
  providerId: string;
  /** Element the native WebView is positioned over; the provider owns the ref. */
  containerRef: RefObject<HTMLDivElement | null>;
  capture: OAuthSessionSetupCaptureState;
  /** Provider-computed: detected token, signed-in capture, or a held access token. */
  hasToken: boolean;
  tokenError?: string | null;
  onClearTokenError?: () => void;
  onBrowserStateChange?: (isOpen: boolean) => void;
  closeSignal?: number;
  /** Mount with the browser surface already open (Codex `autoStart`). */
  initiallyOpen?: boolean;
  copy: OAuthSessionSetupCopy;
  /** Provider-specific debug rows; rendered inside the shared debug container. */
  debugContent?: ReactNode;
}

/**
 * Shared presentation and browser lifecycle for the embedded-WebView OAuth
 * providers (Claude Code, Codex).
 *
 * Owns only the transient `showBrowser` intent and its transitions: open on
 * click, one auto-started PKCE attempt per open (delegated to
 * `useOAuthBrowserAutoStart`), collapse after a completed sign-in, explicit
 * retry, X-button close, and the wizard's external `closeSignal`. Token
 * capture, callback handling and provider metadata stay in the provider
 * component and its capture hook.
 *
 * Retry and close are guarded: a retry while a `startLogin` is still in
 * flight is ignored, and a close (X button or `closeSignal`) while the
 * browser is already closed does not issue a second native close.
 */
export function OAuthSessionSetupShell({
  providerId,
  containerRef,
  capture,
  hasToken,
  tokenError = null,
  onClearTokenError,
  onBrowserStateChange,
  closeSignal = 0,
  initiallyOpen = false,
  copy,
  debugContent,
}: OAuthSessionSetupShellProps) {
  const {
    isSigningIn,
    isSignedIn,
    isWebviewOpen,
    isWebviewLoading,
    currentUrl,
    authUrl,
    error,
    startLogin,
    closeWebview,
    reset,
  } = capture;
  const [showBrowser, setShowBrowser] = useState(initiallyOpen);
  // Mirrors `showBrowser` synchronously so two closes inside one event loop
  // turn (double click, X click racing a closeSignal) collapse to one native
  // close before React re-renders.
  const showBrowserRef = useRef(initiallyOpen);
  const retryInFlightRef = useRef(false);

  const setBrowserVisibility = useCallback((isOpen: boolean) => {
    showBrowserRef.current = isOpen;
    setShowBrowser(isOpen);
  }, []);

  useEffect(() => {
    onBrowserStateChange?.(showBrowser);
  }, [showBrowser, onBrowserStateChange]);

  useEffect(() => {
    if (!isWebviewOpen && isSignedIn) {
      queueMicrotask(() => setBrowserVisibility(false));
    }
  }, [isSignedIn, isWebviewOpen, setBrowserVisibility]);

  useOAuthBrowserAutoStart(showBrowser, startLogin);

  const handleCloseBrowser = useCallback(() => {
    if (!showBrowserRef.current) return;
    setBrowserVisibility(false);
    void closeWebview().catch(() => undefined);
  }, [closeWebview, setBrowserVisibility]);

  useEffect(() => {
    if (closeSignal <= 0 || !showBrowser) return;
    queueMicrotask(() => handleCloseBrowser());
  }, [closeSignal, handleCloseBrowser, showBrowser]);

  const handleRetry = useCallback(() => {
    if (retryInFlightRef.current) return;
    retryInFlightRef.current = true;
    reset();
    setBrowserVisibility(true);
    void startLogin()
      .finally(() => {
        retryInFlightRef.current = false;
      })
      .catch(() => undefined);
  }, [reset, setBrowserVisibility, startLogin]);

  const displayError = error ?? tokenError;
  const currentStep = hasToken ? 2 : 1;

  return (
    <div
      className="flex h-full min-h-0 w-full flex-1 flex-col gap-3"
      data-testid={`${providerId}-session-setup`}
    >
      {!showBrowser ? (
        <SectionContainer>
          <SectionRow
            label={hasToken ? copy.signedInTitle : copy.signInTitle}
            description={
              hasToken ? copy.signedInStatus : copy.signInDescription
            }
            required
          >
            <Button
              variant={hasToken ? "success" : "primary"}
              appearance={hasToken ? "outline" : "solid"}
              size="default"
              loading={isSigningIn || isWebviewLoading}
              disabled={isSigningIn || isWebviewLoading}
              onClick={() => setBrowserVisibility(true)}
              className="h-8 min-h-8"
              data-testid={`${providerId}-oauth-signin`}
            >
              {hasToken ? `✓ ${copy.signedInStatus}` : copy.signInButton}
            </Button>
          </SectionRow>
        </SectionContainer>
      ) : (
        <div
          className="flex min-h-0 flex-1 flex-col overflow-hidden bg-fill-2"
          data-testid={`${providerId}-oauth-browser-shell`}
        >
          <div className="flex h-10 items-center border-b border-border-2 bg-fill-2 px-3">
            <div
              className="flex-1 overflow-hidden text-[12px] text-ellipsis whitespace-nowrap text-text-1"
              data-testid={`${providerId}-oauth-current-url`}
            >
              {currentUrl || authUrl || copy.readyTitle}
            </div>
            <Button
              variant="tertiary"
              size="mini"
              icon={
                <HugeiconsIcon
                  icon={Refresh04Icon}
                  data-icon="refresh-cw"
                  size={12}
                />
              }
              iconOnly
              aria-label={copy.retry}
              title={copy.retry}
              onClick={handleRetry}
            />
            <Button
              variant="tertiary"
              size="mini"
              icon={
                <HugeiconsIcon icon={Cancel01Icon} data-icon="x" size={14} />
              }
              iconOnly
              aria-label={copy.close}
              title={copy.close}
              onClick={handleCloseBrowser}
              data-testid={`${providerId}-oauth-browser-close`}
            />
          </div>

          <div className="flex h-9 items-center justify-between gap-2 border-b border-border-2 bg-fill-2 px-4">
            <div className="flex items-center gap-2">
              <SessionSetupStepIndicator
                step={1}
                currentStep={currentStep}
                label={copy.loginStep}
                completed={hasToken}
              />
              <HugeiconsIcon
                icon={ArrowRight01Icon}
                data-icon="chevron-right"
                size={14}
                className="text-text-3"
              />
              <SessionSetupStepIndicator
                step={2}
                currentStep={currentStep}
                label={copy.signedInStatus}
                completed={hasToken}
              />
            </div>
            {!hasToken && (
              <span className="text-[12px] text-text-2">
                {copy.browserHint}
              </span>
            )}
          </div>

          <div
            ref={containerRef}
            className="relative min-h-0 w-full flex-1 overflow-hidden bg-bg-1"
            data-testid={`${providerId}-oauth-webview-container`}
          >
            {(isSigningIn || isWebviewLoading) && (
              <div
                className="absolute inset-0 flex items-center justify-center bg-bg-1"
                role="status"
              >
                <HugeiconsIcon
                  icon={Loading03Icon}
                  data-icon="loader-2"
                  size={SPINNER_TOKENS.default}
                  className="animate-spin text-primary-6"
                />
                <span className="ml-2 text-text-2">{copy.loading}</span>
              </div>
            )}
            {displayError && (
              <div
                className="absolute inset-0 flex flex-col items-center justify-center bg-bg-1 p-6 text-center"
                role="alert"
              >
                <HugeiconsIcon
                  icon={AlertCircleIcon}
                  data-icon="alert-circle"
                  size={32}
                  className="mb-3 text-danger-6"
                />
                <div className="mb-2 text-[14px] text-text-2">
                  {copy.failedToLoadBrowser}
                </div>
                <div className="mb-4 text-[12px] text-text-3">
                  {displayError}
                </div>
                <Button variant="primary" size="default" onClick={handleRetry}>
                  {copy.retry}
                </Button>
              </div>
            )}
            {!isWebviewOpen && !isSigningIn && !displayError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-bg-1 p-6 text-center">
                {hasToken ? (
                  <HugeiconsIcon
                    icon={CheckmarkCircle01Icon}
                    data-icon="check-circle"
                    size={32}
                    className="mb-3 text-success-6"
                  />
                ) : (
                  <HugeiconsIcon
                    icon={Login01Icon}
                    data-icon="log-in"
                    size={32}
                    className="mb-3 text-text-3"
                  />
                )}
                <div className="mb-2 text-[14px] font-medium text-text-1">
                  {hasToken ? copy.signedInTitle : copy.readyTitle}
                </div>
                <div className="max-w-sm text-[12px] text-text-3">
                  {copy.oauthHint}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {hasToken && !showBrowser && (
        <PageNotice type="success">{copy.signedInTitle}</PageNotice>
      )}

      {displayError && !showBrowser && (
        <PageNotice
          type="danger"
          title={displayError}
          onClose={error ? reset : onClearTokenError}
        >
          {copy.errorHint}
        </PageNotice>
      )}

      {debugContent && (
        <div className="mt-4 rounded-lg bg-bg-3 p-3 text-[11px] text-text-3">
          {debugContent}
        </div>
      )}
    </div>
  );
}

export default OAuthSessionSetupShell;

/**
 * BrowserCore Component
 *
 * Reusable browser component that can work with:
 * 1. BrowserContext (for main browser page)
 * 2. Prop-based state (for simulator or standalone use)
 *
 * Features:
 * - Multiple sessions (tabs)
 * - URL navigation
 * - Loading states
 * - Error handling
 * - Native webview rendering
 */
import { useAtomValue } from "jotai";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import Message from "@src/components/Message";
import { Placeholder } from "@src/components/Placeholder";
import { createLogger } from "@src/hooks/logger";
import { useSustainedFlag } from "@src/hooks/ui/useSustainedFlag";
import {
  CloudLoadingIcon,
  Copy01Icon,
  HugeiconsIcon,
  MonitorIcon,
  Refresh04Icon,
} from "@src/icons";
import {
  webviewBlockedAtom,
  webviewOverlayBlockedAtom,
} from "@src/store/ui/overlayAtom";
import { activeOverlayCountAtom } from "@src/store/ui/overlayLayerAtom";
import { stationModeAtom } from "@src/store/ui/simulatorAtom";
import {
  browserWebviewLoadStateAtom,
  selectWebviewLoadState,
} from "@src/store/workstation/browser/webviewLoadStateAtom";
import { copyText } from "@src/util/data/clipboard";
import { getBrowserSessionWebviewLabel } from "@src/util/platform/tauri/browserSessionLabel";

import BrowserSessionWebview from "./BrowserSessionWebview";
import { useWebviewLoadFailure } from "./hooks/useWebviewLoadFailure";
import "./index.scss";
import { BROWSER_WEBVIEW_FRAME_ANCHOR_ATTRIBUTE } from "./nativeFrameAnchor";
import type { BrowserState } from "./types";
import {
  pushRecentWebviewId,
  selectMountedBrowserSessions,
} from "./webviewMountWindow";

const log = createLogger("BrowserCore");

const ABOUT_BLANK_URL = "about:blank";
const SHOW_WEBVIEW_FRAME_ANCHOR = false;
/**
 * How long an overlay must keep the native webview parked before the pane says
 * so. A tooltip or a hover-open sidebar also sends the webview to the back on
 * macOS, and a notice that flashes for those is noise, not an explanation.
 */
const OVERLAY_HIDDEN_NOTICE_DELAY_MS = 350;

function isBlankBrowserUrl(url?: string): boolean {
  const normalizedUrl = url?.trim().toLowerCase();
  return !normalizedUrl || normalizedUrl.startsWith(ABOUT_BLANK_URL);
}

// ============================================
// Props
// ============================================

interface BrowserCoreProps {
  /** Browser state (sessions, active session, handlers) */
  browserState: BrowserState;
  /** Whether to show modal-blocking detection (for hiding webview) */
  respectModalBlocking?: boolean;
  /** Custom className */
  className?: string;
  /** Show simulator-specific notice */
  showSimulatorNotice?: boolean;
  /** Optional complete placeholder shown only on a visible blank tab */
  blankTabPlaceholder?: React.ReactNode;
  /** Force hide all webviews (e.g., when designer mode is active) */
  hidden?: boolean;
  /**
   * Whether this BrowserCore instance owns and manages the native webview
   * lifecycle (create / destroy / position).  Defaults to true.
   *
   * Set to false for secondary viewers that share the same BrowserContext
   * sessions — only one instance should own the webviews; the other just
   * renders the chrome (tab bar, URL bar).
   */
  manageWebviews?: boolean;
  /**
   * Shared browser runtime owns the native webviews outside a specific station
   * subtree, so station-mode hiding is driven by host registration instead.
   */
  bypassStationModeBlocking?: boolean;
  /**
   * Suppresses every React status surface (blank-tab placeholder, loading,
   * overlay-hidden, load-failure, desktop-only, error) while still mounting the
   * native webview anchor.
   *
   * For `SharedBrowserApp`, which parks the owning instance in an `aria-hidden`,
   * pointer-events:none host stacked over the very rect the visible chrome
   * renders into. Without this it paints a second copy of every notice.
   */
  suppressStatusOverlays?: boolean;
}

// ============================================
// Component
// ============================================

export const BrowserCore: React.FC<BrowserCoreProps> = ({
  browserState,
  respectModalBlocking = true,
  className = "",
  showSimulatorNotice = false,
  blankTabPlaceholder,
  hidden = false,
  manageWebviews = true,
  bypassStationModeBlocking = false,
  suppressStatusOverlays = false,
}) => {
  const { t } = useTranslation();
  const { sessions, activeSessionId, updateSession, addSession } = browserState;

  // Most-recently-active browser session ids (newest first) — see
  // ./webviewMountWindow.ts for the mount policy this drives.
  const [recentWebviewIds, setRecentWebviewIds] = useState<readonly string[]>(
    []
  );
  // Derived-from-previous-render state (React's "storing information from
  // previous renders" pattern), matching TerminalCore: update synchronously
  // during render so an evicted session never renders once with stale data.
  if (activeSessionId) {
    const nextRecent = pushRecentWebviewId(recentWebviewIds, activeSessionId);
    if (nextRecent !== recentWebviewIds) setRecentWebviewIds(nextRecent);
  }
  const mountedWebviewSessions = selectMountedBrowserSessions(
    sessions,
    activeSessionId,
    recentWebviewIds
  );

  // Check if webviews should be blocked by overlays or station ownership.
  const isWebviewBlocked = useAtomValue(webviewBlockedAtom);
  // Overlay-only slice: station-mode ownership must not trigger the
  // "temporarily hidden" notice, because closing a dropdown won't fix that.
  const isOverlayBlocked = useAtomValue(webviewOverlayBlockedAtom);
  // macOS keeps the webview alive but sends it behind the React layer instead
  // of blocking it, so the pane still blanks without `isOverlayBlocked` set.
  const activeOverlayCount = useAtomValue(activeOverlayCountAtom);

  const stationMode = useAtomValue(stationModeAtom);
  // Non-owning shared surfaces are already scoped by their `hidden` prop.
  // Applying the native-webview station gate to them blanks My Station UI.
  const isSecondaryStationHidden =
    manageWebviews &&
    !respectModalBlocking &&
    !bypassStationModeBlocking &&
    stationMode !== "agent-station";

  // Refs for the browser content host and the exact native WebView anchor.
  const contentAreaRef = useRef<HTMLDivElement>(null);
  const webviewFrameAnchorRef = useRef<HTMLDivElement>(null);
  const webviewFrameAnchorDataAttr = useMemo(
    () => ({ [BROWSER_WEBVIEW_FRAME_ANCHOR_ATTRIBUTE]: "" }),
    []
  );

  // Find current session
  const currentSession = sessions.find((s) => s.id === activeSessionId);

  // Suppress ResizeObserver errors from multiple webviews
  useEffect(() => {
    const errorHandler = (event: ErrorEvent) => {
      if (
        event.message &&
        (event.message.includes("ResizeObserver loop") ||
          event.message.includes("ResizeObserver") ||
          event.message.includes(
            "loop completed with undelivered notifications"
          ))
      ) {
        log.warn("[BrowserCore] Suppressed ResizeObserver error");
        event.stopImmediatePropagation();
        event.preventDefault();
        return true;
      }
    };

    window.addEventListener("error", errorHandler, true);
    return () => window.removeEventListener("error", errorHandler, true);
  }, []);

  // Check if webview is available (Tauri environment)
  const isWebviewAvailable = useMemo(() => {
    if (typeof window === "undefined") return false;
    const win = window as unknown as Record<string, unknown>;
    return !!(win.__TAURI_INTERNALS__ || win.__TAURI_IPC__ || win.__TAURI__);
  }, []);

  // Determine if the tab is active in its current host.
  const isTabReallyActive = useMemo(() => {
    // Force hide when the owning surface or local tool mode is inactive.
    if (hidden) return false;
    if (isSecondaryStationHidden) return false;
    // Skip modal blocking check if not requested
    if (!respectModalBlocking) return true;
    // Check consolidated overlay and station blocking state.
    return !isWebviewBlocked;
  }, [
    hidden,
    isSecondaryStationHidden,
    respectModalBlocking,
    isWebviewBlocked,
  ]);

  const isLoadingRaw = currentSession?.isLoading || false;
  const displayError = currentSession?.error || null;
  const currentUrl = currentSession?.url;
  const hasSessionWithUrl = sessions.some(
    (session) => !isBlankBrowserUrl(session.url)
  );
  const shouldShowUrlPlaceholder =
    isTabReallyActive && isBlankBrowserUrl(currentSession?.url);
  const shouldRenderContentArea = hasSessionWithUrl || shouldShowUrlPlaceholder;
  // The aria-hidden owner host renders the native anchor only; every notice
  // below belongs to the visible chrome stacked over the same rect.
  const canShowStatusOverlays = !suppressStatusOverlays;

  /**
   * A dropdown/modal either blocks the native webview (`SharedBrowserApp`
   * hides it off `webviewOverlayBlockedAtom`) or, on macOS, drops it behind
   * the React layer (`useGlobalBrowserWebviewLayering`). Either way the pane
   * blanks, so nothing below may interpret that blankness as a load failure.
   */
  const isWebviewParkedByOverlay = isOverlayBlocked || activeOverlayCount > 0;

  /**
   * Deliberately NOT gated on `respectModalBlocking`: the visible chrome for
   * the shared runtime (`SharedBrowserWorkspace` -> `WebViewport`) passes
   * `respectModalBlocking={false}` because it does not own the webview — but
   * it is exactly the surface the user is looking at when the pane blanks.
   *
   * Sustained rather than immediate: every overlay primitive contributes to
   * `activeOverlayCount`, down to tooltips and the hover-open sidebar, and the
   * pane really is parked for each of them. Requiring the overlay to stay open
   * keeps a momentary hover from flashing a card telling the user to close a
   * menu they never opened.
   */
  const shouldShowOverlayHiddenNotice = useSustainedFlag(
    canShowStatusOverlays &&
      isWebviewAvailable &&
      !bypassStationModeBlocking &&
      isWebviewParkedByOverlay &&
      !hidden &&
      !isBlankBrowserUrl(currentUrl),
    OVERLAY_HIDDEN_NOTICE_DELAY_MS
  );

  // Native load evidence for the session's own webview. Absent until the first
  // phase arrives, which is itself the "never created" failure case.
  const webviewLoadStateMap = useAtomValue(browserWebviewLoadStateAtom);
  const currentSessionId = currentSession?.id;
  const currentWebviewLabel = currentSessionId
    ? getBrowserSessionWebviewLabel(currentSessionId)
    : undefined;
  const currentLoadState = selectWebviewLoadState(
    webviewLoadStateMap,
    currentWebviewLabel
  );

  const { hasFailed: showLoadFailureNotice, reset: resetLoadFailure } =
    useWebviewLoadFailure({
      sessionId: currentSessionId,
      url: isBlankBrowserUrl(currentUrl) ? undefined : currentUrl,
      loadState: currentLoadState,
      // Only a pane the user can actually see, with nothing else already
      // explaining its emptiness, is eligible to be called a failed load.
      isWatching:
        canShowStatusOverlays &&
        isWebviewAvailable &&
        isTabReallyActive &&
        !isWebviewParkedByOverlay &&
        !displayError,
    });

  // Delay showing the loading overlay by 500ms to avoid flash on fast loads
  const [isLoading, setIsLoading] = React.useState(false);
  React.useEffect(() => {
    if (!isLoadingRaw) {
      setIsLoading(false);
      return;
    }
    const timer = setTimeout(() => setIsLoading(true), 500);
    return () => clearTimeout(timer);
  }, [isLoadingRaw]);

  const handleCopyUrl = useCallback(() => {
    if (!currentUrl) return;
    copyText(currentUrl)
      .then(() => Message.success(t("status.copied")))
      .catch(() => Message.error(t("status.copyFailed")));
  }, [currentUrl, t]);

  return (
    <div
      className={`browser-core flex h-full min-h-0 w-full flex-col p-px ${className}`}
    >
      {/* Content area — one full-height host for both native webviews and
          React overlays. Empty-URL tabs render the placeholder inside this same
          host so an existing webview session cannot split the panel underneath. */}
      {shouldRenderContentArea && (
        <div className="browser-content" ref={contentAreaRef}>
          <div
            ref={webviewFrameAnchorRef}
            {...webviewFrameAnchorDataAttr}
            className={`browser-webview-frame-anchor ${
              SHOW_WEBVIEW_FRAME_ANCHOR ? "debug-visible" : ""
            }`}
            aria-hidden="true"
          />
          {shouldShowUrlPlaceholder && canShowStatusOverlays && (
            <div className="browser-native-info">
              {blankTabPlaceholder ?? (
                <Placeholder
                  variant="empty"
                  placement="detail-panel"
                  title={
                    currentSession?.incognito
                      ? t("workstation.browserCore.privateBrowsingEmptyTitle")
                      : t("workstation.browserCore.enterUrlToStart")
                  }
                  subtitle={
                    showSimulatorNotice
                      ? t("workstation.browserCore.simulatorBrowserNotice")
                      : undefined
                  }
                  fillParentHeight
                />
              )}
            </div>
          )}

          {/* Overlay-hidden notice — the native webview is parked offscreen (or
              behind React, on macOS) while an overlay is open, so the pane would
              otherwise read as broken. */}
          {shouldShowOverlayHiddenNotice && (
            <div className="browser-native-info browser-webview-hidden-notice">
              <Placeholder
                variant="empty"
                placement="detail-panel"
                title={t("workstation.browserCore.webviewHiddenTitle")}
                subtitle={t("workstation.browserCore.webviewHiddenBody")}
                fillParentHeight
              />
            </div>
          )}

          {/* Only the owning instance renders BrowserSessionWebview. */}
          {manageWebviews &&
            mountedWebviewSessions.map((session) => (
              <BrowserSessionWebview
                key={session.id}
                session={session}
                isActive={session.id === activeSessionId}
                isTabActive={isTabReallyActive}
                containerRef={webviewFrameAnchorRef}
                onSessionUpdate={updateSession}
                onNewTab={addSession}
              />
            ))}

          {/* Desktop-only notice */}
          {!isWebviewAvailable && canShowStatusOverlays && (
            <div className="browser-native-info">
              <div className="browser-native-placeholder">
                <HugeiconsIcon
                  icon={MonitorIcon}
                  data-icon="monitor"
                  size={48}
                  className="text-text-2 opacity-60"
                />
                <h3>{t("workstation.browserCore.desktopOnlyTitle")}</h3>
                <p>{t("workstation.browserCore.desktopOnlyBody")}</p>
                <div className="mt-4 text-left text-xs text-text-3">
                  <div>
                    {t("workstation.browserCore.debugWebviewAvailable", {
                      value: String(isWebviewAvailable),
                    })}
                  </div>
                  <div>
                    {t("workstation.browserCore.debugTauriInternals", {
                      value: String(
                        !!(window as unknown as Record<string, unknown>)
                          .__TAURI_INTERNALS__
                      ),
                    })}
                  </div>
                  <div>
                    {t("workstation.browserCore.debugTauriIpc", {
                      value: String(
                        !!(window as unknown as Record<string, unknown>)
                          .__TAURI_IPC__
                      ),
                    })}
                  </div>
                  <div>
                    {t("workstation.browserCore.debugTauri", {
                      value: String(
                        !!(window as unknown as Record<string, unknown>)
                          .__TAURI__
                      ),
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Loading overlay */}
          {isWebviewAvailable &&
            canShowStatusOverlays &&
            isTabReallyActive &&
            isLoading &&
            currentSession?.url && (
              <div className="browser-loading-overlay">
                <Placeholder variant="loading" />
              </div>
            )}

          {/* Load-failure notice: the native webview started (or never
              started) a navigation for this URL and never finished it. The
              overlay-hidden notice wins when both apply, so the two cards can
              no longer paint over each other in the same rect. */}
          {isWebviewAvailable &&
            canShowStatusOverlays &&
            isTabReallyActive &&
            showLoadFailureNotice &&
            !shouldShowOverlayHiddenNotice &&
            currentUrl &&
            !displayError && (
              <div className="browser-native-info browser-embedded-fallback">
                <div className="browser-native-placeholder">
                  <HugeiconsIcon
                    icon={CloudLoadingIcon}
                    data-icon="cloud-off"
                    size={64}
                    strokeWidth={1.5}
                    className="text-text-3 opacity-60"
                  />
                  <h3 className="mt-4">
                    {t("workstation.browserCore.loadStalledTitle")}
                  </h3>
                  <div className="mt-6 flex justify-center gap-2">
                    <Button
                      variant="primary"
                      size="small"
                      icon={
                        <HugeiconsIcon
                          icon={Refresh04Icon}
                          data-icon="refresh-cw"
                          size={14}
                          strokeWidth={1.75}
                        />
                      }
                      onClick={() => {
                        if (!currentSession) return;
                        resetLoadFailure();
                        updateSession(currentSession.id, {
                          isLoading: true,
                          error: null,
                        });
                      }}
                    >
                      {t("actions.reload")}
                    </Button>
                    <Button
                      size="small"
                      icon={
                        <HugeiconsIcon
                          icon={Copy01Icon}
                          data-icon="copy"
                          size={14}
                          strokeWidth={1.75}
                        />
                      }
                      onClick={handleCopyUrl}
                    >
                      {t("workstation.browserCore.copyUrl")}
                    </Button>
                  </div>
                </div>
              </div>
            )}

          {/* Error overlay */}
          {isWebviewAvailable &&
            canShowStatusOverlays &&
            isTabReallyActive &&
            displayError && (
              <div className="browser-native-info">
                <div className="browser-native-placeholder">
                  <HugeiconsIcon
                    icon={CloudLoadingIcon}
                    data-icon="cloud-off"
                    size={64}
                    strokeWidth={1.5}
                    className="text-text-3 opacity-60"
                  />
                  <h3 className="mt-4">
                    {t("workstation.browserCore.siteUnreachableTitle")}
                  </h3>
                  <div className="allow-select mt-3 w-full max-w-md rounded-lg bg-fill-2 px-3 py-2 text-left text-[12px] leading-relaxed text-text-2">
                    {displayError}
                  </div>
                  <div className="mt-6 flex justify-center">
                    <Button
                      variant="primary"
                      size="small"
                      icon={
                        <HugeiconsIcon
                          icon={Refresh04Icon}
                          data-icon="refresh-cw"
                          size={14}
                          strokeWidth={1.75}
                        />
                      }
                      onClick={() => {
                        if (!currentSession) return;
                        updateSession(currentSession.id, {
                          isLoading: true,
                          error: null,
                        });
                      }}
                    >
                      {t("actions.reload")}
                    </Button>
                  </div>
                </div>
              </div>
            )}
        </div>
      )}
    </div>
  );
};

export default BrowserCore;

/**
 * WebViewport
 *
 * Main viewport for Browser's web browsing mode showing the URL bar and webview.
 * Browser tabs live in the shared workstation tab strip, not here.
 */
import BrowserCore from "@/src/engines/BrowserCore";
import type { BrowserState } from "@/src/engines/BrowserCore/types";
import React, { memo, useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import Message from "@src/components/Message";
import { createLogger } from "@src/hooks/logger";
import type { WorkstationTabHeaderHost } from "@src/hooks/tabHost/useWorkstationTabHeader";
import { ImportCookiesModal } from "@src/modules/WorkStation/Browser/ImportCookies";
import { pickLocalHtmlFile } from "@src/modules/WorkStation/Browser/shared/pickLocalHtmlFile";
import { getBrowserSessionWebviewLabel } from "@src/util/platform/tauri/browserSessionLabel";

import { useBrowserPageColorSchemeSync } from "../../../../hooks/useBrowserPageColorSchemeSync";
import { useWebviewScreenshot } from "../../../../hooks/useWebviewScreenshot";
import WebUrlBar from "../../components/WebUrlBar";
import BrowserBlankTabPlaceholder from "./BrowserBlankTabPlaceholder";

// ============================================
// Types
// ============================================

interface WebViewportProps {
  /** Browser state from context */
  browserState: BrowserState;
  /** Open native browser DevTools (Safari Inspector / Edge DevTools) */
  onOpenNativeDevTools?: () => void;
  /** Toggle the WorkStation Browser secondary DevTools pane. */
  onToggleDevToolsPane?: () => void;
  /** Whether the WorkStation Browser secondary DevTools pane is collapsed. */
  devToolsPaneCollapsed?: boolean;
  /** Hide webviews when their host or viewport is inactive */
  hideWebviews?: boolean;
  /** Header host to publish the URL bar into. Defaults to My Station Browser. */
  publishUrlBarToHost?: WorkstationTabHeaderHost;
  /** Render the URL bar inline instead of publishing to the Workstation header slot. */
  inlineUrlBar?: boolean;
  /** Whether the element inspector is currently active. */
  isInspectMode?: boolean;
  /** Toggle the element inspector (hover/click to select DOM nodes). */
  onToggleInspectMode?: () => void;
  /**
   * When false, the underlying BrowserCore ignores the global webview-blocked
   * atom (overlays, station-mode switches) and always renders its webviews.
   * Pass false for embedded browser panes that should ignore global overlay
   * blocking. Defaults to true for standalone My Station Browser.
   */
  respectModalBlocking?: boolean;
  /**
   * When false, BrowserCore skips rendering BrowserSessionWebview instances.
   * Defaults to true so this viewport owns visible browser webviews.
   */
  manageWebviews?: boolean;
}

const log = createLogger("WebViewport");

function hasActiveBrowserWebview(url?: string): boolean {
  const normalizedUrl = url?.trim().toLowerCase();
  return Boolean(normalizedUrl && !normalizedUrl.startsWith("about:blank"));
}

// ============================================
// Main Component
// ============================================

export const WebViewport: React.FC<WebViewportProps> = memo(
  ({
    browserState,
    onOpenNativeDevTools,
    onToggleDevToolsPane,
    devToolsPaneCollapsed = false,
    hideWebviews = false,
    publishUrlBarToHost = "browser",
    inlineUrlBar = false,
    isInspectMode = false,
    onToggleInspectMode,
    respectModalBlocking = true,
    manageWebviews = true,
  }) => {
    const { t } = useTranslation();
    const { sessions, activeSessionId, updateSession } = browserState;

    useBrowserPageColorSchemeSync();

    const activeSession = useMemo(
      () => sessions.find((session) => session.id === activeSessionId),
      [sessions, activeSessionId]
    );
    const effectiveActiveSessionId = activeSession?.id ?? activeSessionId;
    const effectiveBrowserState = useMemo(
      () => ({
        ...browserState,
        activeSessionId: effectiveActiveSessionId,
        activeSession,
      }),
      [activeSession, browserState, effectiveActiveSessionId]
    );

    // Check if can go back/forward based on history
    const canGoBack = useMemo(() => {
      if (!activeSession) return false;
      return (activeSession.historyIndex ?? 0) > 0;
    }, [activeSession]);

    const canGoForward = useMemo(() => {
      if (!activeSession) return false;
      const history = activeSession.history ?? [];
      const historyIndex = activeSession.historyIndex ?? 0;
      return historyIndex < history.length - 1;
    }, [activeSession]);
    const hasActiveWebview = hasActiveBrowserWebview(activeSession?.url);

    // Handle URL navigation
    const handleNavigate = useCallback(
      (url: string) => {
        if (effectiveActiveSessionId && activeSession) {
          // Add to history
          const currentHistory = activeSession.history ?? [];
          const currentIndex = activeSession.historyIndex ?? -1;
          const newHistory = [
            ...currentHistory.slice(0, currentIndex + 1),
            url,
          ];

          updateSession(effectiveActiveSessionId, {
            url,
            isLoading: true,
            history: newHistory,
            historyIndex: newHistory.length - 1,
          });
        }
      },
      [effectiveActiveSessionId, activeSession, updateSession]
    );

    // Shared by the URL bar's "..." menu and the blank-tab placeholder. Returns
    // nothing: it is handed to click props, which must not receive a promise.
    const handleOpenHtmlFile = useCallback(() => {
      pickLocalHtmlFile()
        .then((fileUrl) => {
          if (fileUrl) handleNavigate(fileUrl);
        })
        .catch((error: unknown) => {
          const reason =
            error instanceof Error ? error.message : String(error ?? "unknown");
          log.error("[WebViewport] open HTML file failed:", reason);
          Message.error(t("browser.openHtmlFile.failed", { reason }));
        });
    }, [handleNavigate, t]);

    // Handle back navigation
    const handleBack = useCallback(() => {
      if (effectiveActiveSessionId && activeSession && canGoBack) {
        const history = activeSession.history ?? [];
        const newIndex = (activeSession.historyIndex ?? 0) - 1;
        const url = history[newIndex];

        if (url) {
          updateSession(effectiveActiveSessionId, {
            url,
            isLoading: true,
            historyIndex: newIndex,
          });
        }
      }
    }, [effectiveActiveSessionId, activeSession, canGoBack, updateSession]);

    // Handle forward navigation
    const handleForward = useCallback(() => {
      if (effectiveActiveSessionId && activeSession && canGoForward) {
        const history = activeSession.history ?? [];
        const newIndex = (activeSession.historyIndex ?? 0) + 1;
        const url = history[newIndex];

        if (url) {
          updateSession(effectiveActiveSessionId, {
            url,
            isLoading: true,
            historyIndex: newIndex,
          });
        }
      }
    }, [effectiveActiveSessionId, activeSession, canGoForward, updateSession]);

    // Handle reload
    const handleReload = useCallback(() => {
      if (effectiveActiveSessionId && activeSession?.url) {
        updateSession(effectiveActiveSessionId, { isLoading: true });
      }
    }, [effectiveActiveSessionId, activeSession?.url, updateSession]);

    // Handle stop loading
    const handleStop = useCallback(() => {
      if (effectiveActiveSessionId) {
        updateSession(effectiveActiveSessionId, { isLoading: false });
      }
    }, [effectiveActiveSessionId, updateSession]);

    // Screenshot capture must address this window's native browser view.
    const activeWebviewLabel = effectiveActiveSessionId
      ? getBrowserSessionWebviewLabel(effectiveActiveSessionId)
      : null;
    const { triggerScreenshot, saveScreenshot, isCapturing } =
      useWebviewScreenshot({
        webviewLabel: activeWebviewLabel,
      });

    const [importCookiesOpen, setImportCookiesOpen] = useState(false);
    const openImportCookies = useCallback(() => setImportCookiesOpen(true), []);
    // Importing carries persistent logins, so neither the URL bar menu nor the
    // blank-tab placeholder offers it while browsing privately.
    const handleImportCookies = activeSession?.incognito
      ? undefined
      : openImportCookies;
    const handleReloadAfterImport = useCallback(() => {
      if (effectiveActiveSessionId && activeSession?.url) {
        updateSession(effectiveActiveSessionId, { isLoading: true });
      }
    }, [effectiveActiveSessionId, activeSession?.url, updateSession]);

    return (
      <div className="flex h-full w-full flex-col overflow-hidden">
        {/* URL Bar */}
        {activeSession && (
          <WebUrlBar
            url={activeSession.url || ""}
            isLoading={activeSession.isLoading}
            isIncognito={activeSession.incognito}
            onNavigate={handleNavigate}
            onBack={handleBack}
            onForward={handleForward}
            onReload={handleReload}
            onStop={handleStop}
            canGoBack={canGoBack}
            canGoForward={canGoForward}
            hasActiveWebview={hasActiveWebview}
            onOpenNativeDevTools={onOpenNativeDevTools}
            onToggleDevToolsPane={onToggleDevToolsPane}
            devToolsPaneCollapsed={devToolsPaneCollapsed}
            onScreenshot={activeSession.url ? triggerScreenshot : undefined}
            isCapturingScreenshot={isCapturing}
            onSaveScreenshot={saveScreenshot}
            onOpenHtmlFile={handleOpenHtmlFile}
            onImportCookies={handleImportCookies}
            isInspectMode={isInspectMode}
            onToggleInspectMode={onToggleInspectMode}
            publishToHost={publishUrlBarToHost}
            publishEnabled={!hideWebviews}
            inline={inlineUrlBar}
          />
        )}

        {/* Webview Content */}
        <div className="relative flex-1 overflow-hidden">
          <BrowserCore
            browserState={effectiveBrowserState}
            respectModalBlocking={respectModalBlocking}
            manageWebviews={manageWebviews}
            hidden={hideWebviews}
            blankTabPlaceholder={
              publishUrlBarToHost === "browser" ? (
                <BrowserBlankTabPlaceholder
                  isIncognito={activeSession?.incognito}
                  onOpen={handleNavigate}
                  onOpenHtmlFile={handleOpenHtmlFile}
                  onImportCookies={handleImportCookies}
                />
              ) : undefined
            }
          />
        </div>

        {/* Mounted only while open: the flow resets by unmounting. */}
        {importCookiesOpen ? (
          <ImportCookiesModal
            onClose={() => setImportCookiesOpen(false)}
            onImported={handleReloadAfterImport}
          />
        ) : null}
      </div>
    );
  }
);

WebViewport.displayName = "WebViewport";

export default WebViewport;

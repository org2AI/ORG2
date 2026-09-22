/**
 * BrowserLayout
 *
 * Layout orchestrator for Browser mode. Composes:
 * - Left: Collapsed; webpages are managed through the top tab bar
 * - Center: WebViewport (webview)
 * - Right: WebInspector (DevTools) or DOM Editor panel
 * - Bottom: BrowserStatusBar
 *
 * Tab System Architecture:
 * - Uses centralized browserTabsAtom as single source of truth
 * - Browser sessions sync their state to the tab store
 * - All tab switching goes through useBrowserPaneState
 */
import React, { memo, useCallback, useMemo, useState } from "react";

import {
  WORK_STATION_PLACEHOLDER_PAGE_BG_CLASS,
  WorkStationShell,
} from "../../shared";
import {
  type BrowserHostContextValue,
  BrowserHostProvider,
} from "../context/browserHostContext";
import {
  SHARED_BROWSER_HOST,
  SHARED_BROWSER_HOST_SCOPE,
  SharedBrowserDevToolsPanel,
  SharedBrowserWorkspace,
} from "../shared";
import { buildBrowserDevToolsPanelConfig } from "../shared/browserDevToolsPanelConfig";
import { AgentBrowserOverlay } from "./AgentBrowserOverlay";
import type { BrowserLayoutProps } from "./types";
import { useBrowserLayoutState } from "./useBrowserLayoutState";
import { useNewBrowserSessionRequest } from "./useNewBrowserSessionRequest";

export const BrowserLayout: React.FC<BrowserLayoutProps> = memo(
  ({ repoPath, repoName: _repoName, isActive = true }) => {
    const state = useBrowserLayoutState({ isActive });

    const setDevToolsCollapsed = state.browser.setDevToolsCollapsed;
    const handleCloseDevTools = useCallback(() => {
      setDevToolsCollapsed(true);
    }, [setDevToolsCollapsed]);

    const setDevToolsPosition = state.browser.setDevToolsPosition;
    const handleToggleDevToolsPosition = useCallback(() => {
      setDevToolsPosition("toggle");
    }, [setDevToolsPosition]);

    const [devToolsPanelHeight, setDevToolsPanelHeight] = useState(300);

    useNewBrowserSessionRequest(state.browser.browserState);

    // ============================================
    // Main content
    // ============================================

    const mainContent = (
      <div
        className={`flex h-full min-h-0 w-full flex-col overflow-hidden ${WORK_STATION_PLACEHOLDER_PAGE_BG_CLASS}`}
      >
        <div className="relative flex-1 overflow-hidden">
          {(!state.hasOpenTabs || state.hasBrowserSessions) && (
            <div
              className={`absolute inset-0 ${
                (state.showBrowserViewport || !state.hasOpenTabs) &&
                !state.automation.isRunning
                  ? "pointer-events-auto visible"
                  : "pointer-events-none invisible"
              }`}
            >
              <SharedBrowserWorkspace
                hostId={SHARED_BROWSER_HOST.MY_STATION}
                scope={SHARED_BROWSER_HOST_SCOPE.MY_STATION}
                active={
                  isActive &&
                  state.showBrowserViewport &&
                  !state.automation.isRunning
                }
                browserState={state.browser.browserState}
                onOpenNativeDevTools={state.browser.handleOpenNativeDevTools}
                onToggleDevToolsPane={state.browser.handleToggleDevTools}
                devToolsPaneCollapsed={state.browser.devToolsCollapsed}
                hideWebviews={!isActive || !state.showBrowserViewport}
                webviewBottomInsetPx={0}
                isInspectMode={state.browser.isInspectMode}
                onToggleInspectMode={state.browser.toggleInspectMode}
              />
            </div>
          )}

          {state.automation.isRunning && (
            <AgentBrowserOverlay
              screenshot={state.automation.lastScreenshot}
              action={state.automation.lastAction}
              url={state.automation.currentUrl}
              isPaused={state.automation.isPaused}
              onTakeover={state.automation.takeover}
              onResume={state.automation.resume}
              onStop={state.automation.stop}
            />
          )}
        </div>
      </div>
    );

    // ============================================
    // DevTools panel — routed to right or bottom based on position
    // ============================================

    const devToolsPosition = state.browser.devToolsPosition;

    const devToolsContent = useMemo(
      () => (
        <SharedBrowserDevToolsPanel
          isCollapsed={state.browser.devToolsCollapsed}
          onToggleCollapse={state.browser.handleToggleDevTools}
          width={state.browser.devToolsPanelWidth}
          onWidthChange={state.browser.setDevToolsPanelWidth}
          entries={state.browser.entries}
          onClearEntries={state.browser.clearEntries}
          networkEntries={state.browser.networkEntries}
          onClearNetworkEntries={state.browser.clearNetworkEntries}
          errorCount={state.browser.errorCount}
          warningCount={state.browser.warningCount}
          selectedElement={state.browser.selectedElement}
          webviewLabel={state.browser.activeWebviewLabel}
          repoPath={repoPath}
          currentUrl={state.browser.currentUrl}
          position={devToolsPosition}
          onTogglePosition={handleToggleDevToolsPosition}
        />
      ),
      [
        state.browser.devToolsCollapsed,
        state.browser.handleToggleDevTools,
        state.browser.devToolsPanelWidth,
        state.browser.setDevToolsPanelWidth,
        state.browser.entries,
        state.browser.clearEntries,
        state.browser.networkEntries,
        state.browser.clearNetworkEntries,
        state.browser.errorCount,
        state.browser.warningCount,
        state.browser.selectedElement,
        state.browser.activeWebviewLabel,
        state.browser.currentUrl,
        repoPath,
        devToolsPosition,
        handleToggleDevToolsPosition,
      ]
    );

    // Secondary panel config — single mount, CSS grid relocates right/bottom.
    const secondaryPanelConfig = useMemo(
      () =>
        buildBrowserDevToolsPanelConfig({
          content: devToolsContent,
          position: devToolsPosition,
          collapsed: state.browser.devToolsCollapsed,
          width: state.browser.devToolsPanelWidth,
          onWidthChange: state.browser.setDevToolsPanelWidth,
          height: devToolsPanelHeight,
          onHeightChange: setDevToolsPanelHeight,
          onClose: handleCloseDevTools,
        }),
      [
        devToolsContent,
        devToolsPosition,
        state.browser.devToolsCollapsed,
        state.browser.devToolsPanelWidth,
        state.browser.setDevToolsPanelWidth,
        devToolsPanelHeight,
        handleCloseDevTools,
      ]
    );

    // ============================================
    // Phase 2.2: publish the Browser host's render surface above the tab
    // dispatcher. Mirrors `ProjectHostProvider` — the value bundles the
    // shared-webview activation flags + inspect handlers so the staged
    // `browser-session` renderer can consume it via `useBrowserHostContext`
    // once `UnifiedTabContent` is mounted for browser tabs. Providing it here
    // is additive — BrowserLayout below still renders its bespoke
    // `SharedBrowserWorkspace` directly, and DevTools stays in the secondary
    // panel above.
    // ============================================

    const browser = state.browser;
    const showBrowserViewport = state.showBrowserViewport;
    const automationRunning = state.automation.isRunning;

    const browserHostValue = useMemo<BrowserHostContextValue>(
      () => ({
        browserState: browser.browserState,
        isWorkspaceActive:
          isActive && showBrowserViewport && !automationRunning,
        hideWebviews: !isActive || !showBrowserViewport,
        webviewBottomInsetPx: 0,
        isInspectMode: browser.isInspectMode,
        onToggleInspectMode: browser.toggleInspectMode,
        onOpenNativeDevTools: browser.handleOpenNativeDevTools,
        onToggleDevToolsPane: browser.handleToggleDevTools,
        devToolsPaneCollapsed: browser.devToolsCollapsed,
      }),
      [
        isActive,
        showBrowserViewport,
        automationRunning,
        browser.browserState,
        browser.isInspectMode,
        browser.toggleInspectMode,
        browser.handleOpenNativeDevTools,
        browser.handleToggleDevTools,
        browser.devToolsCollapsed,
      ]
    );

    // ============================================
    // Render
    // ============================================

    return (
      <BrowserHostProvider value={browserHostValue}>
        <WorkStationShell
          primarySidebarConfig={{ content: null, collapsed: true, size: 0 }}
          secondaryPanelConfig={secondaryPanelConfig}
          content={mainContent}
          statusBar={null}
          appClassName="browser-explorer"
        />
      </BrowserHostProvider>
    );
  }
);

BrowserLayout.displayName = "BrowserLayout";

export default BrowserLayout;

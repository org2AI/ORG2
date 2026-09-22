import { useAtomValue, useSetAtom } from "jotai";
import React, { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import Message from "@src/components/Message";
import { Placeholder } from "@src/components/Placeholder";
import { TabBarTrailingIconButton } from "@src/components/TabPill/TabBarTrailingIconButton";
import { useBrowserAutomation } from "@src/engines/BrowserCore/hooks/useBrowserAutomation";
import { AppType } from "@src/engines/Simulator/types/appTypes";
import { usePublishWorkstationTabHeader } from "@src/hooks/tabHost/useWorkstationTabHeader";
import {
  Add01Icon,
  ArrowRight01Icon,
  HugeiconsIcon,
  Shield01Icon,
} from "@src/icons";
import { buildSelectedElementLabel } from "@src/modules/WorkStation/Browser/BrowserLayout/browserLayoutUtils";
import { useBrowserSessions } from "@src/modules/WorkStation/Browser/hooks/useBrowserSessions";
import {
  NoTabsPlaceholder,
  ReplayShellLayout,
  useSimulatorAwaitingAgentCaption,
  useSimulatorPlaceholderActions,
} from "@src/modules/WorkStation/shared";
import { BrowserStatusBar } from "@src/modules/WorkStation/shared/StatusBar";
import { addToAgentAtom } from "@src/store/ui/addToAgentAtom";
import { simulatorEffectiveDockAppAtom } from "@src/store/ui/simulatorAtom";
import {
  clearScreenshotCacheAtom,
  insertScreenshotCacheAtom,
  screenshotCacheAtom,
} from "@src/store/workstation/browser/browserAutomationAtom";
import type { BackendEvent } from "@src/types/session/steps";

import {
  SHARED_BROWSER_HOST,
  SHARED_BROWSER_HOST_SCOPE,
  SharedBrowserDevToolsPanel,
  SharedBrowserWorkspace,
} from "../shared";
import { buildBrowserDevToolsPanelConfig } from "../shared/browserDevToolsPanelConfig";
import { sendSelectedElementToChat } from "../shared/sendSelectedElementToChat";
import type { BrowserEntry } from "./types";
import { useBrowser } from "./useBrowser";
import { useBrowserReplayDisplay } from "./useBrowserReplayDisplay";
import { useBrowserReplayTabs } from "./useBrowserReplayTabs";
import { useReplayScreenshotResolution } from "./useReplayScreenshotResolution";
import { hasScreenshotMarker, inferImageMime } from "./utils/browserEventUtils";

interface SessionReplayBrowserProps {
  currentEvent?: unknown;
  mode?: "interactive" | "simulation";
  isActive?: boolean;
}

const SessionReplayBrowserComponent: React.FC<SessionReplayBrowserProps> = ({
  currentEvent,
  mode = "simulation",
  isActive = true,
}) => {
  const { t } = useTranslation("sessions");
  const { t: tCommon } = useTranslation("common");
  const activeDockAppForReplay = useAtomValue(simulatorEffectiveDockAppAtom);
  const isBrowserReplayActive =
    isActive &&
    (activeDockAppForReplay === null ||
      activeDockAppForReplay === AppType.BROWSER);
  const myTabsBrowser = useBrowserSessions({ enabled: isBrowserReplayActive });
  const myTabsBrowserState = myTabsBrowser.browserState;
  const setMyTabsDevToolsCollapsed = myTabsBrowser.setDevToolsCollapsed;
  const setMyTabsDevToolsPosition = myTabsBrowser.setDevToolsPosition;
  const setAddToAgent = useSetAtom(addToAgentAtom);
  const automation = useBrowserAutomation({ enabled: isBrowserReplayActive });
  const isAutomationActive = automation.isRunning;
  const cache = useAtomValue(screenshotCacheAtom);
  const insertCache = useSetAtom(insertScreenshotCacheAtom);
  const clearScreenshotCache = useSetAtom(clearScreenshotCacheAtom);

  const {
    browserEntries,
    activeEntry,
    internalBrowserEntries,
    activeInternalEntry,
    activeSubtool,
    isMaskShown,
  } = useBrowser();
  const simulatorPlaceholderActions = useSimulatorPlaceholderActions(mode);
  const simulatorAwaitingAgentCaption = useSimulatorAwaitingAgentCaption();

  const [devToolsPanelHeight, setDevToolsPanelHeight] = useState(240);

  const handleCloseDevTools = useCallback(() => {
    setMyTabsDevToolsCollapsed(true);
  }, [setMyTabsDevToolsCollapsed]);

  const handleToggleDevToolsPosition = useCallback(() => {
    setMyTabsDevToolsPosition("toggle");
  }, [setMyTabsDevToolsPosition]);

  useReplayScreenshotResolution({
    activeEntry,
    cache,
    insertCache,
    clearScreenshotCache,
    isBrowserReplayActive,
  });

  // Also handle screenshot marker fallback for live automation screenshot
  useEffect(() => {
    if (!activeEntry || !("event" in activeEntry)) return;
    const entry = activeEntry as BrowserEntry;
    if (!hasScreenshotMarker(entry.event)) return;
  }, [activeEntry]);

  const { displayData, headerInfo, nativeHeaderInfo, nativeDisplayContent } =
    useBrowserReplayDisplay({
      activeEntry,
      activeInternalEntry,
      isAutomationActive,
      automation,
      cache,
    });

  const {
    visibleActiveTabId,
    showMyTabsBrowser,
    showAgentBrowserCategory,
    browserTabs,
    handleBrowserTabClick,
    handleNewMyTabsSession,
  } = useBrowserReplayTabs({
    browserEntries,
    internalBrowserEntries,
    activeEntry,
    activeInternalEntry,
    activeSubtool,
    myTabsBrowserState,
  });

  const showActiveMyTabsBrowser = showMyTabsBrowser && isBrowserReplayActive;
  const showActiveBrowserCategory =
    showAgentBrowserCategory && isBrowserReplayActive;

  const displayScreenshot = displayData?.screenshot ?? null;
  const isCurrentEventLoading = activeEntry !== null && !displayData;
  const displayScreenshotSrc = useMemo(() => {
    if (!displayScreenshot) return null;
    return `data:${inferImageMime(displayScreenshot)};base64,${displayScreenshot}`;
  }, [displayScreenshot]);

  const agentBrowserHeaderContent = useMemo(() => {
    const activeHeaderInfo =
      activeSubtool === "internal_browser" ? nativeHeaderInfo : headerInfo;

    if (!activeHeaderInfo) return null;

    return (
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        {activeHeaderInfo.categoryIcon}
        <span className="shrink-0 text-[13px] text-text-2">
          {activeHeaderInfo.categoryLabel}
        </span>
        {activeHeaderInfo.detailText && (
          <>
            <HugeiconsIcon
              icon={ArrowRight01Icon}
              data-icon="chevron-right"
              size={12}
              className="shrink-0 text-text-4"
            />
            {activeHeaderInfo.detailIcon}
            <span className="min-w-0 truncate text-[13px] font-medium text-text-1">
              {activeHeaderInfo.detailText}
            </span>
          </>
        )}
        {activeSubtool === "internal_browser" && isMaskShown && (
          <div className="ml-auto flex items-center gap-1">
            <HugeiconsIcon
              icon={Shield01Icon}
              data-icon="shield"
              size={14}
              className="text-warning-6"
            />
          </div>
        )}
      </div>
    );
  }, [activeSubtool, headerInfo, isMaskShown, nativeHeaderInfo]);

  usePublishWorkstationTabHeader({
    host: "simulator",
    content: agentBrowserHeaderContent,
    enabled: showActiveBrowserCategory && agentBrowserHeaderContent !== null,
  });

  const devToolsPosition = myTabsBrowser.devToolsPosition;

  const devToolsContent = useMemo(
    () => (
      <SharedBrowserDevToolsPanel
        isCollapsed={myTabsBrowser.devToolsCollapsed}
        onToggleCollapse={myTabsBrowser.handleToggleDevTools}
        width={myTabsBrowser.devToolsPanelWidth}
        onWidthChange={myTabsBrowser.setDevToolsPanelWidth}
        entries={myTabsBrowser.entries}
        onClearEntries={myTabsBrowser.clearEntries}
        networkEntries={myTabsBrowser.networkEntries}
        onClearNetworkEntries={myTabsBrowser.clearNetworkEntries}
        errorCount={myTabsBrowser.errorCount}
        warningCount={myTabsBrowser.warningCount}
        selectedElement={myTabsBrowser.selectedElement}
        webviewLabel={myTabsBrowser.activeWebviewLabel}
        repoPath=""
        currentUrl={myTabsBrowser.currentUrl}
        position={devToolsPosition}
        onTogglePosition={handleToggleDevToolsPosition}
      />
    ),
    [
      myTabsBrowser.devToolsCollapsed,
      myTabsBrowser.handleToggleDevTools,
      myTabsBrowser.devToolsPanelWidth,
      myTabsBrowser.setDevToolsPanelWidth,
      myTabsBrowser.entries,
      myTabsBrowser.clearEntries,
      myTabsBrowser.networkEntries,
      myTabsBrowser.clearNetworkEntries,
      myTabsBrowser.errorCount,
      myTabsBrowser.warningCount,
      myTabsBrowser.selectedElement,
      myTabsBrowser.activeWebviewLabel,
      myTabsBrowser.currentUrl,
      devToolsPosition,
      handleToggleDevToolsPosition,
    ]
  );

  const secondaryPanelConfig = useMemo(
    () =>
      buildBrowserDevToolsPanelConfig({
        content: devToolsContent,
        position: devToolsPosition,
        collapsed: myTabsBrowser.devToolsCollapsed || !showActiveMyTabsBrowser,
        width: myTabsBrowser.devToolsPanelWidth,
        onWidthChange: myTabsBrowser.setDevToolsPanelWidth,
        height: devToolsPanelHeight,
        onHeightChange: setDevToolsPanelHeight,
        onClose: handleCloseDevTools,
      }),
    [
      devToolsContent,
      devToolsPosition,
      myTabsBrowser.devToolsCollapsed,
      myTabsBrowser.devToolsPanelWidth,
      myTabsBrowser.setDevToolsPanelWidth,
      devToolsPanelHeight,
      handleCloseDevTools,
      showActiveMyTabsBrowser,
    ]
  );

  const selectedElement = myTabsBrowser.selectedElement;
  const currentUrl = myTabsBrowser.currentUrl;
  const clearSelection = myTabsBrowser.clearSelection;

  const handleSendSelectedElementToChat = useCallback(() => {
    sendSelectedElementToChat({
      selectedElement,
      currentUrl,
      setAddToAgent,
      clearSelection,
      onSent: () =>
        Message.success(tCommon("browser.selectedElement.sentToChat")),
    });
  }, [selectedElement, currentUrl, clearSelection, setAddToAgent, tCommon]);

  const myTabsStatusBar = useMemo(() => {
    if (!showActiveMyTabsBrowser) return null;

    return (
      <BrowserStatusBar
        errorCount={myTabsBrowser.errorCount}
        warningCount={myTabsBrowser.warningCount}
        onToggleDevTools={myTabsBrowser.handleToggleDevTools}
        hasSelectedElement={myTabsBrowser.selectedElement !== null}
        selectedElementLabel={
          myTabsBrowser.selectedElement
            ? buildSelectedElementLabel(myTabsBrowser.selectedElement)
            : undefined
        }
        onSendSelectedElementToChat={handleSendSelectedElementToChat}
        onClearSelectedElement={myTabsBrowser.clearSelection}
        className="h-[48px]!"
      />
    );
  }, [
    showActiveMyTabsBrowser,
    myTabsBrowser.errorCount,
    myTabsBrowser.warningCount,
    myTabsBrowser.handleToggleDevTools,
    myTabsBrowser.selectedElement,
    handleSendSelectedElementToChat,
    myTabsBrowser.clearSelection,
  ]);

  const mainContent = (
    <div className="allow-select-deep relative min-w-0 flex-1 overflow-hidden">
      <div
        className={`absolute inset-0 ${
          showActiveMyTabsBrowser
            ? "pointer-events-auto visible"
            : "pointer-events-none invisible"
        }`}
      >
        <SharedBrowserWorkspace
          hostId={SHARED_BROWSER_HOST.AGENT_STATION}
          scope={SHARED_BROWSER_HOST_SCOPE.AGENT_STATION}
          active={showActiveMyTabsBrowser}
          browserState={myTabsBrowserState}
          onOpenNativeDevTools={myTabsBrowser.handleOpenNativeDevTools}
          onToggleDevToolsPane={myTabsBrowser.handleToggleDevTools}
          devToolsPaneCollapsed={myTabsBrowser.devToolsCollapsed}
          hideWebviews={!showActiveMyTabsBrowser}
          publishUrlBarToHost="simulator"
          isInspectMode={myTabsBrowser.isInspectMode}
          onToggleInspectMode={myTabsBrowser.toggleInspectMode}
          placeholderCaption={simulatorAwaitingAgentCaption}
          placeholderActions={simulatorPlaceholderActions}
        />
      </div>

      <div
        className={`flex h-full min-w-0 flex-col overflow-hidden ${
          showActiveBrowserCategory
            ? "pointer-events-auto visible"
            : "pointer-events-none invisible"
        }`}
      >
        <div className="relative min-h-0 flex-1 overflow-hidden">
          {activeSubtool === "internal_browser" ? (
            nativeDisplayContent ? (
              nativeDisplayContent
            ) : isCurrentEventLoading ? (
              <Placeholder
                variant="loading"
                placement="detail-panel"
                fillParentHeight
              />
            ) : (
              <NoTabsPlaceholder
                icon="browser"
                caption={simulatorAwaitingAgentCaption}
                actions={simulatorPlaceholderActions}
              />
            )
          ) : displayData ? (
            displayScreenshotSrc ? (
              <div className="flex h-full items-center justify-center overflow-hidden">
                <img
                  src={displayScreenshotSrc}
                  alt={t("simulator.replay.browser.screenshotAlt", {
                    url: displayData.url || "",
                  })}
                  className="max-h-full max-w-full object-contain"
                />
              </div>
            ) : (
              <div className="scrollbar-overlay h-full overflow-y-auto p-4 pb-[100px]">
                <pre className="text-[13px] leading-relaxed wrap-break-word whitespace-pre-wrap text-text-2">
                  {displayData.text}
                </pre>
              </div>
            )
          ) : isCurrentEventLoading ? (
            <Placeholder
              variant="loading"
              placement="detail-panel"
              fillParentHeight
            />
          ) : (
            <NoTabsPlaceholder
              icon="browser"
              caption={simulatorAwaitingAgentCaption}
              actions={simulatorPlaceholderActions}
            />
          )}
        </div>

        {activeSubtool === "internal_browser" && isMaskShown && (
          <div className="flex items-center gap-2 border-t border-border-1 bg-warning-1 px-3 py-1.5">
            <HugeiconsIcon
              icon={Shield01Icon}
              data-icon="shield"
              size={14}
              className="text-warning-6"
            />
            <span className="text-xs text-warning-6">
              User interaction blocked - Agent is controlling the browser
            </span>
          </div>
        )}
      </div>
    </div>
  );

  if (!isBrowserReplayActive) {
    return null;
  }

  return (
    <ReplayShellLayout
      showSidebarToggle={false}
      tabs={browserTabs}
      activeEventId={visibleActiveTabId}
      onTabClick={handleBrowserTabClick}
      trailingSlot={
        <TabBarTrailingIconButton
          data-action="browser.newTab"
          title={tCommon("commands.newTab")}
          shortcutId="browser_new_tab"
          onClick={handleNewMyTabsSession}
        >
          <HugeiconsIcon
            icon={Add01Icon}
            data-icon="plus"
            size={18}
            strokeWidth={2}
          />
        </TabBarTrailingIconButton>
      }
      eventWrapper={{ event: currentEvent as unknown as BackendEvent, mode }}
      workstation={{
        // The shared shell otherwise defaults to an expanded empty sidebar.
        primarySidebarConfig: { content: null, collapsed: true, size: 0 },
        secondaryPanelConfig,
        statusBar: myTabsStatusBar,
        layoutMode: "left",
        appClassName: "session-replay-browser",
      }}
    >
      {mainContent}
    </ReplayShellLayout>
  );
};

const SessionReplayBrowser = memo(SessionReplayBrowserComponent);

export default SessionReplayBrowser;

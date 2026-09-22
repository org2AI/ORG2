import type { TFunction } from "i18next";
import { useAtomValue } from "jotai";
import React from "react";

import Button from "@src/components/Button";
import { KeyboardShortcutTooltipContent } from "@src/components/KeyboardShortcut";
import RegionNoticeButton from "@src/components/RegionNoticeButton";
import Tooltip from "@src/components/Tooltip";
import { HeaderActionGroup } from "@src/components/WindowChrome/HeaderActionGroup";
import type { DropdownEnginePosition } from "@src/hooks/dropdown";
import { useWorkbenchRightEdgeReservation } from "@src/hooks/ui/workbench/usePinnedWorkbenchChrome";
import {
  ComputerVideoIcon,
  HugeiconsIcon,
  SquareTerminalIcon,
} from "@src/icons";
import { ChatPaneFocusButton } from "@src/scaffold/WorkbenchChrome/StationPaneControls";
import type { ChatHistoryDisplayMode } from "@src/store/ui/chatPanel/displayPrefsAtoms";
import type { ChatPanelPosition } from "@src/store/ui/workStationLayout/chatPositionAtoms";

import { LaunchpadSearchTrigger } from "./LaunchpadSearchTrigger";
import { SessionHeaderActionsMenu } from "./components/SessionHeaderActionsMenu";
import {
  CHAT_PANEL_HEADER_NO_DRAG_STYLE,
  ChatPanelCollapsedTabHeading,
  chatPanelHeaderSlotsAtom,
} from "./header";
import { ChatPanelChrome } from "./header/ChatPanelChrome";
import type { ChatPanelRegionNotice } from "./types";

const CHAT_PANEL_HEADER_ICON_SIZE = 14;

interface ChatPanelHeaderProps {
  activeSessionExists: boolean;
  chatPanelPosition: ChatPanelPosition;
  copyEventJsonLabel: "idle" | "copied" | "failed";
  currentSessionId: string | null;
  appOpenSessionId?: string | null;
  displayMode: ChatHistoryDisplayMode;
  eventsLength: number;
  handleChatFocusToggle: () => void;
  handleCompactDisplayModeToggle: (checked: boolean) => void;
  handleCopyEventJson: () => void;
  handleMoveToWorkstation: () => void;
  handleOpenExportSessionJson: () => void;
  handleOpenLinkWorkItem: () => void;
  handleOpenCloudShareSettings: () => void;
  handleOpenSearch: () => void;
  handlePaginationToggle: (checked: boolean) => void;
  handleReloadFromMenu: () => void;
  handleTokenUsageVisibleToggle: (checked: boolean) => void;
  handleTurnMetadataVisibleToggle: (checked: boolean) => void;
  headerActionsDropdownRef: React.RefObject<HTMLDivElement | null>;
  headerActionsPosition: DropdownEnginePosition;
  headerActionsTriggerRef: React.RefObject<HTMLButtonElement | null>;
  isChatFocus: boolean;
  isHeaderActionsOpen: boolean;
  isHeaderActionsPositioned: boolean;
  focusedWorkstationMenuHostRef?: React.RefCallback<HTMLSpanElement>;
  paginationEnabled: boolean;
  tokenUsageVisible: boolean;
  turnMetadataVisible: boolean;
  shouldOffsetHeaderForCollapsedSidebar: boolean;
  showSessionContent: boolean;
  /** Owner-side share entry gate (design §6.3): own session + org in scope. */
  showCloudShareSettings: boolean;
  showTranscriptActions?: boolean;
  t: TFunction<["sessions", "common", "projects", "navigation"]>;
  toggleHeaderActionsMenu: () => void;
  visibleRegionNotice: ChatPanelRegionNotice | null;
  showTuiModeToggle: boolean;
  tuiMode: boolean;
  handleTuiModeToggle: () => void;
  tabStrip: React.ReactNode;
  /** When provided, rendered before the ... button (tab-strip + menu replacement) */
  tabStripPlus?: React.ReactNode;
  /**
   * Fold the 44px tab row into the published 36px row, which then hosts the
   * tab controls the folded row would have carried.
   */
  tabRowCollapsed: boolean;
  /** Session-scoped extras (fork button / provenance chip), leading the toolbar */
  sessionHeaderExtras?: React.ReactNode;
  /** Canonical session-name breadcrumb rendered in the published 36px row. */
  sessionHeaderContent?: React.ReactNode;
  /** Show the centered Spotlight entry on the fullscreen Launchpad. */
  showLaunchpadSearch?: boolean;
  /** Let the GUI transcript scroll beneath the published session header. */
  overlayPublishedHeader?: boolean;
}

export function ChatPanelHeader({
  activeSessionExists,
  chatPanelPosition,
  copyEventJsonLabel,
  currentSessionId,
  appOpenSessionId,
  displayMode,
  eventsLength,
  handleChatFocusToggle,
  handleCompactDisplayModeToggle,
  handleCopyEventJson,
  handleMoveToWorkstation,
  handleOpenExportSessionJson,
  handleOpenLinkWorkItem,
  handleOpenCloudShareSettings,
  handleOpenSearch,
  handlePaginationToggle,
  handleReloadFromMenu,
  handleTokenUsageVisibleToggle,
  handleTurnMetadataVisibleToggle,
  headerActionsDropdownRef,
  headerActionsPosition,
  headerActionsTriggerRef,
  isChatFocus,
  isHeaderActionsOpen,
  isHeaderActionsPositioned,
  focusedWorkstationMenuHostRef,
  paginationEnabled,
  tokenUsageVisible,
  turnMetadataVisible,
  shouldOffsetHeaderForCollapsedSidebar,
  showSessionContent,
  showCloudShareSettings,
  showTranscriptActions,
  t,
  toggleHeaderActionsMenu,
  visibleRegionNotice,
  showTuiModeToggle,
  tuiMode,
  handleTuiModeToggle,
  tabStrip,
  tabStripPlus,
  tabRowCollapsed,
  sessionHeaderExtras,
  sessionHeaderContent,
  overlayPublishedHeader = false,
  showLaunchpadSearch = false,
}: ChatPanelHeaderProps): React.ReactNode {
  const publishedHeaderSlots = useAtomValue(chatPanelHeaderSlotsAtom);
  // macOS pins the maximize-chat / show-workstation toggle at the window's
  // right edge (`PinnedWorkbenchChrome`). Only while the chat pane is the
  // one touching that edge does the pinned copy sit in this header's corner:
  // then this header reserves the space and drops its own toggle. With the
  // chat on the left the pinned group is over the workstation, so the
  // header keeps its own toggle right of "+" exactly as before.
  const rightEdge = useWorkbenchRightEdgeReservation();
  const pinnedChromeInThisHeader = rightEdge.owner === "chat";
  const trailingInsetPx = pinnedChromeInThisHeader
    ? rightEdge.reservedRight
    : undefined;

  const tuiModeLabel = tuiMode ? t("chat.tuiModeOn") : t("chat.tuiModeOff");

  const sessionPublishedActions =
    showSessionContent || showTuiModeToggle || visibleRegionNotice ? (
      <div
        className="flex h-7 shrink-0 items-center gap-px"
        style={CHAT_PANEL_HEADER_NO_DRAG_STYLE}
      >
        {showSessionContent && sessionHeaderExtras}
        {showTuiModeToggle && (
          <Tooltip
            content={
              <KeyboardShortcutTooltipContent label={tuiModeLabel} noShortcut />
            }
            position="bottom-end"
            kind="button"
            framedPanel
          >
            <span className="inline-flex">
              <Button
                variant="tertiary"
                size="small"
                iconOnly
                onClick={handleTuiModeToggle}
                aria-label={tuiModeLabel}
                aria-pressed={tuiMode}
                className={tuiMode ? "text-primary-6!" : ""}
                icon={
                  tuiMode ? (
                    <HugeiconsIcon
                      icon={ComputerVideoIcon}
                      data-icon="monitor-play"
                      size={CHAT_PANEL_HEADER_ICON_SIZE}
                      strokeWidth={2}
                    />
                  ) : (
                    <HugeiconsIcon
                      icon={SquareTerminalIcon}
                      data-icon="terminal-square"
                      size={CHAT_PANEL_HEADER_ICON_SIZE}
                      strokeWidth={2}
                    />
                  )
                }
              />
            </span>
          </Tooltip>
        )}
        {visibleRegionNotice && (
          <RegionNoticeButton
            title={visibleRegionNotice.title}
            body={<p className="m-0">{visibleRegionNotice.body}</p>}
            alertClassName="border-border-2! bg-chat-container! text-text-1! shadow-lg"
          />
        )}
        {focusedWorkstationMenuHostRef && (
          <span
            ref={focusedWorkstationMenuHostRef}
            className="inline-flex shrink-0 @[1100px]/focusedchat:hidden"
          />
        )}
        {showSessionContent && (
          <SessionHeaderActionsMenu
            activeSessionExists={activeSessionExists}
            copyEventJsonLabel={copyEventJsonLabel}
            currentSessionId={currentSessionId}
            appOpenSessionId={appOpenSessionId}
            displayMode={displayMode}
            eventsLength={eventsLength}
            handleCompactDisplayModeToggle={handleCompactDisplayModeToggle}
            handleCopyEventJson={handleCopyEventJson}
            handleMoveSession={handleMoveToWorkstation}
            handleOpenCloudShareSettings={handleOpenCloudShareSettings}
            handleOpenExportSessionJson={handleOpenExportSessionJson}
            handleOpenLinkWorkItem={handleOpenLinkWorkItem}
            handleOpenSearch={handleOpenSearch}
            handlePaginationToggle={handlePaginationToggle}
            handleReloadFromMenu={handleReloadFromMenu}
            handleTokenUsageVisibleToggle={handleTokenUsageVisibleToggle}
            handleTurnMetadataVisibleToggle={handleTurnMetadataVisibleToggle}
            headerActionsDropdownRef={headerActionsDropdownRef}
            headerActionsPosition={headerActionsPosition}
            headerActionsTriggerRef={headerActionsTriggerRef}
            isHeaderActionsOpen={isHeaderActionsOpen}
            isHeaderActionsPositioned={isHeaderActionsPositioned}
            moveTarget="workstation"
            paginationEnabled={paginationEnabled}
            showCloudShareSettings={showCloudShareSettings}
            showTranscriptActions={showTranscriptActions}
            tokenUsageVisible={tokenUsageVisible}
            turnMetadataVisible={turnMetadataVisible}
            toggleHeaderActionsMenu={toggleHeaderActionsMenu}
            triggerTestId="chat-panel-header-more-button"
          />
        )}
      </div>
    ) : null;
  const chatFocusToggleButton = pinnedChromeInThisHeader ? null : (
    <ChatPaneFocusButton
      focused={isChatFocus}
      chatPanelPosition={chatPanelPosition}
      onClick={handleChatFocusToggle}
    />
  );

  const renderTabControls = (collapsed: boolean) => (
    <HeaderActionGroup
      data-testid={collapsed ? "chat-panel-collapsed-tab-controls" : undefined}
    >
      {showLaunchpadSearch && <LaunchpadSearchTrigger placement="trailing" />}
      {tabStripPlus}
      {chatFocusToggleButton}
    </HeaderActionGroup>
  );

  const publishedContent =
    publishedHeaderSlots?.content ?? sessionHeaderContent;
  const launchpadSearch = showLaunchpadSearch ? (
    <LaunchpadSearchTrigger />
  ) : null;
  // While collapsed this row is the pane's only chrome, so it renders even for
  // a surface that publishes nothing — otherwise folding the tab row would
  // strip the new-tab, close, and restore controls with it.
  // A split surface beneath the visible tab bar owns its controls in its
  // left-column header. Treat this as absent rather than merely hiding the
  // row so the shell also releases the 36px stack reservation.
  const effectivePublishedHeaderSlots = publishedHeaderSlots?.hidden
    ? null
    : tabRowCollapsed ||
        publishedHeaderSlots ||
        sessionHeaderContent ||
        sessionPublishedActions
      ? {
          leading: publishedHeaderSlots?.leading,
          content:
            publishedContent ??
            (tabRowCollapsed ? (
              <div
                className={
                  showLaunchpadSearch
                    ? "min-w-0 @[48rem]/launchpad-header:max-w-[30%]"
                    : "min-w-0"
                }
              >
                <ChatPanelCollapsedTabHeading />
              </div>
            ) : undefined),
          trailing:
            publishedHeaderSlots?.trailing ||
            sessionPublishedActions ||
            tabRowCollapsed ? (
              <div className="flex shrink-0 items-center gap-px">
                {publishedHeaderSlots?.trailing}
                {sessionPublishedActions}
                {tabRowCollapsed ? renderTabControls(true) : null}
              </div>
            ) : null,
        }
      : null;

  return (
    <ChatPanelChrome
      tabStrip={tabStrip}
      toolbar={renderTabControls(false)}
      centerContent={launchpadSearch}
      publishedHeaderSlots={effectivePublishedHeaderSlots}
      overlayPublishedHeader={overlayPublishedHeader}
      shouldOffsetHeaderForCollapsedSidebar={
        shouldOffsetHeaderForCollapsedSidebar
      }
      tabRowCollapsed={tabRowCollapsed}
      trailingInsetPx={trailingInsetPx}
    />
  );
}

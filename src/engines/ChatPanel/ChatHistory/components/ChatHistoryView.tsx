import React, { useCallback, useMemo } from "react";
import { createPortal } from "react-dom";

import type { AgentOrgRunMemberView } from "@src/api/tauri/agent";
import { CHAT_PANEL_WIDTH_TOKENS } from "@src/config/detailPanelTokens";
import { ChatLoadingBlock } from "@src/engines/ChatPanel/blocks/primitives";
import { resolvePinnedMinimapMarks } from "@src/engines/ChatPanel/chatSelections/pinnedMinimapMarks";
import { usePinnedChatSelections } from "@src/engines/ChatPanel/chatSelections/usePinnedChatSelections";
import { resolveTranscriptTopPaddingPx } from "@src/engines/ChatPanel/header/chatPanelHeaderLayout";
import CloudSessionDownloadProgressCard from "@src/features/Org2Cloud/CloudSessionDownloadProgressCard";
import { useCloudSessionHasDownloadSurface } from "@src/features/Org2Cloud/useCloudSessionDownloadSurface";
import type { ChatHistoryDisplayMode } from "@src/store/ui/chatPanel/displayPrefsAtoms";

import SessionHeader from "../../ChatItems/SessionHeader";
import { ChatHistoryDisplayModeProvider } from "../chatDisplayModeContext";
import type { UseChatEmptyStateReturn } from "../hooks/useChatEmptyState";
import type { useChatHistoryItemActions } from "../hooks/useChatHistoryItemActions";
import type { useChatHistoryProjectionModel } from "../hooks/useChatHistoryProjectionModel";
import type { UseChatHistoryStateReturn } from "../hooks/useChatHistoryState";
import type { useChatNavigationController } from "../hooks/useChatNavigationController";
import type { UseChatSearchReturn } from "../hooks/useChatSearch";
import type { useChatViewportController } from "../hooks/useChatViewportController";
import {
  isRetryableFailedUserIntentHeader,
  useGroupHeaderRenderer,
} from "../hooks/useGroupHeaderRenderer";
import type { useReloadSession } from "../hooks/useReloadSession";
import AgentOrgOverviewTray from "./AgentOrgOverviewTray";
import ChatHistoryEmptyState from "./ChatHistoryEmptyState";
import {
  buildChatGroupFallbackIds,
  buildChatGroupRenderKeys,
} from "./ChatHistoryListLayout";
import ChatPinnedHeaderLayer from "./ChatPinnedHeaderLayer";
import ChatSearchBar from "./ChatSearchBar";
import ChatSelectionActions from "./ChatSelectionActions";
import ConversationMinimap from "./ConversationMinimap";
import PlanningIndicatorBridge from "./PlanningIndicatorBridge";
import RevertConfirmDialog from "./RevertConfirmDialog";
import TurnMetadataLoader from "./TurnMetadataLoader";
import TurnPageList from "./TurnPageList";

type ProjectionModel = ReturnType<typeof useChatHistoryProjectionModel>;
type NavigationModel = ReturnType<typeof useChatNavigationController>;
type ViewportModel = ReturnType<typeof useChatViewportController>;
type ActionsModel = ReturnType<typeof useChatHistoryItemActions>;

const BOTTOM_OVERLAY_FADE_PX = 32;
const EMPTY_PINNED_MINIMAP_MARKS: ReturnType<typeof resolvePinnedMinimapMarks> =
  [];
const VIRTUALIZED_BODY_STYLE: React.CSSProperties = {
  backfaceVisibility: "hidden",
  contain: "layout paint",
  transform: "translateZ(0)",
  willChange: "transform",
};
const renderNoGroupHeader = () => <div aria-hidden style={{ minHeight: 1 }} />;

interface ChatHistoryViewProps {
  actions: ActionsModel;
  activeId: string | null;
  agentOrgCurrentMemberId: string | null;
  agentOrgCurrentMemberName: string | null;
  agentOrgMembers: AgentOrgRunMemberView[];
  agentOrgOverviewPanel?: React.ReactNode;
  bottomInset: number;
  chromeTopInset: number;
  displayMode: ChatHistoryDisplayMode;
  emptyState: UseChatEmptyStateReturn;
  groupChatEnabled: boolean;
  groupChatViewActive: boolean;
  groupChatViewAvailable: boolean;
  handlePlanningIndicatorCount: (count: 0 | 1) => void;
  handleReloadSession: ReturnType<typeof useReloadSession>;
  hideGroupUserMessage: boolean;
  historyState: UseChatHistoryStateReturn;
  mutationActionsDisabled: boolean;
  navigation: NavigationModel;
  newEventDividerLabel: string | null;
  onAgentOrgMemberSelect?: (member: AgentOrgRunMemberView) => void;
  onAgentOrgRunViewRefresh?: () => Promise<void>;
  onGroupChatViewToggle?: (active: boolean) => void;
  paginationTrailingSlot?: React.ReactNode;
  pinnedHeaderPortalHost: HTMLElement | null;
  planningIndicatorScope: { sessionId: string; isLive: boolean } | null;
  projection: ProjectionModel;
  search: UseChatSearchReturn;
  surfaceBgClass: string;
  turnPaginationEnabled: boolean;
  turnMetadataEnabled: boolean;
  viewport: ViewportModel;
}

const ChatHistoryView: React.FC<ChatHistoryViewProps> = ({
  actions,
  activeId,
  agentOrgCurrentMemberId,
  agentOrgCurrentMemberName,
  agentOrgMembers,
  agentOrgOverviewPanel,
  bottomInset,
  chromeTopInset,
  displayMode,
  emptyState,
  groupChatEnabled,
  groupChatViewActive,
  groupChatViewAvailable,
  handlePlanningIndicatorCount,
  handleReloadSession,
  hideGroupUserMessage,
  historyState,
  mutationActionsDisabled,
  navigation,
  newEventDividerLabel,
  onAgentOrgMemberSelect,
  onAgentOrgRunViewRefresh,
  onGroupChatViewToggle,
  paginationTrailingSlot,
  pinnedHeaderPortalHost,
  planningIndicatorScope,
  projection,
  search,
  surfaceBgClass,
  turnPaginationEnabled,
  turnMetadataEnabled,
  viewport,
}) => {
  const {
    chatHistory,
    chatContainerRef,
    virtualListRef,
    chatFontSize,
    chatCodeFontSize,
    chatLineHeight,
    sessionLoadStatus,
    sessionLoadError,
    isWpGeneWorkingRef,
  } = historyState;
  const {
    activeProjectionHistory,
    currentPageIndex,
    currentTurnPageLabel,
    currentTurnPageTimeLabel,
    defaultTurnCollapsed,
    displayFlatItems,
    displayGroupCounts,
    displayGroupHeaders,
    displayGroupMeta,
    displaySourceGroupIndices,
    displayTotalFlatItems,
    displayTurnIds,
    groupCounts,
    groupHeaders,
    groupMeta,
    handleNextTurnPage,
    handlePreviousTurnPage,
    pageCount,
    pages,
    planningIndicatorEnabled,
    projection: projectionResult,
    selectTurnPage,
    setTurnPageListOpen,
    setTurnPageSortAscending,
    tailTurnPhase,
    turnMetadataReloadKey,
    turnPageListOpen,
    turnPageSortAscending,
    turnPaginationReady,
    virtualListDataKey,
  } = projection;
  const {
    activeGroupIndex,
    activePinnedHeader,
    activePinnedMeta,
    activePinnedSourceGroupIndex,
    agentOrgOverviewOpen,
    conversationHistoryPageIndex,
    handleActiveGroupIndexChange,
    handleConversationHistoryClose,
    handleConversationHistorySelect,
    handleConversationHistorySortToggle,
    handleConversationMinimapNavigate,
    setAgentOrgOverviewOpen,
    showPinnedTurnHeader,
    visibleGroupIndices,
  } = navigation;
  const {
    conversationMinimapScrolling,
    detachForNavigation,
    footerSpacerHeight,
    handleChatListScrollStateChange,
    handleRangeChanged,
    handleTurnPageEndReached,
    isLoadingMore,
    preserveForLayoutMutation,
    reconcileLayout,
    scrollAreaRef,
    scrollToBottom,
    setScrollRoot,
    staticScrollerRef,
    virtuosoScrollerRef,
  } = viewport;
  const {
    handleEditUserMessage,
    handleHeaderRestoreCheckpoint,
    handlePinnedEditSubmit,
    handleRegenerateGroup,
  } = actions;

  const getIsWpGeneWorking = useCallback(
    () => isWpGeneWorkingRef.current ?? false,
    [isWpGeneWorkingRef]
  );
  const hasCloudDownloadProgress = useCloudSessionHasDownloadSurface(activeId);
  // Anchor for the live status trail's elapsed readout. Read from the FULL
  // projection, not the current page: with turn pagination on, the visible
  // page may not hold the running round, and the trail is about that round.
  const tailTurnStartedAtMs = useMemo(
    () => groupMeta[groupMeta.length - 1]?.startMs ?? null,
    [groupMeta]
  );
  // Newest timestamped thing in the transcript, for the trail's quiet-session
  // timeout. Falls back to the turn's own start: a round that has produced no
  // body items yet still had activity when the user sent it.
  const tailTurnLastActivityAtMs = useMemo(() => {
    const tail = groupMeta[groupMeta.length - 1];
    return tail?.endMs ?? tail?.startMs ?? null;
  }, [groupMeta]);

  const renderGroupHeader = useGroupHeaderRenderer({
    displaySourceGroupIndices,
    sourceGroupCount: groupCounts.length,
    displayGroupHeaders,
    displayGroupMeta,
    displayGroupCount: displayGroupCounts.length,
    collapseLabelVariant: groupChatEnabled ? "agents" : "agent",
    turnPaginationEnabled,
    tailTurnPhase,
    hideUserMessage: hideGroupUserMessage,
    defaultTurnCollapsed,
    onBeforeTurnCollapseToggle: preserveForLayoutMutation,
    onEditSubmit: mutationActionsDisabled ? undefined : handleEditUserMessage,
    onFailedUserIntentEdit: handleEditUserMessage,
    onRestoreCheckpoint: mutationActionsDisabled
      ? undefined
      : handleHeaderRestoreCheckpoint,
  });
  const sessionInfo = useMemo(() => {
    const start = chatHistory.find(
      (event) => event.actionType === "session_start"
    );
    if (!start) return null;
    return {
      sessionId: start.sessionId,
      model:
        (start.args?.model as string) || (start.result?.model as string) || "",
      startedAt: start.createdAt,
    };
  }, [chatHistory]);
  const chatHistoryContainerStyle = useMemo<React.CSSProperties>(
    () =>
      ({
        minHeight: 0,
        fontSize: `${chatFontSize}px`,
        lineHeight: chatLineHeight ?? 1.6,
        "--chat-font-size": `${chatFontSize}px`,
        "--chat-code-font-size": `${chatCodeFontSize ?? 13}px`,
        "--chat-line-height": chatLineHeight ?? 1.6,
      }) as React.CSSProperties,
    [chatFontSize, chatCodeFontSize, chatLineHeight]
  );
  // Pinned passages ride the conversation navigator, so they have to be
  // resolved against the same group projection its markers use. The render
  // keys are rebuilt here with the list's own helpers rather than lifted out
  // of the list, which owns them for the virtualizer.
  const { pins, unpin } = usePinnedChatSelections(activeId);
  const pinnedMinimapMarks = useMemo(() => {
    if (pins.length === 0) return EMPTY_PINNED_MINIMAP_MARKS;
    const renderKeys = buildChatGroupRenderKeys(
      displayTurnIds,
      buildChatGroupFallbackIds(displayFlatItems, displayGroupCounts)
    );
    return resolvePinnedMinimapMarks(pins, renderKeys);
  }, [displayFlatItems, displayGroupCounts, displayTurnIds, pins]);
  const conversationMinimapOpen =
    !turnPaginationEnabled && !turnPageListOpen && !agentOrgOverviewOpen;
  // The scrollport reserves nothing for the minimap rail. While the rail has
  // no space of its own it floats as an inset pill over the transcript, and
  // it only goes flush against the edge once the pane is wide enough that it
  // covers nothing (see `ConversationMinimap`'s placement classes).
  const showTurnContextRow =
    turnPaginationEnabled ||
    Boolean(agentOrgCurrentMemberName) ||
    Boolean(agentOrgOverviewPanel);
  const transcriptTopPaddingPx = resolveTranscriptTopPaddingPx(
    chromeTopInset,
    turnPaginationEnabled || groupChatViewActive
  );
  const handlePreviousTurnPageNavigation = useCallback(() => {
    detachForNavigation();
    handlePreviousTurnPage();
  }, [detachForNavigation, handlePreviousTurnPage]);
  const handleNextTurnPageNavigation = useCallback(() => {
    detachForNavigation();
    handleNextTurnPage();
  }, [detachForNavigation, handleNextTurnPage]);
  const handleTurnPageSelect = useCallback(
    (pageIndex: number) => {
      detachForNavigation();
      selectTurnPage(pageIndex);
    },
    [detachForNavigation, selectTurnPage]
  );
  const pinnedHeaderLayer = (
    <ChatPinnedHeaderLayer
      showTurnContextRow={showTurnContextRow}
      agentName={agentOrgCurrentMemberName}
      currentMemberId={agentOrgCurrentMemberId}
      agentOrgMembers={agentOrgMembers}
      agentOrgOverviewPanel={agentOrgOverviewPanel}
      agentOrgOverviewOpen={agentOrgOverviewOpen}
      setAgentOrgOverviewOpen={setAgentOrgOverviewOpen}
      onAgentOrgMemberSelect={onAgentOrgMemberSelect}
      onAgentOrgRunViewRefresh={onAgentOrgRunViewRefresh}
      turnPaginationEnabled={turnPaginationEnabled}
      turnPaginationReady={turnPaginationReady}
      turnPageListOpen={turnPageListOpen}
      setTurnPageListOpen={setTurnPageListOpen}
      turnPageSortAscending={turnPageSortAscending}
      setTurnPageSortAscending={setTurnPageSortAscending}
      currentTurnPageLabel={currentTurnPageLabel}
      currentTurnPageTimeLabel={currentTurnPageTimeLabel}
      currentPageIndex={currentPageIndex}
      pageCount={pageCount}
      onPreviousTurnPage={handlePreviousTurnPageNavigation}
      onNextTurnPage={handleNextTurnPageNavigation}
      onLastTurnPage={scrollToBottom}
      trailingActions={paginationTrailingSlot}
      groupChatViewAvailable={groupChatViewAvailable}
      groupChatViewActive={groupChatViewActive}
      onGroupChatViewToggle={onGroupChatViewToggle}
      showPinnedTurnHeader={showPinnedTurnHeader}
      sourceGroupIndex={activePinnedSourceGroupIndex}
      sourceGroupCount={groupCounts.length}
      header={activePinnedHeader}
      meta={activePinnedMeta}
      collapseLabelVariant={groupChatEnabled ? "agents" : "agent"}
      tailTurnPhase={tailTurnPhase}
      hideUserMessage={hideGroupUserMessage}
      defaultTurnCollapsed={defaultTurnCollapsed}
      onBeforeTurnCollapseToggle={preserveForLayoutMutation}
      onEditSubmit={
        mutationActionsDisabled &&
        !isRetryableFailedUserIntentHeader(activePinnedHeader)
          ? undefined
          : handlePinnedEditSubmit
      }
      onRestoreCheckpoint={
        mutationActionsDisabled ? undefined : handleHeaderRestoreCheckpoint
      }
    />
  );
  // Share the outer split-view anchor with file Find so switching scope
  // never moves the card between pane headers.
  const searchOverlayHost =
    pinnedHeaderPortalHost?.closest<HTMLElement>(
      "[data-pane-surface-underlay]"
    ) ??
    pinnedHeaderPortalHost?.closest<HTMLElement>("[data-chat-panel]") ??
    pinnedHeaderPortalHost?.parentElement;
  const searchOverlay = search.isSearchVisible ? (
    <div
      className="pointer-events-none absolute top-2 right-2 left-2 z-50"
      style={chatHistoryContainerStyle}
      data-chat-search-chrome
    >
      <div className="pointer-events-auto ml-auto w-full max-w-sm">
        <ChatSearchBar search={search} sessionId={activeId} />
      </div>
    </div>
  ) : null;

  return (
    <ChatHistoryDisplayModeProvider value={displayMode}>
      <div
        className="wp__chat__history relative z-20 flex h-full max-w-full min-w-0 flex-1 flex-col self-stretch overflow-hidden"
        data-testid="chat-message-list"
        data-chat-history-count={chatHistory.length}
        data-optimized-count={activeProjectionHistory.length}
        data-flat-count={displayTotalFlatItems}
        data-group-shape={projectionResult.groupShapeDigest}
        ref={chatContainerRef as React.RefObject<HTMLDivElement>}
        style={chatHistoryContainerStyle}
      >
        {activeId ? (
          <ChatSelectionActions
            containerRef={chatContainerRef}
            sessionId={activeId}
          />
        ) : null}

        <div className={CHAT_PANEL_WIDTH_TOKENS.contentWidth}>
          <SessionHeader sessionInfo={sessionInfo} />
        </div>

        {searchOverlayHost
          ? createPortal(searchOverlay, searchOverlayHost)
          : searchOverlay}

        {pinnedHeaderPortalHost
          ? createPortal(
              <div
                className="chat-history-portal"
                style={chatHistoryContainerStyle}
              >
                {pinnedHeaderLayer}
              </div>,
              pinnedHeaderPortalHost
            )
          : pinnedHeaderLayer}

        {/* Anchor cloud-download progress to the chat-pane header edge instead
            of the virtualized body below SessionHeader. Transcript items and
            pinned headers create local z-layers up to 70, so this status-only
            layer sits above chat content but below app modals (z-10000+). */}
        {hasCloudDownloadProgress && activeProjectionHistory.length > 0 && (
          <div
            className={`pointer-events-none absolute top-0 right-0 left-0 z-9999 mx-auto p-2 ${CHAT_PANEL_WIDTH_TOKENS.contentMaxWidth}`}
          >
            <CloudSessionDownloadProgressCard sessionId={activeId} />
          </div>
        )}

        <div className="flex min-h-0 flex-1 flex-col">
          {agentOrgOverviewOpen && agentOrgOverviewPanel && (
            <AgentOrgOverviewTray surfaceBgClass={surfaceBgClass}>
              {agentOrgOverviewPanel}
            </AgentOrgOverviewTray>
          )}

          <div
            className="@container/chatbody relative min-h-0 flex-1"
            style={VIRTUALIZED_BODY_STYLE}
            data-chat-virtualized-body-layer
          >
            {conversationMinimapOpen && (
              <ConversationMinimap
                groupHeaders={displayGroupHeaders}
                groupMeta={displayGroupMeta}
                groupCounts={displayGroupCounts}
                flatItems={displayFlatItems}
                activeGroupIndex={activeGroupIndex}
                visibleGroupIndices={visibleGroupIndices}
                isAtBottom={historyState.atBottom}
                isScrolling={conversationMinimapScrolling}
                labelVariant={groupChatEnabled ? "agents" : "agent"}
                onNavigate={handleConversationMinimapNavigate}
                pinnedMarks={pinnedMinimapMarks}
                onPinnedRemove={unpin}
              />
            )}

            {turnPageListOpen &&
              (turnPaginationEnabled
                ? turnPaginationReady
                : pages.length > 0) && (
                <TurnPageList
                  surfaceBgClass={surfaceBgClass}
                  bottomInset={bottomInset}
                  pages={pages}
                  groupHeaders={groupHeaders}
                  groupMeta={groupMeta}
                  currentPageIndex={conversationHistoryPageIndex}
                  turnPageSortAscending={turnPageSortAscending}
                  onSelectTurnPage={
                    turnPaginationEnabled
                      ? handleTurnPageSelect
                      : handleConversationHistorySelect
                  }
                  onToggleSort={
                    turnPaginationEnabled
                      ? undefined
                      : handleConversationHistorySortToggle
                  }
                  onClose={
                    turnPaginationEnabled
                      ? undefined
                      : handleConversationHistoryClose
                  }
                />
              )}

            {isLoadingMore && (
              <div
                className={`pointer-events-none absolute top-0 right-0 left-0 z-9999 mx-auto p-2 ${CHAT_PANEL_WIDTH_TOKENS.contentMaxWidth}`}
              >
                <div className={`pointer-events-auto ${surfaceBgClass}`}>
                  <ChatLoadingBlock />
                </div>
              </div>
            )}

            {bottomInset > 0 && (
              <div
                className="pointer-events-none absolute right-0 bottom-0 left-0 z-10"
                style={{
                  height: bottomInset,
                  maskImage: `linear-gradient(to bottom, transparent 0, black ${BOTTOM_OVERLAY_FADE_PX}px)`,
                  WebkitMaskImage: `linear-gradient(to bottom, transparent 0, black ${BOTTOM_OVERLAY_FADE_PX}px)`,
                }}
              >
                <div className={`h-full w-full ${surfaceBgClass}`} />
              </div>
            )}

            <div
              ref={scrollAreaRef}
              className="absolute inset-0 overflow-hidden"
            >
              <div className="h-full w-full">
                {activeProjectionHistory.length > 0 ? (
                  <>
                    {turnMetadataEnabled && (
                      <TurnMetadataLoader
                        sessionId={activeId}
                        reloadKey={turnMetadataReloadKey}
                        turnIds={displayTurnIds}
                      />
                    )}
                    <PlanningIndicatorBridge
                      planningIndicatorScope={planningIndicatorScope}
                      planningIndicatorEnabled={planningIndicatorEnabled}
                      onPlanningIndicatorCount={handlePlanningIndicatorCount}
                      tailTurnStartedAtMs={tailTurnStartedAtMs}
                      tailTurnLastActivityAtMs={tailTurnLastActivityAtMs}
                      flatItems={displayFlatItems}
                      groupCounts={displayGroupCounts}
                      turnIds={displayTurnIds}
                      totalFlatItems={displayTotalFlatItems}
                      footerSpacerHeight={footerSpacerHeight}
                      bottomInset={bottomInset}
                      topPaddingPx={transcriptTopPaddingPx}
                      virtualListRef={virtualListRef}
                      virtualListDataKey={virtualListDataKey}
                      getIsWpGeneWorking={getIsWpGeneWorking}
                      renderGroupHeader={
                        turnPaginationEnabled
                          ? renderNoGroupHeader
                          : renderGroupHeader
                      }
                      onAtBottomStateChange={handleChatListScrollStateChange}
                      onRangeChanged={handleRangeChanged}
                      onActiveGroupIndexChange={handleActiveGroupIndexChange}
                      hideActiveGroupHeader={turnPaginationEnabled}
                      onEndReached={handleTurnPageEndReached}
                      onRegenerate={
                        mutationActionsDisabled
                          ? undefined
                          : handleRegenerateGroup
                      }
                      onEditUserMessage={
                        mutationActionsDisabled
                          ? undefined
                          : handleEditUserMessage
                      }
                      virtualScrollerRef={virtuosoScrollerRef}
                      staticScrollerRef={staticScrollerRef}
                      onScrollRootChange={setScrollRoot}
                      onRowLayoutCommit={reconcileLayout}
                      newEventDividerLabel={newEventDividerLabel}
                    />
                  </>
                ) : (
                  <ChatHistoryEmptyState
                    sessionId={activeId}
                    sessionLoadStatus={sessionLoadStatus}
                    sessionLoadError={sessionLoadError}
                    emptyConfirmed={emptyState.emptyConfirmed}
                    shouldShowEmpty={emptyState.shouldShowEmpty}
                    isRolledBack={emptyState.isRolledBack}
                    projectionPending={
                      projectionResult.pending && chatHistory.length > 0
                    }
                    onReload={handleReloadSession}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
        <RevertConfirmDialog />
      </div>
    </ChatHistoryDisplayModeProvider>
  );
};

ChatHistoryView.displayName = "ChatHistoryView";

export default ChatHistoryView;

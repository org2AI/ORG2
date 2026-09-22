import { useCallback, useEffect, useRef, useState } from "react";

import type {
  BrowserAddToConversationNavState,
  FollowAgentNavState,
  ScrollNavState,
} from "../ChatHistory.types";
import { CHAT_FOOTER_SPACER } from "../config/chatFooterSpacer";
import { useTranscriptViewport } from "../viewport/useTranscriptViewport";
import { useChatFooterSpacer } from "./useChatFooterSpacer";
import type { UseChatHistoryStateReturn } from "./useChatHistoryState";
import { useChatPagination } from "./useChatPagination";

const FLOATING_MINIMAP_IDLE_DELAY_MS = 1_200;

interface UseChatViewportControllerOptions {
  activeId: string | null;
  bottomInset: number;
  browserAddToConversationNav: BrowserAddToConversationNavState;
  displayTotalFlatItems: number;
  followAgentNav: FollowAgentNavState;
  latestLocalSubmitId: string | null;
  onScrollNavChange?: (state: ScrollNavState) => void;
  onSelectLatestTurnPage?: () => void;
  setAtBottom: UseChatHistoryStateReturn["setAtBottom"];
  setIsChatScrolledToBottom: UseChatHistoryStateReturn["setIsChatScrolledToBottom"];
  setVisibleRange: UseChatHistoryStateReturn["setVisibleRange"];
  tailFollowKey: string;
  tailFollowMode: "reader-controlled" | "always";
  totalFlatItems: number;
  turnPaginationEnabled: boolean;
  virtualListRef: UseChatHistoryStateReturn["virtualListRef"];
}

/**
 * Coordinates pagination, footer layout and the single source-neutral
 * transcript viewport owner around one chat scroll root.
 */
export function useChatViewportController({
  activeId,
  bottomInset,
  browserAddToConversationNav,
  displayTotalFlatItems,
  followAgentNav,
  latestLocalSubmitId,
  onScrollNavChange,
  onSelectLatestTurnPage,
  setAtBottom,
  setIsChatScrolledToBottom,
  setVisibleRange,
  tailFollowKey,
  tailFollowMode,
  totalFlatItems,
  turnPaginationEnabled,
  virtualListRef,
}: UseChatViewportControllerOptions) {
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const staticScrollerRef = useRef<HTMLDivElement>(null);
  const visibleRangeEndRef = useRef(0);

  const { isLoadingMore, handleRangeChanged, handleEndReached } =
    useChatPagination({
      optimizedChatHistoryLength: totalFlatItems,
      setVisibleRange,
      visibleRangeEndRef,
    });
  const { footerSpacerHeight, virtuosoScrollerRef } = useChatFooterSpacer({
    bottomInset,
  });

  const handleAtTailChange = useCallback(
    (nextAtBottom: boolean) => {
      setAtBottom((previous) =>
        previous === nextAtBottom ? previous : nextAtBottom
      );
      setIsChatScrolledToBottom(nextAtBottom);
    },
    [setAtBottom, setIsChatScrolledToBottom]
  );
  const ensureAnchorMounted = useCallback(
    (anchorId: string) =>
      virtualListRef.current?.revealTranscriptAnchor(anchorId) ?? true,
    [virtualListRef]
  );
  const {
    detachForNavigation,
    followTail,
    handleScroll,
    preserveForLayoutMutation,
    reconcileLayout,
    setScrollRoot,
    showScrollToBottom,
  } = useTranscriptViewport({
    sessionKey: activeId,
    contentKey: tailFollowKey,
    itemCount: displayTotalFlatItems,
    tailGapPx: CHAT_FOOTER_SPACER.MIN_WHEN_FULL_PX,
    localSubmitKey: latestLocalSubmitId,
    followPolicy: tailFollowMode,
    onAtTailChange: handleAtTailChange,
    onExplicitFollow: onSelectLatestTurnPage,
    ensureAnchorMounted,
  });

  const [conversationMinimapScrolling, setConversationMinimapScrolling] =
    useState(false);
  const conversationMinimapIdleTimerRef = useRef<number | null>(null);
  const handleChatListScrollStateChange = useCallback(
    (nextAtBottom: boolean) => {
      handleScroll(nextAtBottom);
      setConversationMinimapScrolling(true);
      if (conversationMinimapIdleTimerRef.current !== null) {
        window.clearTimeout(conversationMinimapIdleTimerRef.current);
      }
      conversationMinimapIdleTimerRef.current = window.setTimeout(() => {
        conversationMinimapIdleTimerRef.current = null;
        setConversationMinimapScrolling(false);
      }, FLOATING_MINIMAP_IDLE_DELAY_MS);
    },
    [handleScroll]
  );
  useEffect(
    () => () => {
      if (conversationMinimapIdleTimerRef.current !== null) {
        window.clearTimeout(conversationMinimapIdleTimerRef.current);
      }
    },
    []
  );

  useEffect(() => {
    onScrollNavChange?.({
      showScrollToBottom,
      onScrollToBottom: followTail,
      ...followAgentNav,
      ...browserAddToConversationNav,
    });
  }, [
    browserAddToConversationNav,
    followAgentNav,
    onScrollNavChange,
    followTail,
    showScrollToBottom,
  ]);

  const handleTurnPageEndReached = useCallback(() => {
    if (!turnPaginationEnabled) handleEndReached();
  }, [turnPaginationEnabled, handleEndReached]);

  return {
    conversationMinimapScrolling,
    detachForNavigation,
    footerSpacerHeight,
    handleChatListScrollStateChange,
    handleRangeChanged,
    handleTurnPageEndReached,
    isLoadingMore,
    scrollAreaRef,
    scrollToBottom: followTail,
    preserveForLayoutMutation,
    reconcileLayout,
    setScrollRoot,
    staticScrollerRef,
    virtuosoScrollerRef,
  };
}

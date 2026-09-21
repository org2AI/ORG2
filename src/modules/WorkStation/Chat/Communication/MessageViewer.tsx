import { useAtomValue } from "jotai";
import React, { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { AgentOrgRunMemberView, AgentOrgTask } from "@src/api/tauri/agent";
import Button from "@src/components/Button";
import { ViewportLayoutMutationProvider } from "@src/components/ViewportLayoutMutationContext";
import { useChatSearchPanePresentation } from "@src/engines/ChatPanel/ChatHistory/hooks/chatSearch";
import { useTranscriptViewport } from "@src/engines/ChatPanel/ChatHistory/viewport/useTranscriptViewport";
import { useStreamingDeltaForSession } from "@src/engines/SessionCore";
import { sessionIdAtom } from "@src/engines/SessionCore/core/atoms";
import {
  derivePlanApprovalViewState,
  isPlanDisplayEvent,
} from "@src/engines/SessionCore/derived/planDisplayEvents";
import { usePendingPlanApproval } from "@src/hooks/session/usePendingPlanApproval";
import { HugeiconsIcon, UnfoldMoreIcon } from "@src/icons";
import type { SessionReplayPlaceholderMode } from "@src/modules/WorkStation/shared";

import { EmptyState } from "./EmptyState";
import {
  BubbleWrapper,
  NewMessageDivider,
} from "./MessageViewer/MessageBubbleRenderer";
import {
  DEFAULT_INITIAL_RENDERED_MESSAGE_COUNT,
  LOAD_MORE_MESSAGE_COUNT,
  MESSAGE_INITIAL_RENDERED_MESSAGE_COUNT,
} from "./MessageViewer/constants";
import {
  getPlanDocStatusViewModel,
  getPlanDocViewModel,
  planSurfaceStatusLabel,
} from "./MessageViewer/planDocViewModel";
import { PlanDocPanel } from "./PlanDocPanel";
import { TodoKanban } from "./TodoKanban";
import { isEmailBubbleEvent } from "./emailBubbleEvent";
import type { MessageEntry, MessageViewMode } from "./types";

function minuteBucket(timestamp: string): number {
  return Math.floor(new Date(timestamp).getTime() / 60_000);
}

function isRegularMessageBubble(message: MessageEntry): boolean {
  return (
    message.sender === "agent" &&
    message.type === "chat" &&
    message.event.functionName !== "org_send_message" &&
    !isEmailBubbleEvent(message.event)
  );
}

function shouldGroupWithPreviousMessage(
  message: MessageEntry,
  previousMessage: MessageEntry | undefined
): boolean {
  if (!previousMessage) return false;
  if (
    !isRegularMessageBubble(message) ||
    !isRegularMessageBubble(previousMessage)
  ) {
    return false;
  }
  if (message.sender !== previousMessage.sender) return false;
  if (message.event.sessionId !== previousMessage.event.sessionId) return false;
  return (
    minuteBucket(message.timestamp) === minuteBucket(previousMessage.timestamp)
  );
}

export interface MessageViewerProps {
  /** Full bucket for the active tab; chat mode still renders it through the recent-message window below. */
  messages: MessageEntry[];
  /** Current view mode */
  viewMode: MessageViewMode;
  /** Callback when a message is clicked (to jump to that event) */
  onMessageClick?: (eventId: string) => void;
  /** Whether the viewer is mounted inside interactive chat or a replay recording. */
  sessionReplayMode?: SessionReplayPlaceholderMode;
  /**
   * Preview mode for the plan doc panel — controlled by the parent (tab bar).
   * Defined only when the active message is a plan doc.
   */
  planPreviewMode?: boolean;
  /**
   * When set, the plan doc panel renders an edit textarea instead of the viewer.
   * Controlled by the parent (tab bar Edit button).
   */
  planEditState?: {
    value: string;
    onChange: (value: string) => void;
  };
  /** Hide stale plan docs after Build / archive; the plan file may still exist on disk. */
  planDocPending?: boolean;
  activePlanMessage?: MessageEntry | null;
  selectedMessage?: MessageEntry | null;
  previewSelectedPlan?: boolean;
  /** Current replay event id; used to keep transcript views pinned to bottom. */
  currentEventId?: string | null;
  /**
   * Switch the Communication view mode. Used by the Agent Team task-list
   * card's navigate arrow to jump from the chat stream to the Todo Kanban
   * tab without forcing a manual tab click.
   */
  setViewMode?: (mode: MessageViewMode) => void;
  /**
   * Active org-run member roster — used by bubble wrappers to resolve a
   * subagent name (e.g. "Planner") from `event.sessionId`. Empty when the
   * outer session has no org run (or the runtime hasn't yet returned a
   * view); bubbles fall back to a generic "Agent" label in that case.
   */
  orgMembers?: ReadonlyArray<AgentOrgRunMemberView>;
  /** Durable task snapshot for Agent Org sessions. Undefined for ordinary sessions. */
  agentOrgTasks?: ReadonlyArray<AgentOrgTask>;
  /** Shared chat-search sync: drop panel-local selection when the active match moves. */
  onSearchActiveEventChange?: (eventId: string | null) => void;
}

export const MessageViewer: React.FC<MessageViewerProps> = ({
  messages,
  viewMode,
  onMessageClick,
  sessionReplayMode = "simulation",
  planPreviewMode,
  planEditState,
  planDocPending = false,
  activePlanMessage: controlledActivePlanMessage,
  selectedMessage,
  previewSelectedPlan = false,
  currentEventId,
  setViewMode,
  orgMembers,
  agentOrgTasks,
  onSearchActiveEventChange,
}) => {
  const handleNavigateToTodoList = useCallback(() => {
    setViewMode?.("todo");
  }, [setViewMode]);
  const { t } = useTranslation(["common", "sessions"]);
  const sessionId = useAtomValue(sessionIdAtom);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const replayWindowKey = `${viewMode}:${currentEventId ?? ""}`;
  const initialRenderedMessageCount =
    viewMode === "chat" || viewMode === "todo"
      ? MESSAGE_INITIAL_RENDERED_MESSAGE_COUNT
      : DEFAULT_INITIAL_RENDERED_MESSAGE_COUNT;
  const [messageWindow, setMessageWindow] = useState({
    key: replayWindowKey,
    count: initialRenderedMessageCount,
  });
  const renderedMessageCount =
    messageWindow.key === replayWindowKey
      ? messageWindow.count
      : initialRenderedMessageCount;
  const lastMessageId = messages[messages.length - 1]?.eventId ?? null;
  const visibleMessages = useMemo(
    () => messages.slice(-renderedMessageCount),
    [messages, renderedMessageCount]
  );
  const hiddenMessageCount = Math.max(
    0,
    messages.length - visibleMessages.length
  );
  const canLoadMoreMessages = hiddenMessageCount > 0;
  const totalVisibleMessages = visibleMessages.length;
  const showNewMessageDivider = viewMode === "chat" && totalVisibleMessages > 0;
  const latestVisibleMessage = visibleMessages[visibleMessages.length - 1];
  const latestLiveDelta = useStreamingDeltaForSession(
    latestVisibleMessage?.event.args?.syntheticLive === true
      ? latestVisibleMessage.event.sessionId
      : null
  );
  const liveContentLength =
    latestLiveDelta?.kind === "message" ? latestLiveDelta.content.length : 0;
  const viewportContentKey = `${replayWindowKey}:${messages.length}:${lastMessageId ?? ""}:${liveContentLength}`;
  const {
    detachForNavigation,
    handleScroll,
    preserveForLayoutMutation,
    setScrollRoot,
  } = useTranscriptViewport({
    sessionKey: `${sessionId ?? "session"}:${sessionReplayMode}:${viewMode}`,
    contentKey: viewportContentKey,
    itemCount: visibleMessages.length,
  });
  const setScrollContainer = useCallback(
    (node: HTMLDivElement | null) => {
      scrollContainerRef.current = node;
      setScrollRoot(node);
    },
    [setScrollRoot]
  );
  const handleSearchActiveEventChange = useCallback(
    (eventId: string | null) => {
      if (eventId) detachForNavigation();
      onSearchActiveEventChange?.(eventId);
    },
    [detachForNavigation, onSearchActiveEventChange]
  );
  const { activeEventId: activeSearchEventId } = useChatSearchPanePresentation({
    sessionId,
    highlightRootRef: scrollContainerRef,
    scrollRootRef: scrollContainerRef,
    onActiveEventChange: handleSearchActiveEventChange,
    layoutKey: `${viewMode}:${currentEventId ?? ""}:${messages.length}`,
  });

  const handleLoadMoreMessages = useCallback(() => {
    preserveForLayoutMutation();

    setMessageWindow((current) => ({
      key: replayWindowKey,
      count: Math.min(
        messages.length,
        (current.key === replayWindowKey
          ? current.count
          : initialRenderedMessageCount) + LOAD_MORE_MESSAGE_COUNT
      ),
    }));
  }, [
    initialRenderedMessageCount,
    messages.length,
    preserveForLayoutMutation,
    replayWindowKey,
  ]);

  const latestPlanMessage = useMemo(() => {
    if (viewMode !== "preview") return null;
    for (
      let messageIndex = messages.length - 1;
      messageIndex >= 0;
      messageIndex--
    ) {
      if (isPlanDisplayEvent(messages[messageIndex].event)) {
        return messages[messageIndex];
      }
    }
    return null;
  }, [messages, viewMode]);

  const selectedPlanMessage =
    viewMode === "preview" && previewSelectedPlan && selectedMessage?.event
      ? isPlanDisplayEvent(selectedMessage.event)
        ? selectedMessage
        : null
      : null;
  const activePlanMessage =
    controlledActivePlanMessage ?? selectedPlanMessage ?? latestPlanMessage;
  const pendingPlan = usePendingPlanApproval(
    activePlanMessage?.event.sessionId
  );
  const canRenderDurableAgentOrgBoard =
    viewMode === "todo" && agentOrgTasks !== undefined;

  if (messages.length === 0 && !canRenderDurableAgentOrgBoard) {
    return (
      <div className="allow-select-deep flex h-full min-h-0 w-full flex-col">
        <EmptyState viewMode={viewMode} sessionReplayMode={sessionReplayMode} />
      </div>
    );
  }

  if (viewMode === "todo") {
    return (
      <div className="allow-select-deep flex h-full min-h-0 w-full flex-col overflow-hidden">
        <TodoKanban messages={messages} agentOrgTasks={agentOrgTasks} />
      </div>
    );
  }

  if (viewMode === "preview" && activePlanMessage) {
    const plan = getPlanDocViewModel(activePlanMessage.event, pendingPlan);
    const statusView = getPlanDocStatusViewModel(
      activePlanMessage.event,
      pendingPlan,
      t
    );
    const planViewState = derivePlanApprovalViewState({
      pendingPlan,
      chatEvents: messages.map((message) => message.event),
    });
    const previewSurfaceState = planViewState.getEventState(
      activePlanMessage.event,
      "preview"
    );
    const readyForReview =
      statusView.readyForReview && previewSurfaceState.ownsActions;
    const statusLabel = readyForReview
      ? statusView.label
      : planSurfaceStatusLabel(previewSurfaceState, t);
    return (
      <div
        data-testid="communication-plan-doc-surface"
        className="h-full min-h-0"
      >
        <PlanDocPanel
          content={plan.content}
          planRevisionId={plan.planRevisionId}
          statusLabel={statusLabel}
          readyForReview={readyForReview}
          planPath={plan.planPath}
          isPreviewMode={planPreviewMode ?? true}
          editState={planDocPending ? planEditState : undefined}
        />
      </div>
    );
  }

  return (
    <ViewportLayoutMutationProvider value={preserveForLayoutMutation}>
      <div
        className="allow-select-deep flex h-full w-full flex-col"
        data-testid="communication-message-viewer"
      >
        <div
          ref={setScrollContainer}
          data-testid="communication-message-scroll-container"
          tabIndex={0}
          className="scrollbar-hide min-h-0 flex-1 overflow-y-auto px-4"
          onScroll={() => handleScroll()}
        >
          <div
            className={
              viewMode === "chat"
                ? "flex flex-col gap-2 pt-3 pb-[120px]"
                : "flex flex-col gap-6 pt-4 pb-[120px]"
            }
          >
            {canLoadMoreMessages && (
              <div className="flex w-full justify-center py-1.5">
                <Button
                  variant="tertiary"
                  size="small"
                  icon={
                    <HugeiconsIcon
                      icon={UnfoldMoreIcon}
                      data-icon="chevrons-up-down"
                      size={14}
                    />
                  }
                  data-testid="communication-load-more-messages"
                  onClick={handleLoadMoreMessages}
                >
                  {t("simulator.replay.messages.divider.loadEarlierMessages", {
                    ns: "sessions",
                    count: hiddenMessageCount,
                  })}
                </Button>
              </div>
            )}
            {visibleMessages.map((message, index) => {
              const isLastVisibleMessage = index === totalVisibleMessages - 1;
              const previousMessage = visibleMessages[index - 1];
              const showChrome =
                isLastVisibleMessage ||
                !shouldGroupWithPreviousMessage(message, previousMessage);
              return (
                <React.Fragment key={message.eventId}>
                  {showNewMessageDivider && isLastVisibleMessage && (
                    <NewMessageDivider
                      label={t("simulator.replay.messages.divider.newMessage", {
                        ns: "sessions",
                      })}
                    />
                  )}
                  <BubbleWrapper
                    message={message}
                    viewMode={viewMode}
                    index={index}
                    total={totalVisibleMessages}
                    onMessageClick={onMessageClick}
                    onNavigateToTodoList={
                      setViewMode ? handleNavigateToTodoList : undefined
                    }
                    showChrome={showChrome}
                    orgMembers={orgMembers}
                    activeSearchEventId={activeSearchEventId}
                  />
                </React.Fragment>
              );
            })}
          </div>
        </div>
      </div>
    </ViewportLayoutMutationProvider>
  );
};

MessageViewer.displayName = "MessageViewer";

export default MessageViewer;

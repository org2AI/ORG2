import React, { memo, useMemo } from "react";
import { useTranslation } from "react-i18next";

import Message from "@src/components/Message";

import OutputImageGallery from "../../ChatItems/OutputImageGallery";
import {
  AgentTurnContext,
  type AgentTurnContextValue,
} from "../AgentTurnContext";
import { useGroupChatContext } from "../GroupChatView/GroupChatContext";
import GroupChatMessageBubble from "../GroupChatView/GroupChatMessageBubble";
import {
  isAgentOrgInboxTranscriptEvent,
  resolveGroupChatMessageBubble,
  resolveGroupChatToolUseSummary,
} from "../GroupChatView/groupChatUtils";
import { NewEventDivider } from "../components/NewEventDivider";
import TurnMetadataFooterSlot from "../components/TurnMetadataFooterSlot";
import { CHAT_FOOTER_SPACER } from "../config/chatFooterSpacer";
import {
  CHAT_EVENT_IDS_ATTR,
  CHAT_FLAT_INDEX_ATTR,
  CHAT_ITEM_ID_ATTR,
  formatChatEventIdsAttribute,
} from "../hooks/chatSearch";
import { collectChatItemEventIds } from "../hooks/chatSearchProjection";
import { getUnloadedTurnMeta, isTurnPreviewItem } from "../hooks/useChatGroups";
import { ChatItemRenderer } from "./ChatItemRenderer";
import ChatItemWrap from "./ChatItemWrap";
import { InboxTranscriptCard } from "./InboxTranscriptCard";
import { areGroupItemRendererPropsEqual } from "./groupItemRendererEquality";
import type { GroupItemRendererProps } from "./groupItemRendererTypes";

export type { GroupItemRendererProps } from "./groupItemRendererTypes";

const GROUP_CHAT_CONTINUATION_WINDOW_MS = 60_000;

function isWithinGroupChatContinuationWindow(
  previousTimestamp: string,
  currentTimestamp: string
): boolean {
  const previousTime = Date.parse(previousTimestamp);
  const currentTime = Date.parse(currentTimestamp);
  if (!Number.isFinite(previousTime) || !Number.isFinite(currentTime)) {
    return false;
  }
  const elapsedMs = currentTime - previousTime;
  return elapsedMs >= 0 && elapsedMs <= GROUP_CHAT_CONTINUATION_WINDOW_MS;
}

/**
 * Renders a single flat item within a chat-history group, wrapped in
 * an AgentTurnContext so descendants can surface turn-scoped actions
 * (e.g. Regenerate) without prop-drilling through the event registry.
 *
 * Note: the shared "Agent worked for …" collapse is applied
 * STRUCTURALLY in `useChatGroups` — collapsed body items are dropped
 * from `flatItems` and `groupCounts` before they ever reach this
 * renderer. Doing the hide here (via `return null`) leaves virtual item
 * size caches pointing at the pre-collapse heights, which
 * shows up as a tall blank tail beneath the surviving last reply.
 */
// memo: per-item renderer called 30-50x for each visible viewport.
// Parent (`ChatHistoryList`) is also memo'd and produces a stable
// `renderGroupItem` via `useCallback`, so we receive identical prop
// references across non-content re-renders.
export const GroupItemRenderer: React.FC<GroupItemRendererProps> = memo(
  ({
    flatIndex,
    groupIndex,
    turnId,
    chatItem,
    previousChatItem,
    isLastItemInGroup,
    isLastGroup,
    isWpGeneWorking,
    onRegenerate,
    onEditUserMessage,
    newEventDividerLabel = null,
  }) => {
    const { t } = useTranslation("sessions");
    const groupChat = useGroupChatContext();
    const event = chatItem?.event;

    const simpleMessage = useMemo(() => {
      if (!groupChat?.enabled || !event) return null;
      return resolveGroupChatMessageBubble(
        event,
        groupChat.coordinatorSessionId,
        groupChat.orgMembers
      );
    }, [groupChat, event]);

    const previousSimpleMessage = useMemo(() => {
      if (!groupChat?.enabled || !previousChatItem) return null;
      const previousEvent = previousChatItem.event;
      if (!previousEvent) return null;
      const message = resolveGroupChatMessageBubble(
        previousEvent,
        groupChat.coordinatorSessionId,
        groupChat.orgMembers
      );
      if (!message) return null;
      return { event: previousEvent, message };
    }, [groupChat, previousChatItem]);

    const inboxTranscriptLabel = useMemo(() => {
      if (!event || simpleMessage) return null;
      if (!isAgentOrgInboxTranscriptEvent(event)) return null;
      return t("groupChat.inboxTranscript.readMessages", {
        defaultValue: "Coordinator read messages sent by other agents",
      });
    }, [event, simpleMessage, t]);

    const usesGroupChatMessageBubble = simpleMessage !== null;
    const showGroupBubbleSenderChrome =
      simpleMessage !== null &&
      (previousSimpleMessage?.message.senderName !== simpleMessage.senderName ||
        !event ||
        !isWithinGroupChatContinuationWindow(
          previousSimpleMessage.event.createdAt,
          event.createdAt
        ));
    const groupChatToolUseSummary = useMemo(() => {
      if (!groupChat?.enabled || !event || !simpleMessage) return null;
      return resolveGroupChatToolUseSummary(event);
    }, [event, groupChat?.enabled, simpleMessage]);

    const treatAsAgentActivity = Boolean(
      groupChat?.enabled &&
      event?.source === "user" &&
      event &&
      !groupChat.isCoordinatorTurnHeader(event)
    );

    // Trailing-item turn gap. Placing the 24px gap on the LAST item of
    // each non-final group keeps the next group's header free of top
    // padding — so pinned headers stay flush at the top of the viewport,
    // while the visual turn boundary scrolls away with the previous
    // group's body. Skipped on the final group (no following turn to
    // separate from).
    const turnGapStyle =
      isLastItemInGroup && !isLastGroup
        ? { paddingBottom: CHAT_FOOTER_SPACER.ROUND_GAP_PX }
        : undefined;

    // Memoize the context value so consumers of `AgentTurnContext`
    // (e.g. `RegenerateButton`, `AgentErrorChatItem`) don't re-render
    // every time the parent ticks. Identity changes only when its inputs
    // actually change.
    const turnContext = useMemo<AgentTurnContextValue>(
      () => ({
        sessionId: event?.sessionId,
        outputImagesAtEnd: true,
        turnId,
        isLastGroup,
        isLastItemInGroup,
        onRegenerate: onRegenerate
          ? isWpGeneWorking
            ? () => Message.info("Workspace is working!")
            : () => onRegenerate(groupIndex)
          : undefined,
        groupSenderName:
          groupChat?.enabled && event && !usesGroupChatMessageBubble
            ? groupChat.resolveSenderName(event)
            : null,
      }),
      [
        turnId,
        isLastGroup,
        isLastItemInGroup,
        isWpGeneWorking,
        onRegenerate,
        groupIndex,
        usesGroupChatMessageBubble,
        groupChat,
        event,
      ]
    );

    const isStructuralUnloadedTurnItem = getUnloadedTurnMeta(chatItem) !== null;
    const isHiddenUnloadedTurnItem =
      isStructuralUnloadedTurnItem && !isTurnPreviewItem(chatItem);
    const isStructuralOnlyItem = chatItem?.structuralOnly === true;
    const groupMessageWrapClass = showGroupBubbleSenderChrome
      ? "pt-2! pb-0!"
      : "pt-1! pb-0!";

    const renderedItem =
      chatItem && !isHiddenUnloadedTurnItem && !isStructuralOnlyItem ? (
        inboxTranscriptLabel && event ? (
          <ChatItemWrap variant="text" className="py-1!">
            <InboxTranscriptCard event={event} title={inboxTranscriptLabel} />
          </ChatItemWrap>
        ) : simpleMessage ? (
          <ChatItemWrap variant="text" className={groupMessageWrapClass}>
            <GroupChatMessageBubble
              senderName={simpleMessage.senderName}
              recipientName={simpleMessage.recipientName}
              bodyMarkdown={simpleMessage.bodyMarkdown}
              timestamp={event?.createdAt ?? ""}
              showSenderChrome={showGroupBubbleSenderChrome}
              toolUseSummary={groupChatToolUseSummary}
            />
          </ChatItemWrap>
        ) : (
          <ChatItemRenderer
            chatItem={chatItem}
            index={flatIndex}
            onEditUserMessage={onEditUserMessage}
            treatAsAgentActivity={treatAsAgentActivity}
          />
        )
      ) : null;

    // Wrap the rendered item in a guaranteed-non-zero-height container.
    // The virtualizer measures each item’s `offsetHeight`; a zero-height
    // child triggers a "Zero-sized element, this should not happen"
    // console error. The pipeline tries to pre-filter empty events
    // (`willEventRenderContent`) but some shapes still resolve to `null`
    // downstream — e.g. structural collapse rows, raw events with no
    // registered renderer, and unknown chat-item `type`s that fall through
    // to `renderDefault`. The 1px floor keeps Virtuoso's measurement loop
    // quiet without introducing visible whitespace.
    // Per-turn "new event" divider. Painted above the group's last item
    // so subagent panes can signpost the freshest activity inside each
    // round. Suppressed when the surviving last item is a structural
    // collapse stub (would be a divider above nothing meaningful) or
    // when the host doesn't supply a label.
    const showNewEventDivider =
      isLastItemInGroup &&
      typeof newEventDividerLabel === "string" &&
      newEventDividerLabel.length > 0 &&
      !isStructuralUnloadedTurnItem &&
      !isStructuralOnlyItem;

    const chatSearchEventIds =
      chatItem && !isHiddenUnloadedTurnItem && !isStructuralOnlyItem
        ? collectChatItemEventIds(chatItem)
        : [];

    return (
      <AgentTurnContext.Provider value={turnContext}>
        <div
          style={{ minHeight: 1, ...turnGapStyle }}
          {...(chatItem
            ? {
                [CHAT_ITEM_ID_ATTR]: chatItem.chunk_id,
                [CHAT_FLAT_INDEX_ATTR]: flatIndex,
                ...(chatSearchEventIds.length > 0
                  ? {
                      [CHAT_EVENT_IDS_ATTR]:
                        formatChatEventIdsAttribute(chatSearchEventIds),
                    }
                  : {}),
              }
            : {})}
        >
          {showNewEventDivider && (
            <NewEventDivider label={newEventDividerLabel as string} />
          )}
          {renderedItem}
          {/* Projection owns gallery placement; a status footer may follow it. */}
          {chatItem?.outputImages?.length ? (
            <ChatItemWrap variant="text">
              <OutputImageGallery
                key={turnId ?? chatItem.chunk_id}
                images={chatItem.outputImages}
              />
            </ChatItemWrap>
          ) : null}
          {isLastItemInGroup &&
            renderedItem !== null &&
            !groupChat?.enabled &&
            !isStructuralUnloadedTurnItem &&
            !isStructuralOnlyItem &&
            turnId && (
              <TurnMetadataFooterSlot
                sessionId={event?.sessionId ?? null}
                turnId={turnId}
                isLastGroup={isLastGroup}
              />
            )}
        </div>
      </AgentTurnContext.Provider>
    );
  },
  areGroupItemRendererPropsEqual
);

GroupItemRenderer.displayName = "GroupItemRenderer";

import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Placeholder } from "@src/components/Placeholder";
import ScrollToBottomButton from "@src/components/ScrollToBottomButton";
import { CHAT_ITEM_PADDING_X } from "@src/engines/ChatPanel/blocks/primitives/config";

import type {
  TranscriptLoadPhase,
  TranscriptRoundSummary,
} from "../../lib/transcriptLoadState";
import type { TranscriptItem } from "../../lib/transcriptReducer";
import { AgentBubble } from "./AgentBubble";
import {
  type LoadMessageImage,
  MobileMessageImages,
  createImageRetention,
} from "./MobileMessageImages";
import { MobileToolCall } from "./MobileToolCall";
import { MobileToolDetailModal } from "./MobileToolDetailModal";
import {
  MobileLoadingDots,
  MobileTranscriptLoading,
} from "./MobileTranscriptLoading";
import { MobileTurnBody } from "./MobileTurnBody";
import { UserBubble } from "./UserBubble";
import {
  MOBILE_CHAT_ITEM_GAP,
  mobileTranscriptItemGapClass,
} from "./mobileChatSpacing";
import type { MobileFileTarget } from "./mobileFileTool";
import { useMobileChatScroll } from "./useMobileChatScroll";

export interface ChatTranscriptProps {
  sessionId: string;
  roundId?: string | null;
  round?: TranscriptRoundSummary;
  items: TranscriptItem[];
  phase: TranscriptLoadPhase;
  error?: string;
  /** Active local turn; forces the desktop-style tail follow after submit. */
  forceFollowKey?: string;
  /** Show ChatPanel's loading block until the active turn paints output. */
  waitingForAgent?: boolean;
  onRetry: () => void;
  loadImage?: LoadMessageImage;
  /** Endpoint + authenticated user + desktop identity, independent of connectivity. */
  imageScope?: string;
  onOpenFile?: (eventId: string, target: MobileFileTarget) => Promise<void>;
  footer?: React.ReactNode;
}

export function ChatTranscript({
  sessionId,
  roundId,
  round,
  items,
  phase,
  error,
  forceFollowKey,
  waitingForAgent = false,
  onRetry,
  onOpenFile,
  loadImage,
  imageScope,
  footer,
}: ChatTranscriptProps) {
  const { t } = useTranslation("mobileRemote");
  const transcriptScope = `${sessionId}:${roundId ?? "no-round"}`;
  const imageResourceScope = JSON.stringify([imageScope, sessionId, roundId]);
  const retention = useMemo(
    () => createImageRetention(),
    // A new authenticated resource owns a fresh retention scope, not each RPC.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [imageResourceScope]
  );
  const [toolDetail, setToolDetail] = useState<{
    scope: string;
    itemId: string;
    open: boolean;
  } | null>(null);
  const selectedTool =
    toolDetail?.scope === transcriptScope
      ? items.find(
          (item) => item.kind === "tool" && item.id === toolDetail.itemId
        )
      : undefined;
  const toolDetailOpen = Boolean(selectedTool && toolDetail?.open);
  const tailItem = items.at(-1);
  const tailToolDataSize =
    tailItem?.kind === "tool" && tailItem.toolData
      ? JSON.stringify(tailItem.toolData).length
      : 0;
  const contentKey = tailItem
    ? `${items.length}:${tailItem.id}:${tailItem.text.length}:${tailItem.streaming === true}:${tailItem.toolStatus ?? ""}:${tailToolDataSize}:${waitingForAgent}`
    : `empty:${waitingForAgent}`;
  const transcriptVisible =
    phase !== "error" &&
    phase !== "empty" &&
    (phase !== "loading" || items.length > 0);
  const {
    contentRef,
    scrollRef,
    scrollToBottom,
    showScrollToBottom,
    pauseTailFollow,
  } = useMobileChatScroll({
    sessionId: `${sessionId}:${roundId ?? "no-round"}`,
    contentKey,
    enabled: transcriptVisible,
    forceFollowKey,
  });

  if (phase === "error") {
    return (
      <Placeholder
        variant="error"
        placement="sidebar"
        fillParentHeight
        title={t("transcript.errorTitle")}
        subtitle={
          error
            ? t("transcript.errorDetail", { message: error })
            : t("transcript.errorSubtitle")
        }
        action={{ label: t("transcript.retry"), onClick: onRetry }}
      />
    );
  }

  if (phase === "loading" && items.length === 0) {
    return <MobileTranscriptLoading label={t("transcript.loading")} />;
  }

  if (phase === "empty") {
    return (
      <Placeholder
        variant="empty"
        placement="sidebar"
        fillParentHeight
        title={t("transcript.emptyTitle")}
        subtitle={t("transcript.emptySubtitle")}
      />
    );
  }

  return (
    <div className="mobile-chat-transcript relative min-h-0 min-w-0 flex-1">
      <div
        ref={scrollRef}
        className="h-full min-h-0 min-w-0 overflow-y-auto px-2 py-3"
        role="log"
        aria-live="polite"
      >
        <div ref={contentRef} className="flex w-full min-w-0 flex-col">
          <MobileTurnBody
            key={`${imageScope}:${transcriptScope}`}
            items={items}
            round={round}
            busy={waitingForAgent || phase !== "ready"}
            onBeforeToggle={pauseTailFollow}
            renderItem={(item, index) => {
              const previousItem = index > 0 ? items[index - 1] : undefined;
              const itemGapClass = mobileTranscriptItemGapClass(
                item,
                previousItem
              );
              let content: React.ReactNode;
              if (item.kind === "user") {
                content = (
                  <UserBubble text={item.text}>
                    <MobileMessageImages
                      key={imageResourceScope}
                      eventId={item.id}
                      count={item.imageCount ?? 0}
                      loadImage={loadImage}
                      retention={retention}
                    />
                  </UserBubble>
                );
              } else if (item.kind === "agent") {
                content = (
                  <AgentBubble text={item.text} streaming={item.streaming}>
                    <MobileMessageImages
                      key={imageResourceScope}
                      eventId={item.id}
                      count={item.imageCount ?? 0}
                      loadImage={loadImage}
                      retention={retention}
                    />
                  </AgentBubble>
                );
              } else {
                content = (
                  <MobileToolCall
                    item={item}
                    detailsOpen={toolDetailOpen && selectedTool?.id === item.id}
                    onOpenDetails={() =>
                      setToolDetail({
                        scope: transcriptScope,
                        itemId: item.id,
                        open: true,
                      })
                    }
                  />
                );
              }
              return (
                <div
                  key={item.id}
                  className={`${itemGapClass} ${CHAT_ITEM_PADDING_X}`}
                  data-transcript-item-kind={item.kind}
                >
                  {content}
                </div>
              );
            }}
          />
          {footer}
          {waitingForAgent ? (
            <div
              className={`${MOBILE_CHAT_ITEM_GAP} ${CHAT_ITEM_PADDING_X}`}
              data-mobile-agent-loading="true"
            >
              <MobileLoadingDots label={t("composerAccepted")} />
            </div>
          ) : null}
        </div>
      </div>
      {showScrollToBottom ? (
        <div className="absolute bottom-3 left-1/2 z-20 -translate-x-1/2">
          <ScrollToBottomButton
            label={t("transcript.scrollToBottom")}
            onClick={scrollToBottom}
          />
        </div>
      ) : null}
      {selectedTool ? (
        <MobileToolDetailModal
          key={`${transcriptScope}:${selectedTool.id}`}
          item={selectedTool}
          open={toolDetailOpen}
          onClose={() =>
            setToolDetail((current) =>
              current ? { ...current, open: false } : current
            )
          }
          onOpenFile={
            onOpenFile
              ? (target) => onOpenFile(selectedTool.id, target)
              : undefined
          }
        />
      ) : null}
    </div>
  );
}

ChatTranscript.displayName = "ChatTranscript";

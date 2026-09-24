import React from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import { useBeforeViewportLayoutMutation } from "@src/components/ViewportLayoutMutationContext";
import {
  BlockOutput,
  EVENT_BLOCK_TRANSPARENT_EXPANDED_SHELL_CLASSES,
  EventBlockHeader,
  EventBlockHeaderIcon,
  EventBlockHeaderTitle,
  SESSION_UI_TOKENS,
  getEventBlockContainerClasses,
} from "@src/engines/ChatPanel/blocks/primitives";
import { useBlockHeader } from "@src/engines/ChatPanel/blocks/useBlockLocate";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import { HugeiconsIcon, MailOpen01Icon } from "@src/icons";

import { extractGroupMessageContent } from "../GroupChatView/groupChatUtils";
import { agentOrgExecution } from "../agentOrgExecution";

const INBOX_TRANSCRIPT_ICON = (
  <HugeiconsIcon
    icon={MailOpen01Icon}
    data-icon="mail-open"
    size={SESSION_UI_TOKENS.ICON.SIZE_SM}
  />
);

function getInboxTranscriptBody(event: SessionEvent): string {
  return extractGroupMessageContent(event).trim();
}

export const InboxTranscriptCard: React.FC<{
  event: SessionEvent;
}> = ({ event }) => {
  const { t } = useTranslation("sessions");
  const beforeLayoutMutation = useBeforeViewportLayoutMutation();
  const body = getInboxTranscriptBody(event);
  const execution = agentOrgExecution(event);
  const unknown = t("agentOrgExecution.unknownSource");
  const senders =
    execution?.senders
      ?.map((sender) => `${sender.name ?? unknown} (${sender.count})`)
      .join(", ") || unknown;
  const recipient = execution?.participantName ?? unknown;
  const summary =
    execution?.inboxCount !== undefined
      ? t("agentOrgExecution.inboxSummary", {
          recipient,
          count: execution.inboxCount,
          senders,
        })
      : t("agentOrgExecution.legacyInbox");
  const hasContent = body.length > 0;
  const {
    isCollapsed,
    isHeaderHovered,
    handleHeaderClick,
    handleHeaderMouseEnter,
    handleHeaderMouseLeave,
  } = useBlockHeader({ defaultCollapsed: true, eventId: event.id });

  return (
    <div className={`${getEventBlockContainerClasses(false)} animate-fade-in`}>
      {/* Compound event header owns its icon/title geometry; Button owns disclosure semantics. */}
      <Button
        layout="custom"
        className="w-full text-left"
        disabled={!hasContent}
        aria-label={summary}
        aria-expanded={!isCollapsed}
        onClick={() => {
          beforeLayoutMutation?.();
          handleHeaderClick();
        }}
      >
        <EventBlockHeader
          isCollapsed={isCollapsed}
          withHover={false}
          onMouseEnter={handleHeaderMouseEnter}
          onMouseLeave={handleHeaderMouseLeave}
        >
          <EventBlockHeaderIcon
            icon={INBOX_TRANSCRIPT_ICON}
            isCollapsed={isCollapsed}
            isHeaderHovered={isHeaderHovered}
            iconSize={SESSION_UI_TOKENS.ICON.SIZE_SM}
            hasContent={hasContent}
          />
          <EventBlockHeaderTitle>{summary}</EventBlockHeaderTitle>
        </EventBlockHeader>
      </Button>

      {!isCollapsed && hasContent && (
        <div
          className={`${EVENT_BLOCK_TRANSPARENT_EXPANDED_SHELL_CLASSES} animate-fade-in`}
        >
          <div className="border-b border-border-1 px-3 py-1.5 text-[13px] leading-normal">
            <div className="flex min-w-0 items-baseline gap-2">
              <span className="shrink-0 text-text-3">
                {t("cards.agentMessage.meta.sender")}
              </span>
              <span className="min-w-0 flex-1 truncate text-text-1">
                {senders}
              </span>
            </div>
            <div className="flex min-w-0 items-baseline gap-2">
              <span className="shrink-0 text-text-3">
                {t("cards.agentMessage.meta.recipient")}
              </span>
              <span className="min-w-0 flex-1 truncate text-text-1">
                {recipient}
              </span>
            </div>
          </div>
          <BlockOutput
            output={body}
            withBorder={false}
            sessionId={event.sessionId}
            eventId={event.id}
          />
        </div>
      )}
    </div>
  );
};

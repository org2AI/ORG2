/** Read-only cloud notes. Mutation controls belong to the desktop comment surfaces. */
import React, { useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import { MarkdownContent } from "@src/components/MarkdownContent";
import { BotIcon, HugeiconsIcon, Tick01Icon } from "@src/icons";
import { formatRelativeTime } from "@src/util/time/formatRelativeTime";

import type {
  CloudCommentResolution,
  CloudSessionComment,
} from "../org2CloudCommentsClient";
import {
  getThreadResolution,
  isThreadResolved,
} from "../org2CloudSessionCommentsAtom";
import type { CommentThread } from "../org2CloudSessionCommentsAtom.types";
import { splitAgentMentionBody } from "./commentAgentAffordances";

const MemberMentionChip: React.FC<{ name: string; dataTestId?: string }> = ({
  name,
  dataTestId,
}) => (
  <span
    className="max-w-[160px] truncate rounded-full border border-primary-3 bg-primary-1 px-1.5 py-0.5 text-[10px] leading-none font-medium text-primary-7"
    data-testid={dataTestId}
  >
    @{name}
  </span>
);

const CommentRow = ({
  comment,
  isReply,
  resolution,
}: {
  comment: CloudSessionComment;
  isReply: boolean;
  resolution: CloudCommentResolution | null;
}) => {
  const { t } = useTranslation("navigation");
  const isTombstone = Boolean(comment.deletedAt);
  const agentMention = isReply ? null : splitAgentMentionBody(comment.body);
  const mentionedUserIds = comment.mentionedUserIds ?? [];
  return (
    <div
      className={`group/commentrow flex flex-col gap-1 ${isReply ? "ml-5" : ""}`}
      data-testid="session-comment-row"
    >
      <div className="flex items-center gap-1.5 text-[11px] leading-none">
        {comment.kind === "agent_report" ? (
          <span
            className="inline-flex max-w-[180px] items-center gap-1 truncate font-medium text-text-2"
            data-testid="comment-agent-affix"
          >
            <HugeiconsIcon
              icon={BotIcon}
              data-icon="bot"
              size={11}
              strokeWidth={2}
              className="shrink-0 text-text-3"
            />
            {t("cloud.comments.agentAuthor", {
              name: comment.authorDisplayName ?? comment.authorUserId,
            })}
          </span>
        ) : (
          <span className="max-w-[140px] truncate font-medium text-text-2">
            {comment.authorDisplayName ?? comment.authorUserId}
          </span>
        )}
        <span className="text-text-3">
          {formatRelativeTime(comment.createdAt, "short")}
        </span>
        {comment.editedAt && !isTombstone && (
          <span className="text-text-3">
            ({t("cloud.comments.editedMarker")})
          </span>
        )}
        {!isReply && resolution === "resolved" && (
          <span
            className="inline-flex items-center gap-0.5 text-success-6"
            data-testid="session-comment-resolved-marker"
          >
            <HugeiconsIcon
              icon={Tick01Icon}
              data-icon="check"
              size={10}
              strokeWidth={2.5}
            />
            {t("cloud.comments.resolved")}
          </span>
        )}
        {!isReply && resolution === "wont_fix" && (
          <span
            className="inline-flex items-center gap-0.5 text-text-3"
            data-testid="session-comment-wontfix-marker"
          >
            {t("cloud.comments.wontFix")}
          </span>
        )}
      </div>
      {isTombstone ? (
        <div className="text-[12px] text-text-3 italic">
          {t("cloud.comments.deletedComment")}
        </div>
      ) : (
        <>
          {mentionedUserIds.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {mentionedUserIds.map((member) => (
                <MemberMentionChip
                  key={member}
                  name={member}
                  dataTestId="comment-member-mention-pill"
                />
              ))}
            </div>
          ) : null}
          {agentMention ? (
            <span
              className="inline-flex w-fit items-center gap-1 rounded-full border border-primary-3 bg-primary-1 px-1.5 py-0.5 text-[10px] leading-none font-medium text-primary-7"
              data-testid="comment-agent-mention-pill"
              aria-label={agentMention.mention}
            >
              <HugeiconsIcon
                icon={BotIcon}
                data-icon="bot"
                size={10}
                strokeWidth={2.25}
                aria-hidden="true"
              />
              {agentMention.mention}
            </span>
          ) : null}
          <MarkdownContent
            body={agentMention?.brief ?? comment.body}
            clamped={false}
            className="text-[12px] break-words"
          />
        </>
      )}
    </div>
  );
};

function ThreadBlock({ thread }: { thread: CommentThread }) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border-1 bg-bg-2 px-2.5 py-2">
      <CommentRow
        comment={thread.top}
        isReply={false}
        resolution={getThreadResolution(thread)}
      />
      {thread.replies.map((reply) => (
        <CommentRow key={reply.id} comment={reply} isReply resolution={null} />
      ))}
    </div>
  );
}

export default function CommentThreadList({
  threads,
  emptyLabel,
}: {
  threads: CommentThread[];
  emptyLabel?: string;
}) {
  const { t } = useTranslation("navigation");
  const [showResolved, setShowResolved] = useState(false);
  const openThreads = threads.filter((thread) => !isThreadResolved(thread));
  const resolvedThreads = threads.filter(isThreadResolved);
  return (
    <div className="flex flex-col gap-2">
      {threads.length === 0 && emptyLabel && (
        <div className="text-[12px] text-text-3">{emptyLabel}</div>
      )}
      {openThreads.map((thread) => (
        <ThreadBlock key={thread.top.id} thread={thread} />
      ))}
      {resolvedThreads.length > 0 && (
        <Button
          variant="ghost"
          size="inline"
          className="self-start"
          data-testid="session-comment-resolved-toggle"
          aria-expanded={showResolved}
          onClick={() => setShowResolved((current) => !current)}
        >
          {t("cloud.comments.resolvedToggle", {
            count: resolvedThreads.length,
          })}
        </Button>
      )}
      {showResolved &&
        resolvedThreads.map((thread) => (
          <ThreadBlock key={thread.top.id} thread={thread} />
        ))}
    </div>
  );
}

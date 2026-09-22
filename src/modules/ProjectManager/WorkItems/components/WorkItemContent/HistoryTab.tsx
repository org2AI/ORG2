import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import type { MarkdownEditorMode } from "@src/components/MarkdownTextareaEditor";
import PersonAvatar from "@src/components/PersonAvatar";
import { ScrollTrailTarget } from "@src/components/layout/blocks";
import { COMPOSER_BOTTOM_DOCK_PADDING_CLASS } from "@src/config/composerStackTokens";
import { DETAIL_PANEL_TOKENS } from "@src/config/detailPanelTokens";
import {
  ArrowRight01Icon,
  HugeiconsIcon,
  Notification01Icon,
  NotificationOff01Icon,
} from "@src/icons";

import DiscussionThreads from "./DiscussionThreads";
import HistoryTabComposer from "./HistoryTabComposer";
import { WorkItemActivityTimeline } from "./WorkItemActivityTimeline";
import { partitionDiscussionTimeline } from "./discussionTimelineModel";
import type { HistoryTabProps } from "./types";

const HistoryTab: React.FC<HistoryTabProps> = ({
  timelineEntries,
  currentUser,
  isSubscribed,
  onToggleSubscribe,
  commentText,
  onCommentTextChange,
  mentionRefs = [],
  onMentionRefsChange = () => undefined,
  teamMembers = [],
  agents = [],
  agentOrgs = [],
  onCommentSubmit,
  isSubmittingComment,
  comments = [],
  replyToCommentId,
  onReplyToComment,
  onResolveThread,
  onReopenThread,
  onEditComment,
  onDeleteComment,
  presentation = "default",
  canComment = true,
  threadNavigation,
  triggerPreview,
}) => {
  const { t } = useTranslation("projects");
  const [editorMode, setEditorMode] = useState<MarkdownEditorMode>("write");
  const isThread = presentation === "thread";
  const { discussionEntries, activityEntries } = useMemo(
    () => partitionDiscussionTimeline(timelineEntries),
    [timelineEntries]
  );

  const subscriptionControl = (
    <Button
      variant="tertiary"
      size="mini"
      icon={
        isSubscribed ? (
          <HugeiconsIcon
            icon={NotificationOff01Icon}
            data-icon="bell-off"
            size={13}
            aria-hidden
          />
        ) : (
          <HugeiconsIcon
            icon={Notification01Icon}
            data-icon="bell"
            size={13}
            aria-hidden
          />
        )
      }
      onClick={onToggleSubscribe}
      data-testid="work-item-subscription-toggle"
    >
      {isSubscribed
        ? t("workItems.activity.unsubscribe")
        : t("workItems.activity.subscribe")}
    </Button>
  );

  const timeline = (
    <WorkItemActivityTimeline
      entries={timelineEntries}
      currentUser={currentUser}
      compact={isThread}
      navigationEnabled={isThread}
    />
  );
  const discussionTimeline = (
    <WorkItemActivityTimeline
      entries={discussionEntries}
      currentUser={currentUser}
      compact
      navigationEnabled={isThread}
    />
  );
  const discussionThreads =
    comments.length > 0 ? (
      <DiscussionThreads
        comments={comments}
        currentUser={currentUser}
        teamMembers={teamMembers}
        onReply={onReplyToComment}
        onResolve={onResolveThread}
        onReopen={onReopenThread}
        onEdit={onEditComment}
        onDelete={onDeleteComment}
      />
    ) : null;
  const activityTimeline = (
    <WorkItemActivityTimeline
      entries={activityEntries}
      currentUser={currentUser}
      compact
    />
  );

  const composer = (
    <HistoryTabComposer
      isThread={isThread}
      currentUser={currentUser}
      commentText={commentText}
      onCommentTextChange={onCommentTextChange}
      onCommentSubmit={onCommentSubmit}
      isSubmittingComment={isSubmittingComment}
      editorMode={editorMode}
      onEditorModeChange={setEditorMode}
      mentionRefs={mentionRefs}
      onMentionRefsChange={onMentionRefsChange}
      teamMembers={teamMembers}
      agents={agents}
      agentOrgs={agentOrgs}
      replyToCommentId={replyToCommentId}
      onReplyToComment={onReplyToComment}
      triggerPreview={triggerPreview}
    />
  );

  if (isThread) {
    return (
      <section
        className="flex min-w-0 flex-col gap-3"
        data-testid="work-item-thread-discussion"
        aria-label={t("workItems.activity.discussionTitle")}
      >
        <div className="flex min-h-8 items-center justify-between gap-3 border-b border-border-1 pb-2">
          {threadNavigation}
          {subscriptionControl}
        </div>
        {comments.length > 0 ? (
          discussionThreads
        ) : discussionEntries.length > 0 ? (
          discussionTimeline
        ) : (
          <div
            className="rounded-xl border border-dashed border-border-1 px-4 py-8 text-center text-[13px] text-text-3"
            data-testid="work-item-thread-discussion-empty"
          >
            {t("workItems.activity.noComments")}
          </div>
        )}
        {activityEntries.length > 0 ? (
          <ScrollTrailTarget label={t("workItems.activity.activityHistory")}>
            <details
              className="group overflow-hidden rounded-xl border border-border-1 bg-bg-2"
              data-testid="work-item-thread-activity-history"
            >
              <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 px-3 text-[12px] font-medium text-text-2 marker:hidden [&::-webkit-details-marker]:hidden">
                <span className="min-w-0 flex-1">
                  {t("workItems.activity.activityHistory")}
                </span>
                <span className="shrink-0 font-normal text-text-4 tabular-nums">
                  {t("workItems.activity.activityHistoryCount", {
                    count: activityEntries.length,
                  })}
                </span>
                <HugeiconsIcon
                  icon={ArrowRight01Icon}
                  data-icon="chevron-right"
                  size={14}
                  aria-hidden
                  className="shrink-0 text-text-4 transition-transform group-open:rotate-90"
                />
              </summary>
              <div className="border-t border-border-1 p-2">
                {activityTimeline}
              </div>
            </details>
          </ScrollTrailTarget>
        ) : null}
        {canComment ? (
          <ScrollTrailTarget label={t("workItems.activity.commentPlaceholder")}>
            <div
              className={`sticky bottom-0 z-10 bg-transparent pt-2 ${COMPOSER_BOTTOM_DOCK_PADDING_CLASS}`}
              data-testid="work-item-thread-comment-dock"
            >
              {composer}
            </div>
          </ScrollTrailTarget>
        ) : null}
      </section>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <div
        className={`${DETAIL_PANEL_TOKENS.sectionGap} flex items-center justify-between`}
      >
        <div className="flex items-center gap-3">
          {subscriptionControl}
          <PersonAvatar
            size={24}
            name={currentUser.name}
            src={currentUser.avatar}
            color={currentUser.color}
          />
        </div>
      </div>

      {timeline}
      {canComment ? composer : null}
    </div>
  );
};

export default HistoryTab;

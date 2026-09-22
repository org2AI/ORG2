import React from "react";

import type { Person } from "@src/types/core/shared";
import type { WorkItem } from "@src/types/core/workItem";

import { WorkItemThreadViewAction } from "../WorkItemThread";
import HistoryTab from "./HistoryTab";
import type { useWorkItemContentModel } from "./hooks/useWorkItemContentModel";
import type { useWorkItemContentState } from "./hooks/useWorkItemContentState";
import type { WorkItemContentPresentation } from "./presentation";
import type { HistoryTabProps } from "./types";
import type { MentionCandidate } from "./workItemMentions";

type WorkItemContentState = ReturnType<typeof useWorkItemContentState>;
type WorkItemContentModel = ReturnType<typeof useWorkItemContentModel>;

interface WorkItemContentHistoryProps extends Pick<
  HistoryTabProps,
  "onToggleSubscribe" | "onCommentSubmit" | "onResolveThread" | "onReopenThread"
> {
  workItem: WorkItem;
  presentation: WorkItemContentPresentation;
  /** Comment draft, subscription and discussion state from `useWorkItemContentState`. */
  contentState: WorkItemContentState;
  agents: MentionCandidate[];
  agentOrgs: MentionCandidate[];
  teamMembers: Person[];
  canComment: boolean;
  isThread: boolean;
  activeThreadView: WorkItemContentModel["activeThreadView"];
  setThreadViewSelection: WorkItemContentModel["setThreadViewSelection"];
}

/**
 * The Discussion / History tab of a Work Item: the activity timeline with its
 * comment composer, plus the back-to-overview action in thread presentation.
 */
const WorkItemContentHistory: React.FC<WorkItemContentHistoryProps> = ({
  workItem,
  presentation,
  contentState,
  agents,
  agentOrgs,
  teamMembers,
  canComment,
  isThread,
  activeThreadView,
  setThreadViewSelection,
  onToggleSubscribe,
  onCommentSubmit,
  onResolveThread,
  onReopenThread,
}) => {
  const {
    timelineEntries,
    currentUser,
    isSubscribed,
    commentText,
    setCommentText,
    mentionRefs,
    setMentionRefs,
    isSubmittingComment,
    replyToCommentId,
    setReplyToCommentId,
    handleEditDiscussionComment,
    handleDeleteDiscussionComment,
    triggerPreview,
  } = contentState;

  return (
    <HistoryTab
      key={workItem.session_id}
      timelineEntries={timelineEntries}
      currentUser={currentUser}
      isSubscribed={isSubscribed}
      onToggleSubscribe={onToggleSubscribe}
      commentText={commentText}
      onCommentTextChange={setCommentText}
      mentionRefs={mentionRefs}
      onMentionRefsChange={setMentionRefs}
      agents={agents}
      agentOrgs={agentOrgs}
      teamMembers={teamMembers}
      onCommentSubmit={onCommentSubmit}
      isSubmittingComment={isSubmittingComment}
      comments={workItem.comments ?? []}
      replyToCommentId={replyToCommentId}
      onReplyToComment={setReplyToCommentId}
      onResolveThread={onResolveThread}
      onReopenThread={onReopenThread}
      onEditComment={handleEditDiscussionComment}
      onDeleteComment={handleDeleteDiscussionComment}
      presentation={presentation}
      canComment={canComment}
      triggerPreview={triggerPreview}
      threadNavigation={
        isThread && activeThreadView === "discussion" ? (
          <WorkItemThreadViewAction
            activeView="discussion"
            onChange={(view) =>
              setThreadViewSelection({
                workItemId: workItem.session_id,
                view,
              })
            }
          />
        ) : undefined
      }
    />
  );
};

export default WorkItemContentHistory;

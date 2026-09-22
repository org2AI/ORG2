import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

import { useCurrentUserMemberIds } from "@src/hooks/project/useCurrentUserMemberId";
import type { Person } from "@src/types/core/shared";
import type { WorkItem as WorkItemExtended } from "@src/types/core/workItem";

import { useWorkItemTimeline } from "../useWorkItemTimeline";
import type { MentionCandidate } from "../workItemMentions";
import { useWorkItemCommentRevisionConflict } from "./useWorkItemCommentRevisionConflict";
import { useWorkItemDescriptionState } from "./useWorkItemDescriptionState";
import { useWorkItemDiscussionActions } from "./useWorkItemDiscussionActions";
import { useWorkItemDiscussionComposer } from "./useWorkItemDiscussionComposer";
import { useWorkItemSessionTabs } from "./useWorkItemSessionTabs";

export type { CommentRevisionConflictState } from "./useWorkItemCommentRevisionConflict";

interface UseWorkItemContentStateOptions {
  workItem: WorkItemExtended;
  onUpdateWorkItem?: (updates: Partial<WorkItemExtended>) => void;
  onUpdateWorkItemImmediate?: (updates: Partial<WorkItemExtended>) => void;
  currentUserProp?: Person;
  teamMembers?: Person[];
  availableAgents?: MentionCandidate[];
  availableOrgs?: MentionCandidate[];
  projectSlug?: string | null;
  shortId?: string | null;
  orgId?: string | null;
  onRefreshWorkflow?: () => void | Promise<void>;
}

export function useWorkItemContentState(
  options: UseWorkItemContentStateOptions
) {
  const {
    workItem,
    onUpdateWorkItem,
    currentUserProp,
    teamMembers = [],
    availableAgents = [],
    availableOrgs = [],
    projectSlug,
    shortId,
    orgId,
    onRefreshWorkflow,
  } = options;

  const { t } = useTranslation("projects");
  const {
    currentUser: resolvedCurrentUser,
    memberIds: resolvedCurrentUserMemberIds,
  } = useCurrentUserMemberIds(teamMembers);

  const currentUser = useMemo(
    () =>
      currentUserProp ??
      resolvedCurrentUser ?? {
        id: "system",
        name: t("workItems.activity.system"),
        color: "var(--color-fill-3)",
      },
    [currentUserProp, resolvedCurrentUser, t]
  );
  // eslint-disable-next-line react-hooks/preserve-manual-memoization -- deps key on currentUserProp?.id on purpose: a new prop object with the same id keeps the Set identity
  const currentUserMemberIds = useMemo(() => {
    const ids = new Set(resolvedCurrentUserMemberIds);
    if (currentUserProp?.id) ids.add(currentUserProp.id);
    return ids;
  }, [currentUserProp?.id, resolvedCurrentUserMemberIds]);

  const {
    activeSessionTab,
    setActiveSessionTab,
    currentPhase,
    isAgentRunning,
    sessionTabItems,
  } = useWorkItemSessionTabs({ workItem, t });

  const scopedShortId = shortId ?? workItem.shortId ?? "";

  const {
    commentText,
    setCommentText,
    replyToCommentId,
    setReplyToCommentId,
    mentionRefs,
    setMentionRefs,
    isSubscribed,
    handleToggleSubscription,
    isSubmittingComment,
    triggerPreview,
    handleCommentSubmit,
  } = useWorkItemDiscussionComposer({
    scopedShortId,
    projectSlug,
    orgId,
    currentUser,
    teamMembers,
    availableAgents,
    availableOrgs,
    onRefreshWorkflow,
  });

  // --- Description editor ---

  const { rawDescription, resolvedDescription, handleDescriptionChange } =
    useWorkItemDescriptionState({ workItem, onUpdateWorkItem, projectSlug });

  // --- Timeline ---

  const timelineMembers = useMemo(
    () =>
      currentUser
        ? [
            ...teamMembers.filter((member) => member.id !== currentUser.id),
            currentUser,
          ]
        : teamMembers,
    [currentUser, teamMembers]
  );
  const { timelineEntries } = useWorkItemTimeline({
    workItem,
    teamMembers: timelineMembers,
  });

  // --- Handlers ---

  const handleTitleChange = useCallback(
    (title: string) => {
      if (title === workItem.name) return;
      onUpdateWorkItem?.({ name: title });
    },
    [onUpdateWorkItem, workItem.name]
  );

  const {
    handleResolveDiscussionThread,
    handleReopenDiscussionThread,
    handleDeleteDiscussionComment,
  } = useWorkItemDiscussionActions({
    scopedShortId,
    projectSlug,
    orgId,
    currentUser,
    onRefreshWorkflow,
    t,
  });

  const {
    handleEditDiscussionComment,
    commentRevisionConflict,
    handleUseLatestComment,
    handleKeepMineComment,
  } = useWorkItemCommentRevisionConflict({
    scopedShortId,
    projectSlug,
    orgId,
    currentUser,
    onRefreshWorkflow,
    t,
  });

  return {
    currentUser,
    currentUserMemberIds,
    activeSessionTab,
    setActiveSessionTab,
    commentText,
    setCommentText,
    replyToCommentId,
    setReplyToCommentId,
    mentionRefs,
    setMentionRefs,
    isSubscribed,
    handleToggleSubscription,
    isSubmittingComment,
    triggerPreview,
    currentPhase,
    isAgentRunning,
    sessionTabItems,
    resolvedDescription,
    rawDescription,
    timelineEntries,
    handleTitleChange,
    handleDescriptionChange,
    handleCommentSubmit,
    handleResolveDiscussionThread,
    handleReopenDiscussionThread,
    handleEditDiscussionComment,
    handleDeleteDiscussionComment,
    commentRevisionConflict,
    handleUseLatestComment,
    handleKeepMineComment,
  };
}

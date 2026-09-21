import { useCallback, useEffect, useState } from "react";

import { projectApi } from "@src/api/http/project";
import { createLogger } from "@src/hooks/logger";
import type { Person } from "@src/types/core/shared";

import {
  type MentionCandidate,
  mentionedMemberIds,
  normalizeWorkItemMentions,
} from "../workItemMentions";
import { useWorkItemDiscussionTriggerPreview } from "./useWorkItemDiscussionTriggerPreview";

const logger = createLogger("useWorkItemContentState");

interface UseWorkItemDiscussionComposerOptions {
  scopedShortId: string;
  projectSlug?: string | null;
  orgId?: string | null;
  currentUser: Person;
  teamMembers: Person[];
  availableAgents: MentionCandidate[];
  availableOrgs: MentionCandidate[];
  onRefreshWorkflow?: () => void | Promise<void>;
}

/**
 * Discussion composer for a Work Item: the draft comment with its mentions and
 * reply target, its trigger preview, the viewer's subscription, and the
 * submit / subscription-toggle actions.
 */
export function useWorkItemDiscussionComposer({
  scopedShortId,
  projectSlug,
  orgId,
  currentUser,
  teamMembers,
  availableAgents,
  availableOrgs,
  onRefreshWorkflow,
}: UseWorkItemDiscussionComposerOptions) {
  const [commentText, setCommentText] = useState("");
  const [replyToCommentId, setReplyToCommentId] = useState<string | null>(null);
  const [mentionRefs, setMentionRefs] = useState<string[]>([]);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);

  const triggerPreview = useWorkItemDiscussionTriggerPreview({
    commentText,
    replyToCommentId,
    mentionRefs,
    scopedShortId,
    projectSlug,
    orgId,
    currentUser,
    teamMembers,
    availableAgents,
    availableOrgs,
  });

  useEffect(() => {
    if (!scopedShortId || !currentUser.id) return;
    let cancelled = false;
    projectApi
      .listWorkItemSubscriptions({
        projectSlug: projectSlug ?? null,
        orgId: orgId || "personal-org",
        workItemId: scopedShortId,
      })
      .then((subscriptions) => {
        if (!cancelled) {
          setIsSubscribed(
            subscriptions.some(
              (subscription) =>
                subscription.subscriberId === currentUser.id &&
                !subscription.mutedAt
            )
          );
        }
      })
      .catch((error) =>
        logger.warn("Failed to read Work Item subscriptions", error)
      );
    return () => {
      cancelled = true;
    };
  }, [currentUser.id, orgId, projectSlug, scopedShortId]);

  const handleCommentSubmit = useCallback(async () => {
    if (!scopedShortId || !commentText.trim() || isSubmittingComment) return;

    setIsSubmittingComment(true);
    try {
      const mentions = normalizeWorkItemMentions(mentionRefs, {
        members: teamMembers,
        agents: availableAgents,
        agentOrgs: availableOrgs,
        currentUserId: currentUser.id,
      });
      const result = await projectApi.postDiscussionComment({
        projectSlug: projectSlug ?? null,
        orgId: orgId || "personal-org",
        workItemId: scopedShortId,
        commentId: `cmt-${Date.now()}-${crypto.randomUUID()}`,
        authorId: currentUser.id,
        authorName: currentUser.name ?? currentUser.id,
        content: commentText.trim(),
        mentionedUserIds: mentionedMemberIds(mentions),
        mentions,
        parentId: replyToCommentId,
      });
      setIsSubscribed(true);
      setCommentText("");
      setReplyToCommentId(null);
      setMentionRefs([]);
      logger.debug(
        `Persisted Discussion comment ${result.comment.id} (${result.wakeReason})`
      );
      await onRefreshWorkflow?.();
    } catch (err) {
      logger.error("Failed to create comment", err);
    } finally {
      setIsSubmittingComment(false);
    }
  }, [
    commentText,
    isSubmittingComment,
    scopedShortId,
    currentUser.id,
    currentUser.name,
    mentionRefs,
    teamMembers,
    availableAgents,
    availableOrgs,
    orgId,
    onRefreshWorkflow,
    projectSlug,
    replyToCommentId,
  ]);

  const handleToggleSubscription = useCallback(async () => {
    if (!scopedShortId || !currentUser.id) return;
    const next = !isSubscribed;
    try {
      const subscriptions = await projectApi.setWorkItemSubscribed(
        {
          projectSlug: projectSlug ?? null,
          orgId: orgId || "personal-org",
          workItemId: scopedShortId,
        },
        currentUser.id,
        next
      );
      setIsSubscribed(
        subscriptions.some(
          (subscription) =>
            subscription.subscriberId === currentUser.id &&
            !subscription.mutedAt
        )
      );
    } catch (error) {
      logger.error("Failed to update Work Item subscription", error);
    }
  }, [currentUser.id, isSubscribed, orgId, projectSlug, scopedShortId]);

  return {
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
  };
}

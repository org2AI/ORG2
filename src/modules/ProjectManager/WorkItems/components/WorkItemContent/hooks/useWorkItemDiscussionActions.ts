import type { TFunction } from "i18next";
import { useCallback } from "react";

import { parseRevisionConflict, projectApi } from "@src/api/http/project";
import Message from "@src/components/Message";
import { createLogger } from "@src/hooks/logger";
import type { Person } from "@src/types/core/shared";

const logger = createLogger("useWorkItemContentState");

interface UseWorkItemDiscussionActionsOptions {
  scopedShortId: string;
  projectSlug?: string | null;
  orgId?: string | null;
  currentUser: Person;
  onRefreshWorkflow?: () => void | Promise<void>;
  t: TFunction<"projects">;
}

/**
 * Discussion thread and comment mutations that only refresh the workflow
 * afterwards: resolve / reopen a thread and delete a comment.
 */
export function useWorkItemDiscussionActions({
  scopedShortId,
  projectSlug,
  orgId,
  currentUser,
  onRefreshWorkflow,
  t,
}: UseWorkItemDiscussionActionsOptions) {
  const handleResolveDiscussionThread = useCallback(
    async (threadId: string, conclusionCommentId?: string) => {
      if (!scopedShortId || !currentUser.id) return;
      try {
        await projectApi.resolveDiscussionThread({
          scope: {
            projectSlug: projectSlug ?? null,
            orgId: orgId || "personal-org",
            workItemId: scopedShortId,
          },
          threadId,
          actorId: currentUser.id,
          conclusionCommentId: conclusionCommentId ?? null,
        });
        await onRefreshWorkflow?.();
      } catch (error) {
        logger.error("Failed to resolve Discussion thread", error);
      }
    },
    [currentUser.id, onRefreshWorkflow, orgId, projectSlug, scopedShortId]
  );

  const handleReopenDiscussionThread = useCallback(
    async (threadId: string) => {
      if (!scopedShortId || !currentUser.id) return;
      try {
        await projectApi.reopenDiscussionThread({
          scope: {
            projectSlug: projectSlug ?? null,
            orgId: orgId || "personal-org",
            workItemId: scopedShortId,
          },
          threadId,
          actorId: currentUser.id,
        });
        await onRefreshWorkflow?.();
      } catch (error) {
        logger.error("Failed to reopen Discussion thread", error);
      }
    },
    [currentUser.id, onRefreshWorkflow, orgId, projectSlug, scopedShortId]
  );

  const handleDeleteDiscussionComment = useCallback(
    async (commentId: string, expectedRevision: number) => {
      if (!scopedShortId || !currentUser.id) return;
      try {
        await projectApi.deleteDiscussionComment({
          scope: {
            projectSlug: projectSlug ?? null,
            orgId: orgId || "personal-org",
            workItemId: scopedShortId,
          },
          commentId,
          actorId: currentUser.id,
          expectedRevision,
        });
        await onRefreshWorkflow?.();
      } catch (error) {
        if (parseRevisionConflict(error)) {
          await onRefreshWorkflow?.();
          Message.warning(t("workItems.revisionConflict.reloadNotice"), 5000);
          return;
        }
        logger.error("Failed to delete Discussion comment", error);
        Message.error(String(error));
      }
    },
    [currentUser.id, onRefreshWorkflow, orgId, projectSlug, scopedShortId, t]
  );

  return {
    handleResolveDiscussionThread,
    handleReopenDiscussionThread,
    handleDeleteDiscussionComment,
  };
}

import type { TFunction } from "i18next";
import { useCallback, useState } from "react";

import { parseRevisionConflict, projectApi } from "@src/api/http/project";
import Message from "@src/components/Message";
import { createLogger } from "@src/hooks/logger";
import type { Person } from "@src/types/core/shared";
import type { WorkItemComment } from "@src/types/core/workItem";

const logger = createLogger("useWorkItemContentState");

export interface CommentRevisionConflictState {
  commentId: string;
  mine: string;
  latest: string;
  expectedRevision: number;
  actualRevision: number;
}

interface UseWorkItemCommentRevisionConflictOptions {
  scopedShortId: string;
  projectSlug?: string | null;
  orgId?: string | null;
  currentUser: Person;
  onRefreshWorkflow?: () => void | Promise<void>;
  t: TFunction<"projects">;
}

/**
 * Revision-checked Discussion comment edits: the edit action, the conflict
 * it opens when the comment changed underneath, and the use-latest /
 * keep-mine resolutions of that conflict.
 */
export function useWorkItemCommentRevisionConflict({
  scopedShortId,
  projectSlug,
  orgId,
  currentUser,
  onRefreshWorkflow,
  t,
}: UseWorkItemCommentRevisionConflictOptions) {
  const [commentRevisionConflict, setCommentRevisionConflict] =
    useState<CommentRevisionConflictState | null>(null);

  const readLatestComment = useCallback(
    async (commentId: string): Promise<WorkItemComment | null> => {
      if (!scopedShortId) return null;
      if (projectSlug) {
        const latest = await projectApi.readWorkItemEnriched(
          projectSlug,
          scopedShortId,
          orgId ? { orgId } : undefined
        );
        return (
          (latest.comments as WorkItemComment[]).find(
            (comment) => comment.id === commentId
          ) ?? null
        );
      }
      const latest = await projectApi.readStandaloneWorkItem(
        scopedShortId,
        orgId ? { orgId } : undefined
      );
      return (
        (latest.frontmatter.comments as WorkItemComment[]).find(
          (comment) => comment.id === commentId
        ) ?? null
      );
    },
    [orgId, projectSlug, scopedShortId]
  );

  const handleEditDiscussionComment = useCallback(
    async (
      commentId: string,
      content: string,
      expectedRevision: number
    ): Promise<"saved" | "conflict" | "error"> => {
      if (!scopedShortId || !currentUser.id || !content.trim()) return "error";
      const mine = content.trim();
      try {
        await projectApi.editDiscussionComment({
          scope: {
            projectSlug: projectSlug ?? null,
            orgId: orgId || "personal-org",
            workItemId: scopedShortId,
          },
          commentId,
          actorId: currentUser.id,
          content: mine,
          expectedRevision,
        });
        await onRefreshWorkflow?.();
        return "saved";
      } catch (error) {
        const details = parseRevisionConflict(error);
        if (details) {
          const latest = await readLatestComment(commentId).catch(
            (readError) => {
              logger.error(
                "Failed to reload conflicted Discussion comment",
                readError
              );
              return null;
            }
          );
          if (latest && !latest.deleted_at) {
            setCommentRevisionConflict({
              commentId,
              mine,
              latest: latest.content,
              expectedRevision: details.expected,
              actualRevision: latest.revision ?? details.actual,
            });
          } else {
            Message.warning(t("workItems.revisionConflict.reloadNotice"), 5000);
          }
          await onRefreshWorkflow?.();
          return "conflict";
        }
        logger.error("Failed to edit Discussion comment", error);
        Message.error(String(error));
        return "error";
      }
    },
    [
      currentUser.id,
      onRefreshWorkflow,
      orgId,
      projectSlug,
      readLatestComment,
      scopedShortId,
      t,
    ]
  );

  const handleUseLatestComment = useCallback(() => {
    setCommentRevisionConflict(null);
    void onRefreshWorkflow?.();
  }, [onRefreshWorkflow]);

  const handleKeepMineComment = useCallback(async () => {
    const conflict = commentRevisionConflict;
    if (!conflict || !scopedShortId || !currentUser.id) return;
    try {
      await projectApi.editDiscussionComment({
        scope: {
          projectSlug: projectSlug ?? null,
          orgId: orgId || "personal-org",
          workItemId: scopedShortId,
        },
        commentId: conflict.commentId,
        actorId: currentUser.id,
        content: conflict.mine,
        expectedRevision: conflict.actualRevision,
      });
      setCommentRevisionConflict(null);
      await onRefreshWorkflow?.();
    } catch (error) {
      const details = parseRevisionConflict(error);
      if (details) {
        const latest = await readLatestComment(conflict.commentId).catch(
          (readError) => {
            logger.error(
              "Failed to reload conflicted Discussion comment",
              readError
            );
            return null;
          }
        );
        if (latest && !latest.deleted_at) {
          setCommentRevisionConflict({
            ...conflict,
            latest: latest.content,
            expectedRevision: details.expected,
            actualRevision: latest.revision ?? details.actual,
          });
          await onRefreshWorkflow?.();
          Message.warning(t("workItems.revisionConflict.retryFailed"), 5000);
          return;
        }
        setCommentRevisionConflict(null);
        await onRefreshWorkflow?.();
        Message.warning(t("workItems.revisionConflict.reloadNotice"), 5000);
        return;
      }
      logger.error("Failed to retry Discussion comment edit", error);
      Message.error(String(error));
    }
  }, [
    commentRevisionConflict,
    currentUser.id,
    onRefreshWorkflow,
    orgId,
    projectSlug,
    readLatestComment,
    scopedShortId,
    t,
  ]);

  return {
    handleEditDiscussionComment,
    commentRevisionConflict,
    handleUseLatestComment,
    handleKeepMineComment,
  };
}

import React, { useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import PersonAvatar from "@src/components/PersonAvatar";
import Textarea from "@src/components/Textarea";
import { MarkdownContent } from "@src/features/GitHubWork/ActivityTimeline";
import {
  CheckmarkCircle01Icon,
  CornerUpLeftIcon,
  Delete02Icon,
  Edit02Icon,
  HugeiconsIcon,
  RotateLeft01Icon,
} from "@src/icons";
import type { Person } from "@src/types/core/shared";
import type { WorkItemComment } from "@src/types/core/workItem";
import { confirmDestructiveAction } from "@src/util/dialogs/confirmDestructiveAction";

interface DiscussionThreadsProps {
  comments: WorkItemComment[];
  currentUser: Person;
  teamMembers: Person[];
  onReply?: (commentId: string | null) => void;
  onResolve?: (threadId: string, conclusionCommentId?: string) => void;
  onReopen?: (threadId: string) => void;
  onEdit?: (
    commentId: string,
    content: string,
    expectedRevision: number
  ) => Promise<"saved" | "conflict" | "error">;
  onDelete?: (
    commentId: string,
    expectedRevision: number
  ) => void | Promise<void>;
}

function commentAuthor(
  comment: WorkItemComment,
  currentUser: Person,
  teamMembers: Person[]
): Person {
  return (
    teamMembers.find((member) => member.id === comment.author) ??
    (currentUser.id === comment.author
      ? currentUser
      : { id: comment.author, name: comment.author })
  );
}

const DiscussionThreads: React.FC<DiscussionThreadsProps> = ({
  comments,
  currentUser,
  teamMembers,
  onReply,
  onResolve,
  onReopen,
  onEdit,
  onDelete,
}) => {
  const { t } = useTranslation("projects");
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const roots = comments.filter((comment) => !comment.parent_id);

  const handleDelete = async (comment: WorkItemComment) => {
    const confirmed = await confirmDestructiveAction({
      title: t("workItems.activity.deleteComment", {
        defaultValue: "Delete comment",
      }),
      message: t("workItems.activity.deleteCommentConfirm", {
        defaultValue:
          "Delete this comment? Replies stay, the comment body is removed.",
      }),
      okLabel: t("common:actions.delete", { defaultValue: "Delete" }),
      cancelLabel: t("common:actions.cancel", { defaultValue: "Cancel" }),
    });
    if (confirmed) {
      await onDelete?.(comment.id, comment.revision ?? 0);
    }
  };

  return (
    <div
      className="flex flex-col gap-3"
      data-testid="work-item-discussion-threads"
    >
      {roots.map((root) => {
        const threadId = root.thread_id || root.id;
        const replies = comments.filter(
          (comment) => comment.id !== root.id && comment.thread_id === threadId
        );
        const conclusionId = replies.at(-1)?.id ?? root.id;
        const threadComments = [root, ...replies];
        return (
          <article
            key={root.id}
            className="overflow-hidden rounded-xl border border-border-1 bg-bg-2"
            data-testid={`work-item-discussion-thread-${threadId}`}
          >
            <div className="flex items-center justify-between gap-3 border-b border-border-1 px-3 py-2">
              <div className="flex min-w-0 items-center gap-2 text-xs text-text-3">
                <span>
                  {t("workItems.activity.messageCount", {
                    defaultValue: `${replies.length + 1} messages`,
                    count: replies.length + 1,
                  })}
                </span>
                {root.resolved_at ? (
                  <span className="inline-flex items-center gap-1 text-success-6">
                    <HugeiconsIcon
                      icon={CheckmarkCircle01Icon}
                      data-icon="check-circle-2"
                      size={12}
                      aria-hidden
                    />
                    {t("workItems.activity.resolved", {
                      defaultValue: "Resolved",
                    })}
                  </span>
                ) : null}
              </div>
              {(root.resolved_at && onReopen) ||
              (!root.resolved_at && onResolve) ? (
                <Button
                  variant="tertiary"
                  size="mini"
                  icon={
                    root.resolved_at ? (
                      <HugeiconsIcon
                        icon={RotateLeft01Icon}
                        data-icon="rotate-ccw"
                        size={13}
                        aria-hidden
                      />
                    ) : (
                      <HugeiconsIcon
                        icon={CheckmarkCircle01Icon}
                        data-icon="check-circle-2"
                        size={13}
                        aria-hidden
                      />
                    )
                  }
                  onClick={() =>
                    root.resolved_at
                      ? onReopen?.(threadId)
                      : onResolve?.(threadId, conclusionId)
                  }
                  data-testid={`work-item-discussion-${root.resolved_at ? "reopen" : "resolve"}-${threadId}`}
                >
                  {root.resolved_at
                    ? t("workItems.activity.reopen", {
                        defaultValue: "Reopen",
                      })
                    : t("workItems.activity.resolve", {
                        defaultValue: "Resolve",
                      })}
                </Button>
              ) : null}
            </div>
            <div className="flex flex-col divide-y divide-border-1">
              {threadComments.map((comment, index) => {
                const author = commentAuthor(comment, currentUser, teamMembers);
                const isDeleted = Boolean(comment.deleted_at);
                const isOwn =
                  comment.author === currentUser.id &&
                  !comment.agent_session_id;
                const isEditing = editingCommentId === comment.id;
                return (
                  <div
                    key={comment.id}
                    className={index === 0 ? "p-3" : "bg-fill-1 p-3 pl-8"}
                    data-testid={`work-item-discussion-comment-${comment.id}`}
                  >
                    <div className="mb-2 flex items-center gap-2">
                      <PersonAvatar
                        size={22}
                        name={author.name}
                        src={author.avatar}
                        color={author.color}
                      />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-text-1">
                        {author.name}
                      </span>
                      {comment.conclusion ? (
                        <span className="text-success-7 rounded-full bg-success-1 px-2 py-0.5 text-xs">
                          {t("workItems.activity.conclusion", {
                            defaultValue: "Conclusion",
                          })}
                        </span>
                      ) : null}
                      {comment.edited_at && !isDeleted ? (
                        <span className="text-xs text-text-4">
                          {t("workItems.activity.edited", {
                            defaultValue: "(edited)",
                          })}
                        </span>
                      ) : null}
                      <time className="text-xs text-text-4">
                        {new Date(comment.created_at).toLocaleString()}
                      </time>
                    </div>
                    {isDeleted ? (
                      <p className="text-sm text-text-4 italic">
                        {t("workItems.activity.commentDeleted", {
                          defaultValue: "This comment was deleted.",
                        })}
                      </p>
                    ) : isEditing ? (
                      <div className="flex flex-col gap-2">
                        <Textarea
                          value={editDraft}
                          onChange={(value) => setEditDraft(value)}
                          size="small"
                          autoFocus
                          data-testid={`work-item-discussion-edit-input-${comment.id}`}
                        />
                        <div className="flex justify-end gap-1.5">
                          <Button
                            variant="tertiary"
                            size="mini"
                            onClick={() => setEditingCommentId(null)}
                          >
                            {t("common:actions.cancel", {
                              defaultValue: "Cancel",
                            })}
                          </Button>
                          <Button
                            variant="primary"
                            size="mini"
                            disabled={!editDraft.trim()}
                            onClick={() => {
                              void onEdit?.(
                                comment.id,
                                editDraft,
                                comment.revision ?? 0
                              ).then((outcome) => {
                                if (outcome !== "error") {
                                  setEditingCommentId(null);
                                }
                              });
                            }}
                            data-testid={`work-item-discussion-edit-save-${comment.id}`}
                          >
                            {t("common:actions.save", {
                              defaultValue: "Save",
                            })}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <MarkdownContent body={comment.content} clamped={false} />
                    )}
                    {!isDeleted && !isEditing ? (
                      <div className="mt-2 flex justify-end gap-1">
                        {isOwn && onEdit ? (
                          <Button
                            variant="tertiary"
                            size="mini"
                            icon={
                              <HugeiconsIcon
                                icon={Edit02Icon}
                                data-icon="pencil"
                                size={13}
                                aria-hidden
                              />
                            }
                            onClick={() => {
                              setEditingCommentId(comment.id);
                              setEditDraft(comment.content);
                            }}
                            data-testid={`work-item-discussion-edit-${comment.id}`}
                          >
                            {t("common:actions.edit", {
                              defaultValue: "Edit",
                            })}
                          </Button>
                        ) : null}
                        {isOwn && onDelete ? (
                          <Button
                            variant="tertiary"
                            size="mini"
                            icon={
                              <HugeiconsIcon
                                icon={Delete02Icon}
                                data-icon="trash-2"
                                size={13}
                                aria-hidden
                              />
                            }
                            onClick={() => void handleDelete(comment)}
                            data-testid={`work-item-discussion-delete-${comment.id}`}
                          >
                            {t("common:actions.delete", {
                              defaultValue: "Delete",
                            })}
                          </Button>
                        ) : null}
                        {onReply ? (
                          <Button
                            variant="tertiary"
                            size="mini"
                            icon={
                              <HugeiconsIcon
                                icon={CornerUpLeftIcon}
                                data-icon="corner-up-left"
                                size={13}
                                aria-hidden
                              />
                            }
                            onClick={() => onReply(comment.id)}
                            data-testid={`work-item-discussion-reply-${comment.id}`}
                          >
                            {t("workItems.activity.reply", {
                              defaultValue: "Reply",
                            })}
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </article>
        );
      })}
    </div>
  );
};

export default DiscussionThreads;

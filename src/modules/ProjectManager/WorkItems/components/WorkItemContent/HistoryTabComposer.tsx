import React from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import ComposerShell from "@src/components/ComposerShell";
import MarkdownTextareaEditor, {
  type MarkdownEditorMode,
} from "@src/components/MarkdownTextareaEditor";
import MarkdownEditorModeSwitch from "@src/components/MarkdownTextareaEditor/ModeSwitch";
import PersonAvatar from "@src/components/PersonAvatar";
import { COMPOSER_BOTTOM_DOCK_PADDING_CLASS } from "@src/config/composerStackTokens";
import { ArrowUp02Icon, Cancel01Icon, HugeiconsIcon } from "@src/icons";
import type { Person } from "@src/types/core/shared";

import WorkItemMentionPicker from "./WorkItemMentionPicker";
import type { HistoryTabProps } from "./types";
import type { MentionCandidate } from "./workItemMentions";

const PREVIEW_REASON_KEYS: Record<string, string> = {
  mention: "previewMentionResume",
  mention_start: "previewMentionStart",
  mention_unroutable: "previewMentionUnroutable",
  thread_owner: "previewThread",
  thread_continuation: "previewThread",
  assignee: "previewAssignee",
  assignee_start: "previewAssigneeStart",
  note_only: "previewNoteOnly",
  member_thread: "previewMemberThread",
  no_linked_session: "previewNoSession",
};

interface HistoryTabComposerProps {
  isThread: boolean;
  currentUser: Person;
  commentText: string;
  onCommentTextChange: (text: string) => void;
  onCommentSubmit: () => void;
  isSubmittingComment: boolean;
  editorMode: MarkdownEditorMode;
  onEditorModeChange: (mode: MarkdownEditorMode) => void;
  mentionRefs: string[];
  onMentionRefsChange: (mentionRefs: string[]) => void;
  teamMembers: Person[];
  agents: MentionCandidate[];
  agentOrgs: MentionCandidate[];
  replyToCommentId?: string | null;
  onReplyToComment?: (commentId: string | null) => void;
  triggerPreview?: HistoryTabProps["triggerPreview"];
}

/**
 * Comment composer for the History / Discussion tab: the thread variant sits
 * beside the current user's avatar with a reply banner; the default variant
 * docks to the bottom of the detail panel.
 */
const HistoryTabComposer: React.FC<HistoryTabComposerProps> = ({
  isThread,
  currentUser,
  commentText,
  onCommentTextChange,
  onCommentSubmit,
  isSubmittingComment,
  editorMode,
  onEditorModeChange,
  mentionRefs,
  onMentionRefsChange,
  teamMembers,
  agents,
  agentOrgs,
  replyToCommentId,
  onReplyToComment,
  triggerPreview,
}) => {
  const { t } = useTranslation("projects");
  const hasComment = commentText.trim().length > 0;
  const triggerPreviewChip =
    hasComment && triggerPreview ? (
      <div
        className="flex items-center gap-1.5 self-start rounded-full bg-fill-2 px-2 py-0.5 text-[11px] text-text-3"
        title={triggerPreview.targetSessionId ?? undefined}
        data-testid="work-item-discussion-trigger-preview"
      >
        <span
          className={`inline-block h-1.5 w-1.5 rounded-full ${
            triggerPreview.willWake ? "bg-primary-6" : "bg-fill-4"
          }`}
          aria-hidden
        />
        {t(
          `workItems.discussion.${
            PREVIEW_REASON_KEYS[triggerPreview.reason] ??
            (triggerPreview.willWake ? "previewWillWake" : "previewNoSession")
          }`
        )}
        {triggerPreview.willCoalesce ? (
          <span className="text-text-4">
            · {t("workItems.discussion.previewCoalesce")}
          </span>
        ) : null}
      </div>
    ) : null;
  const submitButton = (
    <Button
      variant={hasComment ? "primary" : isThread ? "tertiary" : "secondary"}
      shape="circle"
      size="small"
      iconOnly
      icon={
        <HugeiconsIcon
          icon={ArrowUp02Icon}
          data-icon="arrow-up"
          size={16}
          aria-hidden
        />
      }
      title={t("workItems.activity.submitComment")}
      aria-label={t("workItems.activity.submitComment")}
      onClick={onCommentSubmit}
      disabled={!hasComment || isSubmittingComment}
      loading={isSubmittingComment}
    />
  );

  return isThread ? (
    <div className="flex items-start gap-2.5">
      <PersonAvatar
        size={28}
        name={currentUser.name}
        src={currentUser.avatar}
        color={currentUser.color}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        {replyToCommentId ? (
          <div
            className="flex items-center justify-between gap-2 rounded-lg bg-fill-2 px-2 py-1 text-xs text-text-3"
            data-testid="work-item-discussion-reply-context"
          >
            <span className="truncate">
              {t("workItems.activity.replyingInThread")}
            </span>
            <Button
              variant="tertiary"
              size="mini"
              shape="circle"
              iconOnly
              icon={
                <HugeiconsIcon
                  icon={Cancel01Icon}
                  data-icon="x"
                  size={12}
                  aria-hidden
                />
              }
              aria-label={t("workItems.activity.cancelReply")}
              title={t("workItems.activity.cancelReply")}
              onClick={() => onReplyToComment?.(null)}
            />
          </div>
        ) : null}
        {triggerPreviewChip}
        <ComposerShell
          variant="comment"
          className="flex-col! items-stretch!"
          data-testid="work-item-comment-composer"
        >
          <MarkdownTextareaEditor
            className="min-w-0 flex-1"
            placeholder={t("workItems.activity.commentPlaceholder")}
            value={commentText}
            onChange={(markdown) => onCommentTextChange(markdown)}
            onSubmit={onCommentSubmit}
            minHeight={28}
            maxHeight={120}
            appearance="plain"
            mode={editorMode}
            onModeChange={onEditorModeChange}
            dataTestId="work-item-comment-editor"
          />
          <div className="flex items-center justify-between gap-2">
            <MarkdownEditorModeSwitch
              mode={editorMode}
              onModeChange={onEditorModeChange}
              disabled={isSubmittingComment}
              dataTestId="work-item-comment-mode-switch"
            />
            <div className="flex min-w-0 items-center justify-end gap-1.5">
              <WorkItemMentionPicker
                members={teamMembers}
                agents={agents}
                agentOrgs={agentOrgs}
                currentUserId={currentUser.id}
                value={mentionRefs}
                disabled={isSubmittingComment}
                onChange={onMentionRefsChange}
              />
              {submitButton}
            </div>
          </div>
        </ComposerShell>
      </div>
    </div>
  ) : (
    <div
      className={`mt-auto flex flex-col gap-2 ${COMPOSER_BOTTOM_DOCK_PADDING_CLASS}`}
      data-testid="work-item-default-comment-dock"
    >
      <div className="min-w-0 flex-1">
        {triggerPreviewChip ? (
          <div className="mb-2">{triggerPreviewChip}</div>
        ) : null}
        <MarkdownTextareaEditor
          placeholder={t("workItems.activity.commentPlaceholder")}
          value={commentText}
          onChange={(markdown) => onCommentTextChange(markdown)}
          onSubmit={onCommentSubmit}
          minHeight={60}
          maxHeight={120}
          appearance="outlined"
          mode={editorMode}
          onModeChange={onEditorModeChange}
          dataTestId="work-item-comment-editor"
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <MarkdownEditorModeSwitch
            mode={editorMode}
            onModeChange={onEditorModeChange}
            disabled={isSubmittingComment}
            dataTestId="work-item-comment-mode-switch"
          />
          <div className="flex min-w-0 items-center justify-end gap-1.5">
            <WorkItemMentionPicker
              members={teamMembers}
              agents={agents}
              agentOrgs={agentOrgs}
              currentUserId={currentUser.id}
              value={mentionRefs}
              disabled={isSubmittingComment}
              onChange={onMentionRefsChange}
            />
            {submitButton}
          </div>
        </div>
      </div>
    </div>
  );
};

export default HistoryTabComposer;

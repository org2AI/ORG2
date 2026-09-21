import React from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import MarkdownTextareaEditor, {
  type MarkdownEditorMode,
  type MarkdownTextareaEditorRef,
} from "@src/components/MarkdownTextareaEditor";
import MarkdownEditorModeSwitch from "@src/components/MarkdownTextareaEditor/ModeSwitch";
import { COMPOSER_BOTTOM_DOCK_PADDING_CLASS } from "@src/config/composerStackTokens";
import { DETAIL_PANEL_TOKENS } from "@src/config/detailPanelTokens";
import ComposerSurface from "@src/engines/ChatPanel/ComposerSurface";

interface PrConversationComposerProps {
  composerDockRef: React.RefObject<HTMLDivElement | null>;
  dropTargetRef: React.RefObject<HTMLDivElement | null>;
  editorRef: React.RefObject<MarkdownTextareaEditorRef | null>;
  isDragOver: boolean;
  editorMode: MarkdownEditorMode;
  setEditorMode: (mode: MarkdownEditorMode) => void;
  draft: string;
  updateDraft: (nextDraft: string) => void;
  handleComment: () => Promise<void>;
  submittingComment: boolean;
  submittingReview: boolean;
  setReviewModalVisible: (visible: boolean) => void;
}

/** Floating bottom composer: comment editor, mode switch and actions. */
export function PrConversationComposer({
  composerDockRef,
  dropTargetRef,
  editorRef,
  isDragOver,
  editorMode,
  setEditorMode,
  draft,
  updateDraft,
  handleComment,
  submittingComment,
  submittingReview,
  setReviewModalVisible,
}: PrConversationComposerProps): React.ReactNode {
  const { t } = useTranslation("common");

  return (
    <div
      ref={composerDockRef}
      className={`absolute right-0 bottom-0 left-0 z-50 flex w-full shrink-0 flex-col items-center pt-1 ${COMPOSER_BOTTOM_DOCK_PADDING_CLASS}`}
      data-testid="pr-floating-composer"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-[-28px] bottom-0 bg-linear-to-t from-chat-pane via-chat-pane/90 to-transparent"
      />
      <div
        className={`${DETAIL_PANEL_TOKENS.headerWidth} relative z-10 w-full px-4`}
      >
        <section
          data-testid="pr-comment-composer"
          aria-label={t("git.pr.commentPlaceholder", "Leave a comment…")}
          className="flex flex-col gap-1.5"
        >
          <ComposerSurface
            ref={dropTargetRef}
            variant="default"
            className={`overflow-visible pt-1.5! ${
              isDragOver ? "ring-2! ring-primary-6!" : ""
            }`.trim()}
            data-testid="pr-comment-drop-target"
            leadingActions={
              <MarkdownEditorModeSwitch
                mode={editorMode}
                onModeChange={setEditorMode}
                disabled={submittingComment || submittingReview}
                dataTestId="pr-comment-mode-switch"
              />
            }
            trailingActions={
              <div className="flex items-center justify-end gap-1.5">
                <Button
                  size="small"
                  shape="round"
                  disabled={submittingReview}
                  onClick={() => setReviewModalVisible(true)}
                  data-testid="pr-submit-review"
                >
                  {t("git.pr.submitReview", "Submit review")}
                </Button>
                <Button
                  variant="primary"
                  size="small"
                  shape="round"
                  loading={submittingComment}
                  disabled={!draft.trim() || submittingComment}
                  onClick={() => void handleComment()}
                >
                  {t("git.pr.comment", "Comment")}
                </Button>
              </div>
            }
          >
            <MarkdownTextareaEditor
              ref={editorRef}
              value={draft}
              onChange={updateDraft}
              placeholder={t("git.pr.commentPlaceholder", "Leave a comment…")}
              minHeight={64}
              minRows={2}
              maxHeight={500}
              appearance="plain"
              editable={!submittingComment && !submittingReview}
              onSubmit={() => void handleComment()}
              mode={editorMode}
              onModeChange={setEditorMode}
              dataTestId="pr-comment-editor"
            />
          </ComposerSurface>
        </section>
      </div>
    </div>
  );
}

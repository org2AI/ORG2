/**
 * PrConversationTab
 *
 * GitHub-style PR conversation: a flow-title header (title · #number · status
 * pill · merge-flow sentence) over the PR description and the interleaved
 * comment/review timeline, closed by GitHub's merge box. A bottom composer
 * posts a conversation comment or submits a review. The operations sidebar stays at the panel level beside
 * the tabs.
 *
 * Reuses the shared timeline primitives so it renders identically to the Issue
 * detail view.
 */
import React from "react";

import type {
  GitHubIssueComment,
  GitHubIssueTimelineItem,
  GitHubPrReview,
  GitHubReviewComment,
  PrReviewEvent,
} from "@src/api/tauri/github";
import { DETAIL_PANEL_TOKENS } from "@src/config/detailPanelTokens";
import type { PrIdentity } from "@src/store/workstation/codeEditor/workstationSelectedPrAtom";

import { PrConversationComposer } from "./PrConversationComposer";
import { PrConversationTimeline } from "./PrConversationTimeline";
import { PrReviewModal } from "./PrReviewModal";
import { usePrConversationComposer } from "./usePrConversationComposer";
import { usePrConversationTimeline } from "./usePrConversationTimeline";
import { usePrReviewModal } from "./usePrReviewModal";

interface PrConversationTabProps {
  /** GitHub-style flow-title block rendered above the timeline. */
  flowHeader?: React.ReactNode;
  inlineProperties?: React.ReactNode;
  /** GitHub-style merge box rendered after the last timeline entry. */
  mergeBox?: React.ReactNode;
  detail: Record<string, unknown> | null;
  identity: PrIdentity;
  conversation: GitHubIssueComment[];
  reviews: GitHubPrReview[];
  reviewComments: GitHubReviewComment[];
  timelineEvents?: GitHubIssueTimelineItem[];
  loading: boolean;
  submittingComment: boolean;
  submittingReview: boolean;
  draft?: string;
  onDraftChange?: (draft: string) => void;
  onAddComment: (body: string) => Promise<void>;
  onSubmitReview: (event: PrReviewEvent, body: string) => Promise<void>;
  trailScrollContainerRef?: (node: HTMLDivElement | null) => void;
  trailContentRef?: (node: HTMLDivElement | null) => void;
}

export const PrConversationTab: React.FC<PrConversationTabProps> = ({
  flowHeader,
  inlineProperties,
  mergeBox,
  detail,
  identity,
  conversation,
  reviews,
  reviewComments,
  timelineEvents,
  loading,
  submittingComment,
  submittingReview,
  draft: controlledDraft,
  onDraftChange,
  onAddComment,
  onSubmitReview,
  trailScrollContainerRef,
  trailContentRef,
}) => {
  const {
    draft,
    updateDraft,
    editorMode,
    setEditorMode,
    editorRef,
    dropTargetRef,
    composerDockRef,
    composerBottomInset,
    isDragOver,
    handleComment,
  } = usePrConversationComposer({
    controlledDraft,
    onDraftChange,
    submittingComment,
    onAddComment,
  });
  const {
    reviewModalVisible,
    setReviewModalVisible,
    reviewDecision,
    reviewBody,
    setReviewBody,
    closeReviewModal,
    handleReviewDecisionChange,
    handleReview,
    submitReviewDisabled,
  } = usePrReviewModal({ submittingReview, onSubmitReview });
  const { commentsByReview, timeline } = usePrConversationTimeline(
    conversation,
    reviews,
    reviewComments,
    timelineEvents
  );

  return (
    <div className="allow-select-deep relative flex h-full min-h-0 flex-col overflow-hidden select-text">
      <div
        ref={trailScrollContainerRef}
        className="scrollbar-hide min-h-0 flex-1 overflow-y-auto"
        data-testid="pr-conversation-scroll"
      >
        <div
          ref={trailContentRef}
          style={{ paddingBottom: composerBottomInset }}
        >
          {flowHeader ? (
            <div className={`${DETAIL_PANEL_TOKENS.headerWidth} px-4 pt-5`}>
              {flowHeader}
            </div>
          ) : null}
          <div
            className={`${DETAIL_PANEL_TOKENS.headerWidth} flex flex-col px-4 py-4`}
          >
            {inlineProperties ? (
              <div className="mb-4">{inlineProperties}</div>
            ) : null}
            <div className="min-w-0 flex-1">
              <PrConversationTimeline
                detail={detail}
                identity={identity}
                timeline={timeline}
                commentsByReview={commentsByReview}
                loading={loading}
              />
            </div>
            {mergeBox ? <div className="mt-4">{mergeBox}</div> : null}
          </div>
        </div>
      </div>

      <PrConversationComposer
        composerDockRef={composerDockRef}
        dropTargetRef={dropTargetRef}
        editorRef={editorRef}
        isDragOver={isDragOver}
        editorMode={editorMode}
        setEditorMode={setEditorMode}
        draft={draft}
        updateDraft={updateDraft}
        handleComment={handleComment}
        submittingComment={submittingComment}
        submittingReview={submittingReview}
        setReviewModalVisible={setReviewModalVisible}
      />

      <PrReviewModal
        reviewModalVisible={reviewModalVisible}
        closeReviewModal={closeReviewModal}
        handleReview={handleReview}
        submittingReview={submittingReview}
        submitReviewDisabled={submitReviewDisabled}
        reviewDecision={reviewDecision}
        handleReviewDecisionChange={handleReviewDecisionChange}
        reviewBody={reviewBody}
        setReviewBody={setReviewBody}
      />
    </div>
  );
};

PrConversationTab.displayName = "PrConversationTab";

import React from "react";

import { PersistentDetailTabPanel } from "@src/components/layout/blocks";
import type {
  PrDetailTab,
  PrIdentity,
  WorkstationPrDetailViewState,
  WorkstationSelectedPrState,
} from "@src/store/workstation/codeEditor/workstationSelectedPrAtom";

import { PrChangesTab } from "./PrChangesTab";
import { PrChecksTab } from "./PrChecksTab";
import { PrCommitsTab } from "./PrCommitsTab";
import { PrConversationTab } from "./PrConversationTab";
import { PrFlowHeader } from "./PrFlowHeader";
import { PrLevelActions } from "./PrLevelActions";
import { PrMergeBox } from "./PrMergeBox";
import type { WorkstationPrDetailController } from "./types";

interface PrDetailTabPanelsProps {
  inlineProperties?: React.ReactNode;
  identity: PrIdentity;
  currentIdentity: PrIdentity;
  repoPath: string;
  repoId?: string;
  state: WorkstationSelectedPrState;
  detailViewState: WorkstationPrDetailViewState;
  activeTab: PrDetailTab;
  baseBranch: string;
  controller: WorkstationPrDetailController;
  setConversationDraft: (conversationDraft: string) => void;
  setSelectedCommitSha: (selectedCommitSha: string | null) => void;
  setSelectedChangedFilePath: (selectedChangedFilePath: string | null) => void;
  setTabContentNode: (node: HTMLDivElement | null) => void;
  setConversationScrollNode: (node: HTMLDivElement | null) => void;
  setConversationContentNode: (node: HTMLDivElement | null) => void;
  onFileSelect?: (path: string) => void;
}

/** Conversation / Commits / Checks / Changes panels beside the details rail. */
export function PrDetailTabPanels({
  inlineProperties,
  identity,
  currentIdentity,
  repoPath,
  repoId,
  state,
  detailViewState,
  activeTab,
  baseBranch,
  controller,
  setConversationDraft,
  setSelectedCommitSha,
  setSelectedChangedFilePath,
  setTabContentNode,
  setConversationScrollNode,
  setConversationContentNode,
  onFileSelect,
}: PrDetailTabPanelsProps): React.ReactNode {
  const {
    repoFullName,
    addComment,
    submitReview,
    replyInlineComment,
    mergePullRequest,
    setPullRequestAutoMerge,
    updatePullRequestDraft,
    updatePullRequestState,
    prActionPending,
  } = controller;

  // Held back until the pull request itself has loaded: every verdict in the
  // box is read from `detail`, and an empty box would claim "blocked".
  const mergeBox = state.detail ? (
    <PrMergeBox
      detail={state.detail}
      fallbackStatus={currentIdentity.status}
      checks={state.checks}
      deployments={state.deployments}
      reviews={state.reviews}
      actions={
        <PrLevelActions
          layout="mergeBox"
          identity={currentIdentity}
          detail={state.detail}
          checks={state.checks}
          disabled={!repoFullName}
          pending={prActionPending}
          onMerge={mergePullRequest}
          onSetAutoMerge={setPullRequestAutoMerge}
          onDraftChange={updatePullRequestDraft}
          onStateChange={updatePullRequestState}
        />
      }
    />
  ) : null;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <PersistentDetailTabPanel
        active={activeTab === "conversation"}
        id="pr-detail-tabpanel-conversation"
        ariaLabelledBy="pr-detail-tab-conversation"
        className="min-w-0 overflow-hidden"
      >
        <div
          ref={setTabContentNode}
          className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
        >
          <PrConversationTab
            inlineProperties={inlineProperties}
            mergeBox={mergeBox}
            flowHeader={
              <PrFlowHeader
                identity={currentIdentity}
                detail={state.detail}
                baseBranch={baseBranch}
                commitCount={state.commits.length}
                files={state.files}
              />
            }
            detail={state.detail}
            identity={currentIdentity}
            conversation={state.conversation}
            reviews={state.reviews}
            reviewComments={state.reviewComments}
            timelineEvents={state.timeline}
            loading={state.loading}
            submittingComment={state.submittingComment}
            submittingReview={state.submittingReview}
            draft={detailViewState.conversationDraft}
            onDraftChange={setConversationDraft}
            onAddComment={addComment}
            onSubmitReview={submitReview}
            trailScrollContainerRef={setConversationScrollNode}
            trailContentRef={setConversationContentNode}
          />
        </div>
      </PersistentDetailTabPanel>

      <PersistentDetailTabPanel
        active={activeTab === "commits"}
        id="pr-detail-tabpanel-commits"
        ariaLabelledBy="pr-detail-tab-commits"
        className="min-w-0 flex-col overflow-hidden"
      >
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <PrCommitsTab
            commits={state.commits}
            prNumber={identity.number}
            repoPath={repoPath}
            repoId={repoId}
            loading={state.loading}
            checks={state.checks}
            selectedCommitSha={detailViewState.selectedCommitSha}
            onSelectedCommitShaChange={setSelectedCommitSha}
            onFileSelect={onFileSelect}
          />
        </div>
      </PersistentDetailTabPanel>

      <PersistentDetailTabPanel
        active={activeTab === "checks"}
        id="pr-detail-tabpanel-checks"
        ariaLabelledBy="pr-detail-tab-checks"
        className="min-w-0 flex-col overflow-hidden"
      >
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <PrChecksTab checks={state.checks} loading={state.loading} />
        </div>
      </PersistentDetailTabPanel>

      <PersistentDetailTabPanel
        active={activeTab === "changes"}
        id="pr-detail-tabpanel-changes"
        ariaLabelledBy="pr-detail-tab-changes"
        className="min-w-0 flex-col overflow-hidden"
      >
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <PrChangesTab
            repoFullName={repoFullName}
            detail={state.detail}
            headSha={state.headSha}
            baseRef={state.baseRef}
            files={state.files}
            loading={state.loading}
            reviewComments={state.reviewComments}
            selectedFilePath={detailViewState.selectedChangedFilePath}
            onSelectedFilePathChange={setSelectedChangedFilePath}
            onFileSelect={onFileSelect}
            onReplyInlineComment={replyInlineComment}
          />
        </div>
      </PersistentDetailTabPanel>
    </div>
  );
}

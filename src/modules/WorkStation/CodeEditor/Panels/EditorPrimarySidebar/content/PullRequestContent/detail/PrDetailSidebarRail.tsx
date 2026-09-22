import React from "react";
import { useTranslation } from "react-i18next";

import {
  ScrollTrail,
  WORKSTATION_TRAIL_RAIL_PADDING_CLASS,
  WORKSTATION_TRAIL_WIDTH,
} from "@src/components/layout/blocks";
import type {
  PrDetailTab,
  PrIdentity,
  WorkstationSelectedPrState,
} from "@src/store/workstation/codeEditor/workstationSelectedPrAtom";

import { PrSidebar } from "./PrSidebar";
import type { WorkstationPrDetailController } from "./types";

interface PrDetailSidebarRailProps {
  currentIdentity: PrIdentity;
  state: WorkstationSelectedPrState;
  controller: WorkstationPrDetailController;
  activeTab: PrDetailTab;
  inline?: boolean;
  trailScrollContainerRef: React.RefObject<HTMLElement | null>;
  trailContentRef: React.RefObject<HTMLElement | null>;
}

/** Permanent details rail: operations sidebar over the conversation trail. */
export function PrDetailSidebarRail({
  currentIdentity,
  state,
  controller,
  activeTab,
  inline = false,
  trailScrollContainerRef,
  trailContentRef,
}: PrDetailSidebarRailProps): React.ReactNode {
  const { t } = useTranslation("common");
  const {
    repoFullName,
    mergePullRequest,
    setPullRequestAutoMerge,
    updatePullRequestDraft,
    updatePullRequestState,
    updateRequestedReviewers,
    updateAssignees,
    updateLabels,
    loadReviewerCandidates,
    reviewerCandidates,
    assigneeCandidates,
    loadingReviewerCandidates,
    reviewerCandidatesError,
    loadLabelCandidates,
    labelCandidates,
    loadingLabelCandidates,
    labelCandidatesError,
    prActionPending,
  } = controller;

  // The conversation scroll trail shares the details column, sitting under the
  // rail exactly as the session/Work Item trail does.
  const navigationTrail = (
    <div
      className="relative ml-auto min-h-0 w-11 flex-1"
      data-testid="pr-detail-navigation-rail"
    >
      <ScrollTrail
        scrollContainerRef={trailScrollContainerRef}
        contentRef={trailContentRef}
        ariaLabel={t("git.pr.navigationTrail")}
        alignment="start"
        placement="rail"
        testId="pr-detail-navigation-trail"
      />
    </div>
  );
  const sidebar = (
    <PrSidebar
      identity={currentIdentity}
      detail={state.detail}
      checks={state.checks}
      reviews={state.reviews}
      disabled={!repoFullName}
      pending={prActionPending}
      reviewerCandidates={reviewerCandidates}
      loadingReviewerCandidates={loadingReviewerCandidates}
      reviewerCandidatesError={reviewerCandidatesError}
      onLoadReviewerCandidates={loadReviewerCandidates}
      onMerge={mergePullRequest}
      onSetAutoMerge={setPullRequestAutoMerge}
      onDraftChange={updatePullRequestDraft}
      onStateChange={updatePullRequestState}
      onRequestedReviewersChange={updateRequestedReviewers}
      assigneeCandidates={assigneeCandidates}
      onAssigneesChange={updateAssignees}
      labelCandidates={labelCandidates}
      loadingLabelCandidates={loadingLabelCandidates}
      labelCandidatesError={labelCandidatesError}
      onLoadLabelCandidates={loadLabelCandidates}
      onLabelsChange={updateLabels}
    />
  );

  if (inline) return sidebar;

  return (
    <div
      className={`box-border flex h-full shrink-0 flex-col ${WORKSTATION_TRAIL_RAIL_PADDING_CLASS}`}
      style={{ width: WORKSTATION_TRAIL_WIDTH.expandedPx }}
      data-testid="pr-detail-sidebar-rail"
    >
      {sidebar}
      {activeTab === "conversation" ? navigationTrail : null}
    </div>
  );
}

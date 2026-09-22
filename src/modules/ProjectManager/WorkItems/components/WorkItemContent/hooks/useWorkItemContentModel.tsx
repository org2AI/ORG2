import React, { useState } from "react";
import { useTranslation } from "react-i18next";

import PageNotice from "@src/components/PageNotice";
import type { Person } from "@src/types/core/shared";
import { WORK_ITEM_STATUS } from "@src/types/core/workItem";

import WorkItemFlowHeader from "../../WorkItemFlowHeader";
import type { WorkItemThreadView } from "../../WorkItemThread";
import WorkItemHandoffNotice from "../WorkItemHandoffNotice";
import { normalizeLegacyEscapedMarkdown } from "../descriptionMarkdown";
import {
  type WorkItemContentPresentation,
  resolveWorkItemContentSectionPolicy,
} from "../presentation";
import type { WorkItemContentProps } from "../types";
import { useGitHubIssueTimeline } from "./useGitHubIssueTimeline";
import type { useWorkItemContentState } from "./useWorkItemContentState";
import { useWorkItemDescriptionEditing } from "./useWorkItemDescriptionEditing";
import { useWorkItemHandoff } from "./useWorkItemHandoff";

type WorkItemContentState = ReturnType<typeof useWorkItemContentState>;

interface UseWorkItemContentModelParams extends Pick<
  WorkItemContentProps,
  | "workItem"
  | "flowHeader"
  | "githubIssueTimeline"
  | "githubIssueInteraction"
  | "repoPath"
  | "shortId"
  | "projectSlug"
  | "onUpdateWorkItem"
  | "onTransitionHandoff"
  | "onRefreshWorkflow"
> {
  presentation: WorkItemContentPresentation;
  teamMembers: Person[];
  currentUser: WorkItemContentState["currentUser"];
  currentUserMemberIds: WorkItemContentState["currentUserMemberIds"];
  rawDescription: WorkItemContentState["rawDescription"];
  resolvedDescription: WorkItemContentState["resolvedDescription"];
  handleDescriptionChange: WorkItemContentState["handleDescriptionChange"];
}

/**
 * Derived presentation model for WorkItemContent: creator / flow header,
 * normalized description text, GitHub issue timeline, description editing,
 * thread view selection, section policy and the handoff notice.
 */
export function useWorkItemContentModel({
  workItem,
  presentation,
  flowHeader,
  teamMembers,
  githubIssueTimeline,
  githubIssueInteraction,
  repoPath,
  shortId,
  projectSlug,
  onUpdateWorkItem,
  onTransitionHandoff,
  onRefreshWorkflow,
  currentUser,
  currentUserMemberIds,
  rawDescription,
  resolvedDescription,
  handleDescriptionChange,
}: UseWorkItemContentModelParams) {
  const { t } = useTranslation(["projects", "common"]);

  const creatorName =
    workItem.createdBy?.name ||
    teamMembers?.find((member) => member.id === workItem.user_id)?.name ||
    workItem.user_id ||
    t("workItems.activity.system");
  const resolvedFlowHeader =
    flowHeader !== undefined ? (
      flowHeader
    ) : (
      <WorkItemFlowHeader
        workItem={workItem}
        shortId={shortId}
        actorName={creatorName}
      />
    );
  const normalizedRawDescription =
    normalizeLegacyEscapedMarkdown(rawDescription);
  const displayedDescription = normalizeLegacyEscapedMarkdown(
    resolvedDescription ?? rawDescription
  );
  const displayStatus = workItem.workItemStatus ?? workItem.status;
  const isGitHubWorkItem =
    displayStatus === WORK_ITEM_STATUS.GITHUB_OPEN ||
    displayStatus === WORK_ITEM_STATUS.GITHUB_CLOSED;
  const canEditDescription = isGitHubWorkItem
    ? Boolean(githubIssueInteraction?.canEditBody)
    : Boolean(onUpdateWorkItem);
  const loadedGitHubTimeline = useGitHubIssueTimeline({
    enabled: isGitHubWorkItem && !githubIssueTimeline,
    repoPath,
    shortId: shortId ?? workItem.shortId,
  });
  const githubTimeline =
    githubIssueTimeline?.items ?? loadedGitHubTimeline.timeline;
  const githubTimelineLoading =
    githubIssueTimeline?.loading ?? loadedGitHubTimeline.timelineLoading;
  const githubTimelineError =
    githubIssueTimeline?.error ?? loadedGitHubTimeline.timelineError;
  const githubTimelineAlert =
    isGitHubWorkItem && !githubTimelineLoading && githubTimelineError ? (
      <PageNotice
        type="danger"
        role="status"
        dataTestId="work-item-github-timeline-alert"
        title={t("git.issues.timelineErrorTitle")}
      >
        {githubTimelineError}
      </PageNotice>
    ) : null;
  const descriptionEditing = useWorkItemDescriptionEditing({
    workItemId: workItem.session_id,
    displayedDescription,
    isGitHubWorkItem,
    githubIssueInteraction,
    onCommitDescription: handleDescriptionChange,
  });
  const { descriptionEditWorkItemId } = descriptionEditing;
  const [threadViewSelection, setThreadViewSelection] = useState<{
    workItemId: string;
    view: WorkItemThreadView;
  }>({
    workItemId: workItem.session_id,
    view: "overview",
  });
  const sectionPolicy = resolveWorkItemContentSectionPolicy(
    presentation,
    Boolean(workItem.proofOfWork)
  );
  const isThread = presentation === "thread";
  const activeThreadView =
    !isGitHubWorkItem && threadViewSelection.workItemId === workItem.session_id
      ? threadViewSelection.view
      : "overview";
  const isEditingThreadDescription =
    isThread && descriptionEditWorkItemId === workItem.session_id;
  const {
    handoff,
    canRespondToHandoff,
    handoffError,
    handoffResponseUnavailableReason,
    respondingHandoff,
    respondToHandoff,
  } = useWorkItemHandoff({
    workItem,
    shortId,
    projectSlug,
    onTransitionHandoff,
    onRefreshWorkflow,
    currentUser,
    currentUserMemberIds,
    teamMembers,
    t,
  });
  const handoffNotice = handoff ? (
    <WorkItemHandoffNotice
      handoff={handoff}
      canRespond={canRespondToHandoff}
      error={handoffError}
      unavailableReason={handoffResponseUnavailableReason}
      responding={respondingHandoff}
      onAccept={() => respondToHandoff("accept")}
      onReturn={(reason) => respondToHandoff("return", reason)}
    />
  ) : null;

  return {
    creatorName,
    resolvedFlowHeader,
    normalizedRawDescription,
    displayedDescription,
    isGitHubWorkItem,
    canEditDescription,
    githubTimeline,
    githubTimelineLoading,
    githubTimelineError,
    githubTimelineAlert,
    descriptionEditing,
    setThreadViewSelection,
    sectionPolicy,
    isThread,
    activeThreadView,
    isEditingThreadDescription,
    handoffNotice,
  };
}

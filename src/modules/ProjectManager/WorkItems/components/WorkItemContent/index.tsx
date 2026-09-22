import { useAtomValue } from "jotai";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { builtInAgentsAtom } from "@src/modules/MainApp/AgentOrgs/store/builtInAgentsAtom";
import { useEnsureStatusDefinitions } from "@src/modules/ProjectManager/WorkItems/hooks/useStatusDefinitions";

import { useWorkItemFamily } from "../WorkItemSubItems";
import WorkItemContentHistory from "./WorkItemContentHistory";
import {
  WorkItemContentStackLayout,
  WorkItemContentThreadLayout,
} from "./WorkItemContentLayouts";
import { useWorkItemContentModel } from "./hooks/useWorkItemContentModel";
import { useWorkItemContentSections } from "./hooks/useWorkItemContentSections";
import { useWorkItemContentState } from "./hooks/useWorkItemContentState";
import type { WorkItemContentProps } from "./types";

const WorkItemContent: React.FC<WorkItemContentProps> = ({
  workItem,
  presentation = "default",
  onUpdateWorkItem,
  onUpdateWorkItemImmediate,
  currentUser: currentUserProp,
  teamMembers = [],
  availableAgents = [],
  availableOrgs = [],
  headerPath,
  headerProperties,
  flowHeader,
  propertiesRail,
  titleVisible = false,
  repoPath,
  projectSlug,
  shortId,
  githubIssueTimeline,
  githubIssueInteraction,
  orgId,
  onOpenSubItem,
  onOpenSession,
  onOpenFileDiff,
  onReviewAllFiles,
  onRefreshWorkflow,
  onTransitionHandoff,
  activeAgentSessionId,
  onCreatePr,
}) => {
  const { t } = useTranslation(["projects", "common"]);
  const builtInAgents = useAtomValue(builtInAgentsAtom);
  const mentionAgents = useMemo(
    () => [...builtInAgents, ...availableAgents],
    [builtInAgents, availableAgents]
  );
  useEnsureStatusDefinitions(orgId ?? "personal-org");

  const subItemFamily = useWorkItemFamily(
    shortId ?? workItem.shortId ?? "",
    projectSlug,
    orgId
  );

  const contentState = useWorkItemContentState({
    workItem,
    onUpdateWorkItem,
    onUpdateWorkItemImmediate,
    currentUserProp,
    teamMembers,
    availableAgents: mentionAgents,
    availableOrgs,
    projectSlug,
    shortId,
    orgId,
    onRefreshWorkflow,
  });
  const {
    currentUser,
    currentUserMemberIds,
    resolvedDescription,
    rawDescription,
    handleDescriptionChange,
    handleToggleSubscription,
    handleCommentSubmit,
    handleResolveDiscussionThread,
    handleReopenDiscussionThread,
  } = contentState;

  const contentModel = useWorkItemContentModel({
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
  });
  const { setThreadViewSelection, isThread, activeThreadView } = contentModel;

  const historyContent = (
    <WorkItemContentHistory
      workItem={workItem}
      presentation={presentation}
      contentState={contentState}
      agents={mentionAgents}
      agentOrgs={availableOrgs}
      teamMembers={teamMembers}
      canComment={Boolean(onUpdateWorkItem)}
      isThread={isThread}
      activeThreadView={activeThreadView}
      setThreadViewSelection={setThreadViewSelection}
      onToggleSubscribe={handleToggleSubscription}
      onCommentSubmit={handleCommentSubmit}
      onResolveThread={handleResolveDiscussionThread}
      onReopenThread={handleReopenDiscussionThread}
    />
  );

  const sections = useWorkItemContentSections({
    t,
    workItem,
    onUpdateWorkItem,
    repoPath,
    projectSlug,
    shortId,
    githubIssueInteraction,
    orgId,
    onOpenSubItem,
    onOpenSession,
    onOpenFileDiff,
    onReviewAllFiles,
    onRefreshWorkflow,
    activeAgentSessionId,
    onCreatePr,
    teamMembers,
    availableOrgs,
    mentionAgents,
    titleVisible,
    subItemFamily,
    contentState,
    contentModel,
    historyContent,
  });

  if (isThread) {
    return (
      <>
        <WorkItemContentThreadLayout
          workItem={workItem}
          headerPath={headerPath}
          headerProperties={headerProperties}
          propertiesRail={propertiesRail}
          githubIssueInteraction={githubIssueInteraction}
          contentModel={contentModel}
          sections={sections}
          historyContent={historyContent}
        />
        {sections.commentConflictModal}
      </>
    );
  }

  return (
    <>
      <WorkItemContentStackLayout
        headerPath={headerPath}
        headerProperties={headerProperties}
        contentModel={contentModel}
        sections={sections}
      />
      {sections.commentConflictModal}
    </>
  );
};

export default WorkItemContent;

import type { TFunction } from "i18next";
import React, { useRef } from "react";

import { ScrollTrailTarget } from "@src/components/layout/blocks";
import { useWorkItemImageInsert } from "@src/hooks/project";
import type { ProjectContentEditorRef } from "@src/modules/ProjectManager/shared";
import type { Person } from "@src/types/core/shared";

import RevisionConflictModal from "../../RevisionConflictModal";
import WorkItemSubItems, {
  type useWorkItemFamily,
} from "../../WorkItemSubItems";
import CustomPropertiesSection from "../CustomPropertiesSection";
import OutputTab from "../OutputTab";
import QuickActionsSection from "../QuickActionsSection";
import {
  WorkItemTabbedLowerSection,
  WorkItemThreadLowerSection,
} from "../WorkItemContentLowerSections";
import WorkItemDescriptionSection from "../WorkItemDescriptionSection";
import type { WorkItemContentProps } from "../types";
import type { MentionCandidate } from "../workItemMentions";
import type { useWorkItemContentModel } from "./useWorkItemContentModel";
import type { useWorkItemContentState } from "./useWorkItemContentState";

interface UseWorkItemContentSectionsOptions extends Pick<
  WorkItemContentProps,
  | "workItem"
  | "onUpdateWorkItem"
  | "repoPath"
  | "projectSlug"
  | "shortId"
  | "githubIssueInteraction"
  | "orgId"
  | "onOpenSubItem"
  | "onOpenSession"
  | "onOpenFileDiff"
  | "onReviewAllFiles"
  | "onRefreshWorkflow"
  | "activeAgentSessionId"
  | "onCreatePr"
> {
  t: TFunction<["projects", "common"]>;
  teamMembers: Person[];
  availableOrgs: MentionCandidate[];
  mentionAgents: MentionCandidate[];
  titleVisible: boolean;
  subItemFamily: ReturnType<typeof useWorkItemFamily>;
  contentState: ReturnType<typeof useWorkItemContentState>;
  contentModel: ReturnType<typeof useWorkItemContentModel>;
  historyContent: React.ReactNode;
}

/**
 * Section elements shared by the thread and stack presentations of
 * WorkItemContent: the description card (with its editor ref and image
 * insertion), the local-only quick actions / custom properties / sub-items
 * sections, the comment conflict modal and the two lower sections.
 */
export function useWorkItemContentSections({
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
}: UseWorkItemContentSectionsOptions) {
  const editorRef = useRef<ProjectContentEditorRef>(null);
  const { handleImageInsert } = useWorkItemImageInsert({
    projectSlug: projectSlug ?? null,
    editorRef,
  });

  const {
    currentUser,
    activeSessionTab,
    setActiveSessionTab,
    sessionTabItems,
    handleTitleChange,
    commentRevisionConflict,
    handleUseLatestComment,
    handleKeepMineComment,
  } = contentState;
  const {
    creatorName,
    normalizedRawDescription,
    displayedDescription,
    isGitHubWorkItem,
    canEditDescription,
    githubTimeline,
    githubTimelineLoading,
    githubTimelineError,
    descriptionEditing,
    sectionPolicy,
    isThread,
    isEditingThreadDescription,
  } = contentModel;

  const descriptionSection = (
    <WorkItemDescriptionSection
      workItem={workItem}
      isThread={isThread}
      isGitHubWorkItem={isGitHubWorkItem}
      canEditDescription={canEditDescription}
      isEditingThreadDescription={isEditingThreadDescription}
      githubIssueInteraction={githubIssueInteraction}
      githubTimeline={githubTimeline}
      githubTimelineLoading={githubTimelineLoading}
      githubTimelineError={githubTimelineError}
      creatorName={creatorName}
      normalizedRawDescription={normalizedRawDescription}
      displayedDescription={displayedDescription}
      descriptionEditing={descriptionEditing}
      handleTitleChange={handleTitleChange}
      handleImageInsert={handleImageInsert}
      editorRef={editorRef}
      titleVisible={titleVisible}
      repoPath={repoPath}
    />
  );

  const subItemsSection = !isGitHubWorkItem ? (
    <ScrollTrailTarget enabled={isThread} label={t("workItems.subItems.title")}>
      <WorkItemSubItems
        family={subItemFamily}
        parentShortId={shortId ?? workItem.shortId ?? ""}
        projectSlug={projectSlug}
        orgId={orgId}
        onOpenWorkItem={onOpenSubItem}
      />
    </ScrollTrailTarget>
  ) : null;

  const customPropertiesSection = !isGitHubWorkItem ? (
    <ScrollTrailTarget
      enabled={isThread}
      label={t("workItems.properties.title", {
        defaultValue: "Custom properties",
      })}
    >
      <CustomPropertiesSection
        projectSlug={projectSlug}
        orgId={orgId}
        shortId={shortId ?? workItem.shortId}
        members={teamMembers}
        editable={Boolean(onUpdateWorkItem)}
      />
    </ScrollTrailTarget>
  ) : null;

  const quickActionsSection = !isGitHubWorkItem ? (
    <QuickActionsSection
      orgId={orgId || "personal-org"}
      projectSlug={projectSlug ?? null}
      shortId={shortId ?? workItem.shortId ?? ""}
      currentUser={currentUser}
      agents={mentionAgents.map((agent) => ({
        id: agent.id,
        name: agent.name,
      }))}
      agentOrgs={availableOrgs.map((org) => ({ id: org.id, name: org.name }))}
      disabled={!onUpdateWorkItem}
      onInvoked={onRefreshWorkflow}
    />
  ) : null;

  const outputContent = (
    <OutputTab
      workItem={workItem}
      repoPath={repoPath}
      projectSlug={projectSlug}
      shortId={shortId ?? workItem.shortId}
      orgId={orgId}
      onOpenFileDiff={onOpenFileDiff}
      onReviewAllFiles={onReviewAllFiles}
      onCreatePr={onCreatePr}
    />
  );

  const commentConflictModal = (
    <RevisionConflictModal
      conflict={
        commentRevisionConflict
          ? {
              fieldLabel: t("workItems.revisionConflict.commentField"),
              mine: commentRevisionConflict.mine,
              latest: commentRevisionConflict.latest,
              expectedRevision: commentRevisionConflict.expectedRevision,
              actualRevision: commentRevisionConflict.actualRevision,
            }
          : null
      }
      onUseLatest={handleUseLatestComment}
      onKeepMine={handleKeepMineComment}
    />
  );

  const tabbedLowerSection = (
    <WorkItemTabbedLowerSection
      workItem={workItem}
      shortId={shortId ?? workItem.shortId}
      projectSlug={projectSlug}
      orgId={orgId}
      activeAgentSessionId={activeAgentSessionId}
      onOpenSession={onOpenSession}
      sectionPolicy={sectionPolicy}
      outputContent={outputContent}
      sessionTabItems={sessionTabItems}
      activeSessionTab={activeSessionTab}
      setActiveSessionTab={setActiveSessionTab}
      historyContent={historyContent}
    />
  );

  const threadLowerSection = (
    <WorkItemThreadLowerSection
      workItem={workItem}
      shortId={shortId ?? workItem.shortId}
      projectSlug={projectSlug}
      orgId={orgId}
      activeAgentSessionId={activeAgentSessionId}
      onOpenSession={onOpenSession}
      sectionPolicy={sectionPolicy}
      outputContent={outputContent}
      isThread={isThread}
      isGitHubWorkItem={isGitHubWorkItem}
    />
  );

  return {
    descriptionSection,
    subItemsSection,
    customPropertiesSection,
    quickActionsSection,
    commentConflictModal,
    tabbedLowerSection,
    threadLowerSection,
  };
}

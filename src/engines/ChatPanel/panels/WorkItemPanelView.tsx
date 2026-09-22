import { useAtomValue } from "jotai";
import React, { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { STORY_SYNC_ADAPTER } from "@src/api/http/integrations/syncConnections";
import { ToolbarTooltip } from "@src/components/KeyboardShortcut/ToolbarTooltip";
import {
  PersistentDetailTabPanel,
  WorkstationTrailIconButton,
  WorkstationTrailSurface,
} from "@src/components/layout/blocks";
import LazyGitHubLinkedReferences from "@src/features/GitHubWork/GitHubLinkedReferences/lazy";
import type { ThreadDetailTab } from "@src/features/GitHubWork/ThreadDetailTabs";
import { useProjectDataChanged } from "@src/hooks/project";
import { useCurrentUserMemberIds } from "@src/hooks/project/useCurrentUserMemberId";
import { useDetailRailLayout } from "@src/hooks/ui/layout/useDetailRailLayout";
import { ArrowRightDoubleIcon, HugeiconsIcon } from "@src/icons";
import { WorkItemThreadSurface } from "@src/modules/ProjectManager/WorkItems/components";
import RevisionConflictModal from "@src/modules/ProjectManager/WorkItems/components/RevisionConflictModal";
import WorkItemProperties from "@src/modules/ProjectManager/WorkItems/components/WorkItemProperties";
import { WorkItemThreadNavigationPortalContext } from "@src/modules/ProjectManager/WorkItems/components/WorkItemThread";
import {
  PropertiesPanel,
  PropertiesRailFrame,
} from "@src/modules/ProjectManager/shared";
import type { ChatPanelSelectedWorkItem } from "@src/store/ui/chatPanel/selectionAtoms";
import { activeWorkspaceRootPathAtom } from "@src/store/workspace";
import type { WorkItem } from "@src/types/core/workItem";

import { useWorkItemGitHubIssueState } from "./useWorkItemGitHubIssueState";
import { useWorkItemPanelHeader } from "./workItemPanel/useWorkItemPanelHeader";
import { useWorkItemPanelLinkedReferences } from "./workItemPanel/useWorkItemPanelLinkedReferences";
import { useWorkItemPanelMutations } from "./workItemPanel/useWorkItemPanelMutations";
import { useWorkItemPanelNavigation } from "./workItemPanel/useWorkItemPanelNavigation";
import { useWorkItemPanelRevisionConflict } from "./workItemPanel/useWorkItemPanelRevisionConflict";
import { useWorkItemPanelSyncState } from "./workItemPanel/useWorkItemPanelSyncState";

interface WorkItemPanelViewProps {
  selectedWorkItem: ChatPanelSelectedWorkItem;
  onUpdateWorkItem?: (updates: Partial<WorkItem>) => void;
  onClose?: () => void;
}

export const WorkItemPanelView: React.FC<WorkItemPanelViewProps> = ({
  selectedWorkItem,
  onUpdateWorkItem,
  onClose,
}) => {
  const { t } = useTranslation(["projects", "common"]);
  const activeWorkspaceRootPath = useAtomValue(activeWorkspaceRootPathAtom);
  const [propertiesOpen, setPropertiesOpen] = useState(true);
  const { paneRef, inlineRail } = useDetailRailLayout(propertiesOpen);
  const [tabSelection, setTabSelection] = useState<{
    workItemId: string;
    activeTab: ThreadDetailTab;
  }>({
    workItemId: selectedWorkItem.workItem.session_id,
    activeTab: "conversation",
  });
  const [navigationTrailHost, setNavigationTrailHost] =
    useState<HTMLDivElement | null>(null);
  const workItemMembers = useMemo(
    () => [
      ...(selectedWorkItem.sourceProject?.project.members ?? []),
      ...(selectedWorkItem.workItem.assignee
        ? [selectedWorkItem.workItem.assignee]
        : []),
    ],
    [
      selectedWorkItem.sourceProject?.project.members,
      selectedWorkItem.workItem.assignee,
    ]
  );
  const { currentUser } = useCurrentUserMemberIds(workItemMembers);

  const {
    revisionConflict,
    handleRevisionConflict,
    handleUseLatest,
    handleKeepMine,
  } = useWorkItemPanelRevisionConflict({ selectedWorkItem, currentUser });

  const {
    projectSyncAdapterId,
    isGitHubSyncedProject,
    isGitHubWorkItem,
    projectSelectionReadonly,
  } = useWorkItemPanelSyncState(selectedWorkItem);

  const {
    handleUpdateWorkItem,
    refreshSelectedWorkItem,
    handleDeleteWorkItem,
  } = useWorkItemPanelMutations({
    selectedWorkItem,
    onUpdateWorkItem,
    currentUser,
    handleRevisionConflict,
    t,
  });

  useProjectDataChanged(
    useCallback(
      (change) => {
        if (
          change?.projectSlug &&
          change.projectSlug !== selectedWorkItem.projectSlug
        ) {
          return;
        }
        if (
          change?.workItemId &&
          change.workItemId !== selectedWorkItem.shortId
        ) {
          return;
        }
        void refreshSelectedWorkItem();
      },
      [
        refreshSelectedWorkItem,
        selectedWorkItem.projectSlug,
        selectedWorkItem.shortId,
      ]
    ),
    // A detail surface can mount from a cached navigation payload after the
    // mutation signal already fired. Refreshing on mount closes that race;
    // subsequent signals keep the open panel live.
    { fireOnMount: true }
  );

  const repoPath =
    selectedWorkItem.sourceProject?.project.linkedRepos?.[0]?.id ??
    activeWorkspaceRootPath ??
    null;

  const { handleOpenSession, handleOpenFamilyItem } =
    useWorkItemPanelNavigation(selectedWorkItem);

  const workItemContentKey = `${selectedWorkItem.projectSlug}:${
    selectedWorkItem.shortId || selectedWorkItem.workItem.session_id
  }`;
  const githubIssueState = useWorkItemGitHubIssueState({
    enabled: isGitHubWorkItem,
    repoPath,
    shortId: selectedWorkItem.shortId,
    stateScopeKey: `chat-panel-work-item:${selectedWorkItem.orgId ?? "local"}:${selectedWorkItem.projectSlug}:${selectedWorkItem.shortId}`,
  });
  const githubIssueExternalUrl = githubIssueState.externalUrl;
  const activeDetailTab =
    tabSelection.workItemId === selectedWorkItem.workItem.session_id
      ? tabSelection.activeTab
      : "conversation";
  const { defaultRepoFullName, linkedReferences } =
    useWorkItemPanelLinkedReferences({
      workItem: selectedWorkItem.workItem,
      githubIssueExternalUrl,
      githubTimelineItems: githubIssueState.timeline?.items,
    });
  const handleDetailTabChange = useCallback(
    (nextTab: ThreadDetailTab) => {
      setTabSelection({
        workItemId: selectedWorkItem.workItem.session_id,
        activeTab: nextTab,
      });
    },
    [selectedWorkItem.workItem.session_id]
  );

  const toggleProperties = useCallback(() => {
    setPropertiesOpen((current) => !current);
  }, []);
  const propertiesToggleLabel = propertiesOpen
    ? t("projects:workItems.hideProperties")
    : t("projects:workItems.showProperties");

  useWorkItemPanelHeader({
    selectedWorkItem,
    projectSyncAdapterId,
    isGitHubSyncedProject,
    isGitHubWorkItem,
    githubIssueExternalUrl,
    propertiesOpen,
    propertiesToggleLabel,
    toggleProperties,
    handleDeleteWorkItem,
    handleUpdateWorkItem,
    activeDetailTab,
    linkedReferencesCount: linkedReferences.length,
    handleDetailTabChange,
    onClose,
    t,
  });

  const propertiesContent = (
    <WorkstationTrailSurface className="flex self-start">
      <PropertiesPanel
        title={t("projects:workItems.properties.title")}
        fitContent
        headerVariant="workstation-trail"
        headerActions={
          <ToolbarTooltip label={propertiesToggleLabel}>
            <WorkstationTrailIconButton
              onClick={toggleProperties}
              aria-label={propertiesToggleLabel}
              data-testid="chat-panel-work-item-properties-collapse"
            >
              <HugeiconsIcon
                icon={ArrowRightDoubleIcon}
                data-icon="chevrons-right"
                size={14}
                strokeWidth={1.75}
              />
            </WorkstationTrailIconButton>
          </ToolbarTooltip>
        }
      >
        <WorkItemProperties
          statusOrgId={selectedWorkItem.orgId ?? "personal-org"}
          workItem={selectedWorkItem.workItem}
          onUpdate={handleUpdateWorkItem}
          availableProjects={
            selectedWorkItem.workItem.project
              ? [selectedWorkItem.workItem.project]
              : []
          }
          availableMilestones={
            selectedWorkItem.workItem.milestone
              ? [selectedWorkItem.workItem.milestone]
              : []
          }
          availableLabels={selectedWorkItem.workItem.labels ?? []}
          availableMembers={workItemMembers}
          projectIconType={
            isGitHubSyncedProject ? STORY_SYNC_ADAPTER.GITHUB : undefined
          }
          projectReadonly={projectSelectionReadonly}
          panelVariant="workstation-trail"
        />
      </PropertiesPanel>
    </WorkstationTrailSurface>
  );
  const propertiesPanel = (
    <PropertiesRailFrame floatingContent>
      {propertiesContent}
      <div
        ref={setNavigationTrailHost}
        className="pointer-events-none relative ml-auto min-h-0 w-11 flex-1"
        data-testid="chat-panel-work-item-navigation-trail-host"
      />
    </PropertiesRailFrame>
  );

  return (
    <WorkItemThreadNavigationPortalContext.Provider
      value={inlineRail ? null : navigationTrailHost}
    >
      <div
        className="relative flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden"
        ref={paneRef}
        data-testid="chat-panel-work-item-detail"
      >
        {propertiesOpen && inlineRail && activeDetailTab !== "conversation" ? (
          <div className="max-h-64 shrink-0 overflow-y-auto px-4 py-4">
            {propertiesContent}
          </div>
        ) : null}
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <div className="min-w-0 flex-1 overflow-hidden">
            <div className="flex h-full min-h-0 flex-col overflow-hidden">
              <PersistentDetailTabPanel
                active={activeDetailTab === "conversation"}
                id="chat-panel-work-item-detail-tabpanel-conversation"
                ariaLabelledBy="chat-panel-work-item-detail-tab-conversation"
                className="min-h-0 min-w-0 overflow-hidden"
              >
                <WorkItemThreadSurface
                  key={workItemContentKey}
                  headerProperties={
                    propertiesOpen &&
                    inlineRail &&
                    activeDetailTab === "conversation"
                      ? propertiesContent
                      : undefined
                  }
                  workItem={selectedWorkItem.workItem}
                  onUpdateWorkItem={handleUpdateWorkItem}
                  onUpdateWorkItemImmediate={handleUpdateWorkItem}
                  currentUser={currentUser ?? undefined}
                  teamMembers={workItemMembers}
                  repoPath={repoPath}
                  projectSlug={selectedWorkItem.projectSlug || undefined}
                  shortId={selectedWorkItem.shortId}
                  orgId={selectedWorkItem.orgId}
                  githubIssueTimeline={githubIssueState.timeline}
                  githubIssueInteraction={githubIssueState.interaction}
                  onOpenSession={handleOpenSession}
                  onOpenSubItem={handleOpenFamilyItem}
                  onRefreshWorkflow={refreshSelectedWorkItem}
                />
              </PersistentDetailTabPanel>
              <PersistentDetailTabPanel
                active={activeDetailTab === "linked"}
                id="chat-panel-work-item-detail-tabpanel-linked"
                ariaLabelledBy="chat-panel-work-item-detail-tab-linked"
                className="min-h-0 min-w-0 flex-col overflow-hidden"
              >
                <LazyGitHubLinkedReferences
                  references={linkedReferences}
                  repoPath={repoPath}
                  defaultRepoFullName={defaultRepoFullName}
                  enabled={activeDetailTab === "linked"}
                />
              </PersistentDetailTabPanel>
            </div>
          </div>
          {propertiesOpen && !inlineRail ? propertiesPanel : null}
        </div>
      </div>
      <RevisionConflictModal
        conflict={
          revisionConflict
            ? {
                fieldLabel: t(
                  revisionConflict.field === "title"
                    ? "projects:workItems.revisionConflict.titleField"
                    : "projects:workItems.revisionConflict.descriptionField"
                ),
                mine: revisionConflict.mine,
                latest: revisionConflict.latest,
                expectedRevision: revisionConflict.expectedRevision,
                actualRevision: revisionConflict.actualRevision,
              }
            : null
        }
        onUseLatest={handleUseLatest}
        onKeepMine={handleKeepMine}
      />
    </WorkItemThreadNavigationPortalContext.Provider>
  );
};

export default WorkItemPanelView;

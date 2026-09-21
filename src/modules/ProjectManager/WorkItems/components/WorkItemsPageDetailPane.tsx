import React, { type Dispatch, type SetStateAction } from "react";

import { STORY_SYNC_ADAPTER } from "@src/api/http/integrations/syncConnections";

import type { useWorkItems } from "../hooks/useWorkItems";
import type { useWorkItemsPageIntegrations } from "../hooks/useWorkItemsPageIntegrations";
import type { useWorkItemsPageInteractions } from "../hooks/useWorkItemsPageInteractions";
import type { useWorkItemsPageScope } from "../hooks/useWorkItemsPageScope";
import type { WorkItemsPageProps } from "../workItemsPageProps";
import EmbeddedWorkItemDetail from "./EmbeddedWorkItemDetail";

type WorkItemsPage = ReturnType<typeof useWorkItems>;
type EmbeddedWorkItemDetailProps = React.ComponentProps<
  typeof EmbeddedWorkItemDetail
>;

interface WorkItemsPageDetailPaneProps extends Pick<
  WorkItemsPageProps,
  "onExpandWorkItemToTab" | "onOpenChatSession" | "workstationHeaderHost"
> {
  data: WorkItemsPage["data"];
  projectData: WorkItemsPage["projectData"];
  scope: ReturnType<typeof useWorkItemsPageScope>;
  interactions: ReturnType<typeof useWorkItemsPageInteractions>;
  projectSyncAdapterId: ReturnType<
    typeof useWorkItemsPageIntegrations
  >["projectSyncAdapterId"];
  onNavigate: EmbeddedWorkItemDetailProps["onNavigate"];
  onUpdateWorkItem: EmbeddedWorkItemDetailProps["onUpdateWorkItem"];
  onPendingChangesChange: EmbeddedWorkItemDetailProps["onPendingChangesChange"];
  propertiesOpen: boolean;
  setPropertiesOpen: Dispatch<SetStateAction<boolean>>;
}

/**
 * The selected work item in the page's reusable right-hand detail pane, with
 * the project breadcrumb and its own properties toggle.
 */
const WorkItemsPageDetailPane: React.FC<WorkItemsPageDetailPaneProps> = ({
  data,
  projectData,
  scope,
  interactions,
  projectSyncAdapterId,
  onNavigate,
  onUpdateWorkItem,
  onPendingChangesChange,
  propertiesOpen,
  setPropertiesOpen,
  onExpandWorkItemToTab,
  onOpenChatSession,
  workstationHeaderHost,
}) => {
  const {
    headerTitle,
    interactiveBreadcrumbSegments,
    resolvedRepoPath,
    resolvedProjectSlug,
    projectIdentityIcon,
    selectedShortId,
  } = scope;
  const {
    handleDeleteWorkItem,
    handleCloseDetail,
    handleOpenSelectedWorkItemInNewTab,
    propertyOrgId,
  } = interactions;

  return (
    <EmbeddedWorkItemDetail
      workItem={data.selectedWorkItem ?? null}
      onClose={handleCloseDetail}
      onOpenInNewTab={
        onExpandWorkItemToTab ? handleOpenSelectedWorkItemInNewTab : undefined
      }
      onNavigate={onNavigate}
      hasPrev={data.navigation.hasPrev}
      hasNext={data.navigation.hasNext}
      onUpdateWorkItem={onUpdateWorkItem}
      onDeleteWorkItem={handleDeleteWorkItem}
      availableMembers={projectData.availableMembers}
      availableProjects={projectData.availableProjects}
      availableMilestones={projectData.availableMilestones}
      availableLabels={projectData.availableLabels}
      onPendingChangesChange={onPendingChangesChange}
      repoPath={resolvedRepoPath}
      projectSlug={resolvedProjectSlug}
      orgId={propertyOrgId}
      shortId={selectedShortId}
      onRefreshWorkItem={data.refresh}
      onOpenSession={onOpenChatSession}
      breadcrumbSegments={interactiveBreadcrumbSegments}
      breadcrumbProjectName={headerTitle}
      breadcrumbIcon={projectIdentityIcon}
      titleEditable={
        projectSyncAdapterId !== undefined &&
        projectSyncAdapterId !== STORY_SYNC_ADAPTER.GITHUB
      }
      propertiesOpen={propertiesOpen}
      onToggleProperties={() => setPropertiesOpen((prev) => !prev)}
      publishHeaderToWorkstation={false}
      workstationHeaderHost={workstationHeaderHost}
    />
  );
};

export default WorkItemsPageDetailPane;

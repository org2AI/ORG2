import React from "react";

import type { useWorkItems } from "../hooks/useWorkItems";
import type { useWorkItemsPageIntegrations } from "../hooks/useWorkItemsPageIntegrations";
import type { useWorkItemsPageInteractions } from "../hooks/useWorkItemsPageInteractions";
import type { useWorkItemsPageScope } from "../hooks/useWorkItemsPageScope";
import type { useWorkItemsPageViewControls } from "../hooks/useWorkItemsPageViewControls";
import type { WorkItemsPageProps } from "../workItemsPageProps";
import WorkItemsPageHeader from "./WorkItemsPageHeader";
import type { WorkItemsPageHeaderProps } from "./WorkItemsPageHeader/types";

type WorkItemsPage = ReturnType<typeof useWorkItems>;

interface WorkItemsPageHeaderBarProps extends Pick<
  WorkItemsPageProps,
  | "onOpenProjects"
  | "onCreateProject"
  | "splitHeaderLeading"
  | "workstationHeaderHost"
> {
  state: WorkItemsPage["state"];
  data: WorkItemsPage["data"];
  scope: ReturnType<typeof useWorkItemsPageScope>;
  interactions: ReturnType<typeof useWorkItemsPageInteractions>;
  viewControls: ReturnType<typeof useWorkItemsPageViewControls>;
  integrations: ReturnType<typeof useWorkItemsPageIntegrations>;
  onToggleProperties: WorkItemsPageHeaderProps["onToggleProperties"];
  addWorkItemAction: WorkItemsPageHeaderProps["onAddWorkItem"];
  isActive: boolean;
}

/**
 * The Work Items page header: breadcrumb and identity, surface / search /
 * end controls, status filter, and the page-level actions.
 */
const WorkItemsPageHeaderBar: React.FC<WorkItemsPageHeaderBarProps> = ({
  state,
  data,
  scope,
  interactions,
  viewControls,
  integrations,
  onToggleProperties,
  addWorkItemAction,
  onOpenProjects,
  onCreateProject,
  splitHeaderLeading,
  isActive,
  workstationHeaderHost,
}) => {
  const {
    headerTitle,
    interactiveBreadcrumbSegments,
    projectIdentityIcon,
    statusFilterKeys,
    useSplitListHeader,
    isWorkItemsSurface,
  } = scope;
  const { handleCollapseAll, handleStatusFilterChange } = interactions;
  const {
    projectSurfaceControls,
    workItemsSearchControl,
    workItemsEndControl,
  } = viewControls;
  const { tabBarActionsInStationTabBar, propertiesActionAvailable } =
    integrations;

  return (
    <WorkItemsPageHeader
      projectName={headerTitle}
      breadcrumbSegments={interactiveBreadcrumbSegments}
      identityIcon={projectIdentityIcon}
      onOpenProjects={onOpenProjects}
      activeTab={state.activeTab}
      leadingControls={projectSurfaceControls}
      trailingControls={workItemsSearchControl}
      statusFilter={isWorkItemsSurface ? state.statusFilter : undefined}
      onStatusFilterChange={
        isWorkItemsSurface ? handleStatusFilterChange : undefined
      }
      statusCounts={data.statusCounts}
      statusFilterKeys={statusFilterKeys}
      onCollapseAll={isWorkItemsSurface ? handleCollapseAll : undefined}
      showProperties={
        propertiesActionAvailable ? state.showProperties : undefined
      }
      onToggleProperties={
        propertiesActionAvailable ? onToggleProperties : undefined
      }
      onAddProject={
        isWorkItemsSurface && state.activeTab !== "Settings"
          ? onCreateProject
          : undefined
      }
      onAddWorkItem={addWorkItemAction}
      onRefresh={isWorkItemsSurface ? data.refresh : undefined}
      refreshLoading={data.loading}
      endControls={workItemsEndControl}
      splitListHeader={useSplitListHeader}
      splitHeaderLeading={splitHeaderLeading}
      publishToWorkstationHeader={tabBarActionsInStationTabBar && isActive}
      workstationHeaderHost={workstationHeaderHost}
    />
  );
};

export default WorkItemsPageHeaderBar;

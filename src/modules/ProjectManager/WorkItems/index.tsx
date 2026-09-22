import React, { useCallback, useState } from "react";

import { useProjectOrgCloudPermissions } from "@src/features/Org2Cloud/useProjectOrgCloudPermissions";
import { PROJECT_DETAIL_SURFACE_VIEW } from "@src/store/workstation/tabs";

import { MultiSelectBar } from "./components";
import WorkItemsPageDetailPane from "./components/WorkItemsPageDetailPane";
import WorkItemsPageDialogs from "./components/WorkItemsPageDialogs";
import WorkItemsPageHeaderBar from "./components/WorkItemsPageHeaderBar";
import WorkItemsPageTabContent from "./components/WorkItemsPageTabContent";
import { useWorkItems } from "./hooks/useWorkItems";
import { useWorkItemsPageIntegrations } from "./hooks/useWorkItemsPageIntegrations";
import { useWorkItemsPageInteractions } from "./hooks/useWorkItemsPageInteractions";
import { useWorkItemsPageScope } from "./hooks/useWorkItemsPageScope";
import { useWorkItemsPageSelection } from "./hooks/useWorkItemsPageSelection";
import { useWorkItemsPageViewControls } from "./hooks/useWorkItemsPageViewControls";
import { useWorkItemsProjectPanes } from "./hooks/useWorkItemsProjectPanes";
import { WORK_ITEMS_DEFAULT_STATUS } from "./types";
import type { WorkItemsPageProps } from "./workItemsPageProps";

// ============================================
// Types
// ============================================

export type { EmbeddedWorkItemDetailState } from "./hooks/useWorkItemsTabBarState";
export type { WorkItemsPageProps } from "./workItemsPageProps";

// ============================================
// Main Component
// ============================================

const WorkItemsPage: React.FC<WorkItemsPageProps> = ({
  breadcrumbSegments,
  projectId,
  projectName: tabProjectName,
  pageTitle,
  cachedProjectSlug,
  repoPath,
  projectView = PROJECT_DETAIL_SURFACE_VIEW.WORK_ITEMS,
  onProjectViewChange,
  onProjectSlugResolved,
  onOpenProjects,
  onCreateProject,
  onCreateWorkItem,
  onProjectDeleted,
  onSetUnsaved,
  onProjectNameUpdated,
  onOpenRepoSettings,
  onExpandWorkItemToTab,
  onOpenChatSession,
  onEmbeddedWorkItemDetailStateChange,
  isActive = true,
  workStationTabId,
  workstationHeaderHost = "project",
  splitHeaderLeading,
}) => {
  const { canAdminister: canAdministerProjectOrg } =
    useProjectOrgCloudPermissions(isActive);
  const workItems = useWorkItems({
    projectId,
    cachedProjectSlug,
    initialActiveTab:
      projectView === PROJECT_DETAIL_SURFACE_VIEW.OVERVIEW
        ? "Overview"
        : "List",
    isActive,
  });
  const { state, data, projectData, handlers } = workItems;
  const [collapseAllSignal, setCollapseAllSignal] = useState(0);
  const [listFullscreen, setListFullscreen] = useState(false);
  // Track work item detail pending changes
  const [hasWorkItemPendingChanges, setHasWorkItemPendingChanges] =
    useState(false);
  const [workItemPropertiesOpen, setWorkItemPropertiesOpen] = useState(true);

  const scope = useWorkItemsPageScope({
    workItems,
    breadcrumbSegments,
    pageTitle,
    tabProjectName,
    onOpenProjects,
    onProjectSlugResolved,
    isActive,
    listFullscreen,
  });
  const {
    projectName,
    sourceProject,
    availableRepos,
    resolvedProjectSlug,
    useSplitListHeader,
    settingsSectionRequest,
  } = scope;

  const interactions = useWorkItemsPageInteractions({
    workItems,
    cachedProjectSlug,
    isActive,
    setListFullscreen,
    setCollapseAllSignal,
    setHasWorkItemPendingChanges,
    onProjectViewChange,
    onExpandWorkItemToTab,
  });
  const { confirmWorkItemDelete } = interactions;

  const selection = useWorkItemsPageSelection({
    data,
    filteredWorkItems: interactions.propertyFilteredWorkItems,
    onDelete: handlers.handleDelete,
    projectSlug: projectData.project?.slug,
    onBatchDeleteComplete: data.refresh,
    onBeforeDelete: () => confirmWorkItemDelete(),
  });
  const { handleBulkDelete } = selection;

  const integrations = useWorkItemsPageIntegrations({
    workItems,
    projectName,
    onProjectDeleted,
    resolvedProjectSlug,
    isActive,
    workStationTabId,
    projectId,
    onCreateWorkItem,
    onAddListItem: handlers.handleAddListItem,
    onEmbeddedWorkItemDetailStateChange,
  });
  const { handleDeleteProject } = integrations;

  const detailContent = (
    <WorkItemsPageDetailPane
      data={data}
      projectData={projectData}
      scope={scope}
      interactions={interactions}
      projectSyncAdapterId={integrations.projectSyncAdapterId}
      onNavigate={handlers.handleNavigate}
      onUpdateWorkItem={handlers.handleUpdate}
      onPendingChangesChange={setHasWorkItemPendingChanges}
      propertiesOpen={workItemPropertiesOpen}
      setPropertiesOpen={setWorkItemPropertiesOpen}
      onExpandWorkItemToTab={onExpandWorkItemToTab}
      onOpenChatSession={onOpenChatSession}
      workstationHeaderHost={workstationHeaderHost}
    />
  );

  const projectPanes = useWorkItemsProjectPanes({
    projectId,
    projectName,
    sourceProject,
    onProjectUpdate: handlers.handleProjectUpdate,
    hasWorkItemPendingChanges,
    onSetUnsaved,
    onProjectNameUpdated,
    projectData,
    availableRepos,
    resolvedProjectSlug,
    canAdministerProjectOrg,
    handleDeleteProject,
    onOpenRepoSettings,
    settingsSectionRequest,
  });
  const { displayProject } = projectPanes;

  const viewControls = useWorkItemsPageViewControls({
    state,
    scope,
    interactions,
    orgId: displayProject.orgId ?? "personal-org",
    listFullscreen,
    setListFullscreen,
    availableMembers: projectData.availableMembers,
  });

  const addListItem = handlers.handleAddListItem;
  const handleCreateWorkItem = useCallback(() => {
    if (onCreateWorkItem) {
      onCreateWorkItem(
        projectId,
        projectName,
        resolvedProjectSlug ?? projectId
      );
      return;
    }
    void addListItem(WORK_ITEMS_DEFAULT_STATUS);
  }, [
    addListItem,
    onCreateWorkItem,
    projectId,
    projectName,
    resolvedProjectSlug,
  ]);
  const addWorkItemAction =
    state.activeTab !== "Settings" ? handleCreateWorkItem : undefined;

  const workItemsHeader = (
    <WorkItemsPageHeaderBar
      state={state}
      data={data}
      scope={scope}
      interactions={interactions}
      viewControls={viewControls}
      integrations={integrations}
      onToggleProperties={handlers.handleToggleProperties}
      addWorkItemAction={addWorkItemAction}
      onOpenProjects={onOpenProjects}
      onCreateProject={onCreateProject}
      splitHeaderLeading={splitHeaderLeading}
      isActive={isActive}
      workstationHeaderHost={workstationHeaderHost}
    />
  );

  // The project header stays mounted while the selected work item opens in the
  // reusable right-hand detail pane.
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {!useSplitListHeader && workItemsHeader}

      {/* Content Area */}
      <div className="min-h-0 flex-1 overflow-hidden">
        <WorkItemsPageTabContent
          state={state}
          data={data}
          projectData={projectData}
          scope={scope}
          interactions={interactions}
          selection={selection}
          integrations={integrations}
          projectPanes={projectPanes}
          viewControls={viewControls}
          repoPath={repoPath}
          listFullscreen={listFullscreen}
          collapseAllSignal={collapseAllSignal}
          workItemsHeader={workItemsHeader}
          detailContent={detailContent}
          onUpdateWorkItem={handlers.handleUpdate}
          onRestoreWorkItem={handlers.handleRestore}
          onAddListItem={handlers.handleAddListItem}
          onKanbanTaskMove={handlers.handleKanbanTaskMove}
          onAddKanbanTask={handlers.handleAddTask}
          onGanttTaskUpdate={handlers.handleGanttTaskUpdate}
        />
      </div>

      <MultiSelectBar
        selectedCount={selection.selectedIds.size}
        visibleItemCount={interactions.propertyFilteredWorkItems.length}
        deleting={selection.bulkDeleting}
        onSelectAll={selection.handleSelectAll}
        onUnselectAll={selection.handleUnselectAll}
        onDelete={handleBulkDelete}
        onSetProperty={() => selection.setBatchPropertyOpen(true)}
        onSetStatus={() => selection.setBatchQuickField("status")}
        onSetPriority={() => selection.setBatchQuickField("priority")}
        onSetAssignee={() => selection.setBatchQuickField("assignee")}
      />
      <WorkItemsPageDialogs
        orgId={displayProject.orgId ?? "personal-org"}
        projectSlug={resolvedProjectSlug ?? null}
        shortIds={selection.selectedShortIds}
        members={projectData.availableMembers}
        batchPropertyOpen={selection.batchPropertyOpen}
        onCloseBatchProperty={() => selection.setBatchPropertyOpen(false)}
        batchQuickField={selection.batchQuickField}
        onCloseBatchQuickField={() => selection.setBatchQuickField(null)}
        onUnselectAll={selection.handleUnselectAll}
        refreshWorkItems={data.refresh}
        refreshPropertyView={interactions.propertyView.refresh}
        revisionConflict={data.revisionConflict}
        onUseLatestRevisionConflict={data.useLatestRevisionConflict}
        onKeepMineRevisionConflict={data.keepMineRevisionConflict}
      />
    </div>
  );
};

export default WorkItemsPage;

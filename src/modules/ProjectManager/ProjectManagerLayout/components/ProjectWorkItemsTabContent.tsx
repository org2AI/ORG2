import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { HEADER_ICON_SIZE } from "@src/config/workstation/tokens";
import { HugeiconsIcon, ListTodoIcon } from "@src/icons";
import WorkItemsCompactList from "@src/modules/ProjectManager/WorkItems/components/WorkItemsCompactList";
import { MultiSelectBar } from "@src/modules/ProjectManager/WorkItems/components/WorkItemsFooterBars";
import WorkItemsPageHeader from "@src/modules/ProjectManager/WorkItems/components/WorkItemsPageHeader";
import type {
  StatusCounts,
  StatusFilterType,
} from "@src/modules/ProjectManager/WorkItems/types";
import {
  WORK_ITEMS_KANBAN_GROUP,
  type WorkItemsKanbanGroup,
  countWorkspaceWorkItemsByStatus,
  filterWorkItemsBySearchQuery,
  filterWorkspaceWorkItemsByStatus,
  getWorkspaceStatusFilterKeysForWorkItems,
  normalizeWorkspaceStatusFilter,
} from "@src/modules/ProjectManager/WorkItems/workItemsViewModel";
import { useProjectManagerWorkItemsTabBarRegistration } from "@src/modules/ProjectManager/hooks/useProjectManagerWorkItemsTabBarRegistration";
import { WORKSPACE_SOURCE } from "@src/modules/ProjectManager/workspaceAggregate";
import InboxListDetailLayout from "@src/scaffold/layouts/InboxListDetailLayout";

import {
  ProjectWorkItemsDetailPane,
  ProjectWorkItemsListPane,
} from "./ProjectWorkItemsTabContentPanes";
import type {
  AggregatedWorkItem,
  ProjectWorkItemsTabContentProps,
  ProjectWorkItemsViewTab,
} from "./ProjectWorkItemsTabContentTypes";
import { useProjectWorkItemsTabContentHeaderControls } from "./useProjectWorkItemsTabContentHeaderControls";
import { useProjectWorkItemsTabContentInteractions } from "./useProjectWorkItemsTabContentInteractions";
import { useProjectWorkItemsTabContentTableRows } from "./useProjectWorkItemsTabContentTableRows";
import { useProjectWorkItemsTabContentWorkspaceData } from "./useProjectWorkItemsTabContentWorkspaceData";

export type {
  ProjectWorkItemSelection,
  ProjectWorkItemsTabContentProps,
} from "./ProjectWorkItemsTabContentTypes";

export const ProjectWorkItemsTabContent: React.FC<
  ProjectWorkItemsTabContentProps
> = ({
  breadcrumbSegments,
  workStationTabId,
  workstationHeaderHost = "project",
  shellLeadingChromeHidden = false,
  onOpenProjects,
  onCreateProject,
  onCreateWorkItem,
  onOpenLinearProject,
  orgId,
  allowExternalSources = false,
  onOpenWorkItem,
  orgSurfaceControls,
  splitHeaderLeading,
}) => {
  const { t } = useTranslation("projects");
  const [activeViewTab, setActiveViewTab] =
    useState<ProjectWorkItemsViewTab>("List");
  const [statusFilter, setStatusFilter] = useState<StatusFilterType>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedWorkItemId, setSelectedWorkItemId] = useState<string | null>(
    null
  );
  const [listFullscreen, setListFullscreen] = useState(false);
  const useSplitListHeader = activeViewTab === "List" && !listFullscreen;
  const [kanbanGroupBy, setKanbanGroupBy] = useState<WorkItemsKanbanGroup>(
    WORK_ITEMS_KANBAN_GROUP.STATUS
  );

  const {
    workItemsByProject,
    setWorkItemsByProject,
    projectOptions,
    loading,
    loaded,
    error,
    completedItemsLoading,
    completedItemsError,
    loadWorkItems,
    loadCompletedWorkItems,
    workspaceSourceMode,
    setWorkspaceSourceMode,
  } = useProjectWorkItemsTabContentWorkspaceData({
    orgId,
    allowExternalSources,
    t,
  });

  useEffect(() => {
    if (statusFilter === "done" || statusFilter === "closed") {
      void loadCompletedWorkItems();
    }
  }, [loadCompletedWorkItems, statusFilter]);

  const workItems = useMemo(
    () => workItemsByProject.map((entry) => entry.item),
    [workItemsByProject]
  );

  const statusCounts = useMemo<StatusCounts>(
    () => countWorkspaceWorkItemsByStatus(workItems),
    [workItems]
  );

  const statusFilterKeys = useMemo(
    () => getWorkspaceStatusFilterKeysForWorkItems(workItems),
    [workItems]
  );
  const effectiveStatusFilter = normalizeWorkspaceStatusFilter(
    statusFilter,
    statusFilterKeys
  );
  if (effectiveStatusFilter !== statusFilter) {
    // Normalize the selection in the same render that observes a changed
    // result set. This prevents one committed frame with an impossible filter
    // and avoids a post-commit effect cascade.
    setStatusFilter(effectiveStatusFilter);
  }

  const filteredWorkItems = useMemo(
    () => filterWorkspaceWorkItemsByStatus(workItems, effectiveStatusFilter),
    [effectiveStatusFilter, workItems]
  );

  const visibleWorkItems = useMemo(
    () => filterWorkItemsBySearchQuery(filteredWorkItems, searchQuery),
    [filteredWorkItems, searchQuery]
  );
  const completedStatusSelected =
    effectiveStatusFilter === "done" || effectiveStatusFilter === "closed";
  const handlePresentWorkItem = useCallback(
    (selection: Parameters<typeof onOpenWorkItem>[0]) => {
      setSelectedWorkItemId(selection.workItem.session_id);
    },
    []
  );

  const {
    kanbanTasks,
    kanbanColumns,
    workItemPeople,
    selectableFilteredWorkItemCount,
    selectedWorkItemIds,
    bulkDeleting,
    handleSelectWorkItem,
    handleUpdateWorkItem,
    handleKanbanTaskMove,
    handleKanbanTaskClick,
    handleAddKanbanTask,
    handleRefresh,
    handleCheckedChange,
    handleSelectAll,
    handleUnselectAll,
    handleBulkDelete,
  } = useProjectWorkItemsTabContentInteractions({
    workItems,
    workItemsByProject,
    setWorkItemsByProject,
    filteredWorkItems: visibleWorkItems,
    projectOptions,
    kanbanGroupBy,
    loadWorkItems,
    onOpenLinearProject,
    onOpenWorkItem: handlePresentWorkItem,
    onCreateWorkItem,
    t,
  });
  const handleSelectWorkItemAndShowDetail = useCallback(
    (workItemId: string) => {
      // Selecting from the expanded List must restore the adjacent detail.
      setListFullscreen(false);
      handleSelectWorkItem(workItemId);
    },
    [handleSelectWorkItem]
  );

  const selectedWorkItem = useMemo(
    () =>
      selectedWorkItemId
        ? (workItemsByProject.find(
            (entry) => entry.item.session_id === selectedWorkItemId
          ) ?? null)
        : null,
    [selectedWorkItemId, workItemsByProject]
  );
  const detailOpen = selectedWorkItem !== null;
  const handleCloseDetail = useCallback(() => {
    setSelectedWorkItemId(null);
  }, []);
  const visibleDetailEntries = useMemo<AggregatedWorkItem[]>(() => {
    const entriesById = new Map(
      workItemsByProject.map((entry) => [entry.item.session_id, entry])
    );
    return visibleWorkItems
      .map((workItem) => entriesById.get(workItem.session_id))
      .filter(
        (entry): entry is AggregatedWorkItem =>
          Boolean(entry) &&
          entry?.item.workspaceSource?.source !== WORKSPACE_SOURCE.LINEAR
      );
  }, [visibleWorkItems, workItemsByProject]);
  const selectedDetailIndex = selectedWorkItem
    ? visibleDetailEntries.findIndex(
        (entry) => entry.item.session_id === selectedWorkItem.item.session_id
      )
    : -1;
  const handleDetailNavigate = useCallback(
    (direction: "prev" | "next") => {
      const nextIndex =
        direction === "prev"
          ? selectedDetailIndex - 1
          : selectedDetailIndex + 1;
      const nextEntry = visibleDetailEntries[nextIndex];
      if (nextEntry) setSelectedWorkItemId(nextEntry.item.session_id);
    },
    [selectedDetailIndex, visibleDetailEntries]
  );

  const settingsRows = useProjectWorkItemsTabContentTableRows({
    visibleWorkItems,
    selectedWorkItemIds,
    workItemPeople,
    handleCheckedChange,
    handleUpdateWorkItem,
    handleSelectWorkItemAndShowDetail,
  });

  const {
    headerLeadingControls,
    headerTrailingControls,
    headerEndControls,
    handleStatusFilterChange,
  } = useProjectWorkItemsTabContentHeaderControls({
    activeViewTab,
    setActiveViewTab,
    listFullscreen,
    setListFullscreen,
    useSplitListHeader,
    kanbanGroupBy,
    setKanbanGroupBy,
    allowExternalSources,
    workspaceSourceMode,
    setWorkspaceSourceMode,
    searchQuery,
    setSearchQuery,
    setStatusFilter,
    orgSurfaceControls,
  });

  useProjectManagerWorkItemsTabBarRegistration({
    workStationTabId,
    showPropertiesActive: false,
    onSearch: null,
    onRefresh: handleRefresh,
    refreshLoading: loading,
    onToggleProperties: null,
    onAddProject: onCreateProject ?? null,
    onAddWorkItem: onCreateWorkItem ?? null,
  });

  const showInitialLoading = loading && !loaded;
  const showInitialError = error && workItems.length === 0;
  const listContent = (
    <ProjectWorkItemsListPane
      showInitialLoading={showInitialLoading}
      showInitialError={Boolean(showInitialError)}
      error={error}
      activeViewTab={activeViewTab}
      kanbanTasks={kanbanTasks}
      kanbanColumns={kanbanColumns}
      kanbanGroupBy={kanbanGroupBy}
      handleKanbanTaskMove={handleKanbanTaskMove}
      handleKanbanTaskClick={handleKanbanTaskClick}
      handleAddKanbanTask={handleAddKanbanTask}
      handleRefresh={handleRefresh}
      onCreateWorkItem={onCreateWorkItem}
      settingsRows={settingsRows}
      completedStatusSelected={completedStatusSelected}
      completedItemsLoading={completedItemsLoading}
      completedItemsError={completedItemsError}
      loadCompletedWorkItems={loadCompletedWorkItems}
      workItemCount={workItems.length}
    />
  );
  const detailContent = (
    <ProjectWorkItemsDetailPane
      selectedWorkItem={selectedWorkItem}
      handleCloseDetail={handleCloseDetail}
      onOpenWorkItem={onOpenWorkItem}
      handleDetailNavigate={handleDetailNavigate}
      selectedDetailIndex={selectedDetailIndex}
      visibleDetailCount={visibleDetailEntries.length}
      handleUpdateWorkItem={handleUpdateWorkItem}
      projectOptions={projectOptions}
      workItemPeople={workItemPeople}
      breadcrumbSegments={breadcrumbSegments}
    />
  );
  const workItemsHeader = (
    <WorkItemsPageHeader
      projectName={t("projects.columns.workItems")}
      breadcrumbSegments={breadcrumbSegments}
      identityIcon={
        <HugeiconsIcon
          icon={ListTodoIcon}
          data-icon="list-todo"
          size={HEADER_ICON_SIZE.sm}
          strokeWidth={1.75}
        />
      }
      onOpenProjects={onOpenProjects}
      activeTab={activeViewTab}
      statusFilter={effectiveStatusFilter}
      onStatusFilterChange={handleStatusFilterChange}
      statusCounts={statusCounts}
      statusFilterKeys={statusFilterKeys}
      onAddProject={onCreateProject}
      onAddWorkItem={onCreateWorkItem}
      onRefresh={handleRefresh}
      refreshLoading={loading}
      leadingControls={headerLeadingControls}
      trailingControls={headerTrailingControls}
      endControls={headerEndControls}
      splitListHeader={useSplitListHeader}
      splitHeaderLeading={splitHeaderLeading}
      publishToWorkstationHeader={!!workStationTabId}
      workstationHeaderHost={workstationHeaderHost}
      shellLeadingChromeHidden={shellLeadingChromeHidden}
    />
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {!useSplitListHeader && workItemsHeader}

      <div className="min-h-0 flex-1 overflow-hidden">
        <InboxListDetailLayout
          detailOpen={detailOpen}
          defaultSplit={activeViewTab === "List"}
          listFullscreen={activeViewTab === "List" && listFullscreen}
          listHeader={useSplitListHeader ? workItemsHeader : undefined}
          fullContent={listContent}
          listContent={
            <WorkItemsCompactList
              items={visibleWorkItems}
              selectedWorkItemId={selectedWorkItemId}
              onSelectWorkItem={handleSelectWorkItemAndShowDetail}
              title={t("projects.columns.workItems")}
              loading={loading || completedItemsLoading}
              testId="workspace-work-items-compact-list"
            />
          }
          detailContent={detailContent}
          testId="workspace-work-items-list-detail-layout"
        />
      </div>

      <MultiSelectBar
        selectedCount={selectedWorkItemIds.size}
        visibleItemCount={selectableFilteredWorkItemCount}
        deleting={bulkDeleting}
        onSelectAll={handleSelectAll}
        onUnselectAll={handleUnselectAll}
        onDelete={handleBulkDelete}
      />
    </div>
  );
};

export default ProjectWorkItemsTabContent;

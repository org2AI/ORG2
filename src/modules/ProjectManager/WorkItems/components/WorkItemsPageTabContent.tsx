import React from "react";

import { STORY_SYNC_ADAPTER } from "@src/api/http/integrations/syncConnections";
import type { WorkItemStatus } from "@src/types/core/workItem";

import { getEffectiveWorkItemPrefix } from "../config";
import type { useWorkItems } from "../hooks/useWorkItems";
import type { useWorkItemsPageIntegrations } from "../hooks/useWorkItemsPageIntegrations";
import type { useWorkItemsPageInteractions } from "../hooks/useWorkItemsPageInteractions";
import type { useWorkItemsPageScope } from "../hooks/useWorkItemsPageScope";
import type { useWorkItemsPageSelection } from "../hooks/useWorkItemsPageSelection";
import type { useWorkItemsPageViewControls } from "../hooks/useWorkItemsPageViewControls";
import type { useWorkItemsProjectPanes } from "../hooks/useWorkItemsProjectPanes";
import WorkItemsTabContent from "./WorkItemsTabContent";

type WorkItemsPage = ReturnType<typeof useWorkItems>;
type WorkItemsTabContentProps = React.ComponentProps<
  typeof WorkItemsTabContent
>;

interface WorkItemsPageTabContentProps {
  state: WorkItemsPage["state"];
  data: WorkItemsPage["data"];
  projectData: WorkItemsPage["projectData"];
  scope: ReturnType<typeof useWorkItemsPageScope>;
  interactions: ReturnType<typeof useWorkItemsPageInteractions>;
  selection: ReturnType<typeof useWorkItemsPageSelection>;
  integrations: ReturnType<typeof useWorkItemsPageIntegrations>;
  projectPanes: ReturnType<typeof useWorkItemsProjectPanes>;
  viewControls: ReturnType<typeof useWorkItemsPageViewControls>;
  repoPath?: string | null;
  listFullscreen: boolean;
  collapseAllSignal: number;
  workItemsHeader: React.ReactNode;
  detailContent: React.ReactNode;
  onUpdateWorkItem: WorkItemsTabContentProps["onUpdateWorkItem"];
  onRestoreWorkItem: WorkItemsTabContentProps["onRestoreWorkItem"];
  onAddListItem: WorkItemsTabContentProps["onAddListItem"];
  onKanbanTaskMove: WorkItemsTabContentProps["onKanbanTaskMove"];
  onAddKanbanTask: WorkItemsTabContentProps["onAddKanbanTask"];
  onGanttTaskUpdate: WorkItemsTabContentProps["onGanttTaskUpdate"];
}

/**
 * The active Work Items tab (list, Kanban, Gantt, calendar, overview or
 * settings) over the property-filtered work items, with the split-list
 * header, detail pane and properties panel slots.
 */
const WorkItemsPageTabContent: React.FC<WorkItemsPageTabContentProps> = ({
  state,
  data,
  projectData,
  scope,
  interactions,
  selection,
  integrations,
  projectPanes,
  viewControls,
  repoPath,
  listFullscreen,
  collapseAllSignal,
  workItemsHeader,
  detailContent,
  onUpdateWorkItem,
  onRestoreWorkItem,
  onAddListItem,
  onKanbanTaskMove,
  onAddKanbanTask,
  onGanttTaskUpdate,
}) => {
  const { availableRepos, pinnedKanbanColumnIds, useSplitListHeader } = scope;
  const {
    handleDeleteWorkItem,
    handleOpenWorkItem,
    propertyOrgId,
    handlePropertyGroupByChange,
    propertyView,
    applicablePropertyGroupBy,
    propertyFilteredWorkItems,
    propertyGroupedWorkItems,
    propertyKanbanTasks,
    propertyGanttTasks,
    propertyCalendarEvents,
  } = interactions;
  const { selectedIds, handleCheckedChange } = selection;
  const { projectSyncAdapterId } = integrations;
  const {
    displayProject,
    handleLocalProjectUpdate,
    handleProjectNameChange,
    handleProjectDescriptionChange,
    overviewPropertiesPanel,
    settingsContent,
    resolvedProjectDescription,
  } = projectPanes;
  const {
    kanbanGroupBy,
    tableColumns,
    setTableColumns,
    tableSort,
    setTableSort,
  } = viewControls;

  const propertiesPanel = state.showProperties && overviewPropertiesPanel;

  return (
    <WorkItemsTabContent
      statusOrgId={propertyOrgId}
      activeTab={state.activeTab}
      tableColumns={tableColumns}
      onTableColumnsChange={setTableColumns}
      tableSort={tableSort}
      onTableSortChange={setTableSort}
      tablePropertyDefinitions={propertyView.definitions}
      tablePropertyValues={propertyView.values}
      tablePropertyGroupBy={applicablePropertyGroupBy}
      onTablePropertyGroupByChange={handlePropertyGroupByChange}
      groupedWorkItems={propertyGroupedWorkItems}
      filteredWorkItems={propertyFilteredWorkItems}
      selectedWorkItem={data.selectedWorkItem ?? null}
      selectedWorkItemId={state.selectedWorkItemId}
      workItems={data.workItems}
      projectName={displayProject.name}
      projectDescription={resolvedProjectDescription}
      projectProperties={displayProject}
      hideProjectPropertiesRow={
        projectSyncAdapterId === STORY_SYNC_ADAPTER.GITHUB
      }
      repoPath={repoPath}
      availableMembers={projectData.availableMembers}
      availableTeams={projectData.availableTeams}
      projectLabels={projectData.availableLabels}
      availableRepos={availableRepos}
      availableProjects={projectData.availableProjects}
      availableMilestones={projectData.availableMilestones}
      availableLabels={projectData.availableLabels}
      overviewStats={data.overviewStats}
      checkedWorkItemIds={selectedIds}
      onCheckedChange={handleCheckedChange}
      onSelectWorkItem={handleOpenWorkItem}
      onUpdateWorkItem={onUpdateWorkItem}
      onDeleteWorkItem={handleDeleteWorkItem}
      onRestoreWorkItem={onRestoreWorkItem}
      onAddListItem={(status: WorkItemStatus) => onAddListItem(status)}
      onProjectNameChange={handleProjectNameChange}
      onProjectDescriptionChange={handleProjectDescriptionChange}
      onProjectPropertiesChange={handleLocalProjectUpdate}
      onKanbanTaskMove={onKanbanTaskMove}
      onKanbanTaskClick={(task) => handleOpenWorkItem(task.id)}
      onAddKanbanTask={onAddKanbanTask}
      onGanttTaskClick={(task) => handleOpenWorkItem(task.id)}
      onGanttTaskUpdate={onGanttTaskUpdate}
      onCalendarEventClick={(event) => handleOpenWorkItem(event.id)}
      kanbanGroupBy={kanbanGroupBy}
      pinnedKanbanColumnIds={pinnedKanbanColumnIds}
      kanbanTasks={propertyKanbanTasks}
      ganttTasks={propertyGanttTasks}
      calendarEvents={propertyCalendarEvents}
      listFullscreen={listFullscreen}
      listHeader={useSplitListHeader ? workItemsHeader : undefined}
      detailContent={detailContent}
      propertiesPanel={propertiesPanel}
      settingsContent={settingsContent}
      collapseAllSignal={collapseAllSignal}
      workItemPrefix={getEffectiveWorkItemPrefix(
        displayProject.name,
        displayProject.workItemPrefix,
        displayProject.workItemPrefixCustom
      )}
    />
  );
};

export default WorkItemsPageTabContent;

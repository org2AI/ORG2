/**
 * Work Items view-model: the public surface for status filtering / grouping,
 * workspace (cross-project) aggregation and Kanban projections.
 *
 * Implementation lives in the concern-specific siblings; this module keeps
 * the historical import path stable.
 */
export type {
  WorkItemGroup,
  WorkItemGroupStatus,
  WorkItemNavigation,
} from "./workItemsStatusViewModel";
export {
  countWorkItemsByStatus,
  filterWorkItemsBySearchQuery,
  filterWorkItemsByStatus,
  getStatusFilterKeysForWorkItems,
  getWorkItemNavigation,
  getWorkItemStatus,
  groupWorkItemsByStatus,
  groupWorkItemsForStatusFilter,
  isDeletedWorkItem,
} from "./workItemsStatusViewModel";

export {
  countWorkspaceWorkItemsByStatus,
  filterWorkspaceWorkItemsByStatus,
  getWorkspaceStatusFilterKeysForWorkItems,
  groupWorkspaceWorkItemsForStatusFilter,
  isWorkspaceCompletedWorkItem,
  normalizeWorkspaceStatusFilter,
} from "./workspaceWorkItemsViewModel";

export type {
  WorkItemProjectGroup,
  WorkItemsKanbanGroup,
} from "./workItemsKanbanViewModel";
export {
  NO_PROJECT_GROUP_KEY,
  TABLE_GROUP_BY_PROJECT,
  WORK_ITEMS_KANBAN_GROUP,
  getPersonKanbanColumns,
  getProjectKanbanColumns,
  getPropertyKanbanColumns,
  getStatusKanbanColumns,
  getWorkItemsKanbanColumns,
  groupWorkItemsByProject,
  workItemToKanbanTask,
  workItemsToKanbanTasks,
  workItemsToPropertyKanbanTasks,
} from "./workItemsKanbanViewModel";

import type {
  StatusCounts,
  StatusFilterType,
} from "@src/modules/ProjectManager/WorkItems/types";
import { WORK_ITEM_STATUS_OPTIONS } from "@src/modules/ProjectManager/config/manage";
import {
  GITHUB_ISSUE_STATUS,
  WORK_ITEM_STATUS,
  type WorkItem,
} from "@src/types/core/workItem";

import { STATUS_FILTER_KEYS } from "./types";
import {
  type WorkItemGroup,
  countWorkItemsByStatus,
  filterWorkItemsByStatus,
  getStatusFilterKeysForWorkItems,
  getWorkItemStatus,
  groupWorkItemsForStatusFilter,
  isDeletedWorkItem,
} from "./workItemsStatusViewModel";

export function isWorkspaceCompletedWorkItem(workItem: WorkItem): boolean {
  const status = getWorkItemStatus(workItem);
  return (
    status === WORK_ITEM_STATUS.COMPLETED ||
    status === GITHUB_ISSUE_STATUS.CLOSED
  );
}

export function filterWorkspaceWorkItemsByStatus<TWorkItem extends WorkItem>(
  workItems: TWorkItem[],
  statusFilter: StatusFilterType
): TWorkItem[] {
  if (statusFilter === "done" || statusFilter === "closed") {
    return workItems.filter(
      (workItem) =>
        !isDeletedWorkItem(workItem) && isWorkspaceCompletedWorkItem(workItem)
    );
  }
  return filterWorkItemsByStatus(workItems, statusFilter);
}

export function getWorkspaceStatusFilterKeysForWorkItems(
  workItems: WorkItem[]
): readonly StatusFilterType[] {
  const availableKeys = new Set(getStatusFilterKeysForWorkItems(workItems));
  availableKeys.delete("closed");
  availableKeys.add("done");

  return [
    "all",
    ...(availableKeys.has("open") ? (["open"] as const) : []),
    ...STATUS_FILTER_KEYS.slice(1).filter((key) => availableKeys.has(key)),
  ];
}

export function normalizeWorkspaceStatusFilter(
  statusFilter: StatusFilterType,
  statusFilterKeys: readonly StatusFilterType[]
): StatusFilterType {
  return statusFilterKeys.includes(statusFilter) ? statusFilter : "all";
}

function mergeWorkspaceCompletedGroups<TWorkItem extends WorkItem>(
  groups: WorkItemGroup<TWorkItem>[]
): WorkItemGroup<TWorkItem>[] {
  const completedItems = groups
    .filter(
      (group) =>
        group.status === WORK_ITEM_STATUS.COMPLETED ||
        group.status === GITHUB_ISSUE_STATUS.CLOSED
    )
    .flatMap((group) => group.items);
  const completedConfig = WORK_ITEM_STATUS_OPTIONS.find(
    (option) => option.value === WORK_ITEM_STATUS.COMPLETED
  );
  if (!completedConfig) return groups;

  const completedGroup: WorkItemGroup<TWorkItem> = {
    status: WORK_ITEM_STATUS.COMPLETED,
    config: completedConfig,
    items: completedItems,
  };
  const mergedGroups: WorkItemGroup<TWorkItem>[] = [];
  let insertedCompletedGroup = false;

  for (const group of groups) {
    if (group.status === GITHUB_ISSUE_STATUS.CLOSED) continue;
    if (group.status === WORK_ITEM_STATUS.COMPLETED) {
      mergedGroups.push(completedGroup);
      insertedCompletedGroup = true;
      continue;
    }
    if (group.status === "deleted" && !insertedCompletedGroup) {
      mergedGroups.push(completedGroup);
      insertedCompletedGroup = true;
    }
    mergedGroups.push(group);
  }

  if (!insertedCompletedGroup) mergedGroups.push(completedGroup);
  return mergedGroups;
}

export function groupWorkspaceWorkItemsForStatusFilter<
  TWorkItem extends WorkItem,
>(
  workItems: TWorkItem[],
  statusFilter: StatusFilterType
): WorkItemGroup<TWorkItem>[] {
  const filteredItems = filterWorkspaceWorkItemsByStatus(
    workItems,
    statusFilter
  );
  const completedFilter = statusFilter === "done" || statusFilter === "closed";
  const groups = groupWorkItemsForStatusFilter(
    filteredItems,
    completedFilter ? "all" : statusFilter
  );
  if (!completedFilter && statusFilter !== "all") return groups;
  const mergedGroups = mergeWorkspaceCompletedGroups(groups);
  return completedFilter
    ? mergedGroups.filter(
        (group) => group.status === WORK_ITEM_STATUS.COMPLETED
      )
    : mergedGroups;
}

export function countWorkspaceWorkItemsByStatus(
  workItems: WorkItem[]
): StatusCounts {
  const counts = countWorkItemsByStatus(workItems);
  return {
    ...counts,
    done: counts.done + counts.closed,
    closed: 0,
  };
}

import type {
  StatusCounts,
  StatusFilterType,
} from "@src/modules/ProjectManager/WorkItems/types";
import {
  GITHUB_ISSUE_STATUS_OPTIONS,
  WORK_ITEM_STATUS_OPTIONS,
} from "@src/modules/ProjectManager/config/manage";
import type { DropdownOption } from "@src/types/core/shared";
import {
  GITHUB_ISSUE_STATUS,
  type WorkItem,
  type WorkItemStatus,
} from "@src/types/core/workItem";

import {
  FILTER_TO_STATUS,
  GITHUB_ISSUE_STATUS_FILTER_KEYS,
  STATUS_FILTER_KEYS,
  WORK_ITEMS_DEFAULT_STATUS,
} from "./types";

export type WorkItemGroupStatus = WorkItemStatus | "deleted";

export interface WorkItemGroup<TWorkItem extends WorkItem = WorkItem> {
  status: WorkItemGroupStatus;
  config: DropdownOption;
  items: TWorkItem[];
}

export interface WorkItemNavigation {
  hasPrev: boolean;
  hasNext: boolean;
  currentIndex: number;
}

export function isDeletedWorkItem(workItem: WorkItem): boolean {
  return Boolean(workItem.deletedAt);
}

export function getWorkItemStatus(workItem: WorkItem): WorkItemStatus {
  return (workItem.workItemStatus ??
    workItem.status ??
    WORK_ITEMS_DEFAULT_STATUS) as WorkItemStatus;
}

export function filterWorkItemsBySearchQuery<TWorkItem extends WorkItem>(
  workItems: TWorkItem[],
  query: string
): TWorkItem[] {
  const search = query.trim().toLowerCase();
  if (!search) return workItems;

  return workItems.filter((workItem) => {
    const searchableValues = [
      workItem.name,
      workItem.shortId,
      workItem.project?.name,
      workItem.assignee?.name,
      ...(workItem.labels ?? []).map((label) => label.name),
    ];
    return searchableValues.some((value) =>
      value?.toLowerCase().includes(search)
    );
  });
}

export function filterWorkItemsByStatus<TWorkItem extends WorkItem>(
  workItems: TWorkItem[],
  statusFilter: StatusFilterType,
  resolveCategory?: (status: string) => string
): TWorkItem[] {
  const mappedStatus = FILTER_TO_STATUS[statusFilter];
  if (!mappedStatus) return workItems;
  return workItems.filter((workItem) => {
    if (isDeletedWorkItem(workItem)) return false;
    const status = getWorkItemStatus(workItem);
    return (
      status === mappedStatus || resolveCategory?.(status) === mappedStatus
    );
  });
}

export function groupWorkItemsByStatus<TWorkItem extends WorkItem>(
  workItems: TWorkItem[],
  options?: readonly DropdownOption[],
  extraOptions?: readonly DropdownOption[],
  resolveCategory?: (status: string) => string
): WorkItemGroup<TWorkItem>[] {
  const activeItems = workItems.filter(
    (workItem) => !isDeletedWorkItem(workItem)
  );
  const hasGitHubIssueStatuses = activeItems.some((workItem) =>
    GITHUB_ISSUE_STATUS_OPTIONS.some(
      (option) => option.value === getWorkItemStatus(workItem)
    )
  );
  const hasWorkflowStatuses = activeItems.some((workItem) =>
    WORK_ITEM_STATUS_OPTIONS.some(
      (option) => option.value === getWorkItemStatus(workItem)
    )
  );
  const baseOptions =
    options ??
    (hasGitHubIssueStatuses
      ? hasWorkflowStatuses
        ? [...GITHUB_ISSUE_STATUS_OPTIONS, ...WORK_ITEM_STATUS_OPTIONS]
        : GITHUB_ISSUE_STATUS_OPTIONS
      : WORK_ITEM_STATUS_OPTIONS);
  const statusOptions = extraOptions?.length
    ? [...baseOptions, ...extraOptions]
    : baseOptions;
  const groups = statusOptions.map((option) => ({
    status: option.value as WorkItemStatus,
    config: option,
    items: activeItems.filter(
      (workItem) => getWorkItemStatus(workItem) === option.value
    ),
  }));
  if (!resolveCategory) return groups;

  const selectableStatuses = new Set(
    statusOptions.map((option) => option.value.toString())
  );
  for (const workItem of activeItems) {
    const rawStatus = getWorkItemStatus(workItem);
    if (selectableStatuses.has(rawStatus)) continue;
    const category = resolveCategory(rawStatus);
    groups.find((group) => group.status === category)?.items.push(workItem);
  }
  return groups;
}

export function getStatusFilterKeysForWorkItems(
  workItems: WorkItem[]
): readonly StatusFilterType[] {
  const activeItems = workItems.filter(
    (workItem) => !isDeletedWorkItem(workItem)
  );
  const hasGitHubIssueStatuses = activeItems.some((workItem) => {
    const status = getWorkItemStatus(workItem);
    return (
      status === GITHUB_ISSUE_STATUS.OPEN ||
      status === GITHUB_ISSUE_STATUS.CLOSED
    );
  });
  const hasWorkflowStatuses = activeItems.some((workItem) => {
    const status = getWorkItemStatus(workItem);
    return (
      status !== GITHUB_ISSUE_STATUS.OPEN &&
      status !== GITHUB_ISSUE_STATUS.CLOSED
    );
  });

  if (hasGitHubIssueStatuses && !hasWorkflowStatuses) {
    return GITHUB_ISSUE_STATUS_FILTER_KEYS;
  }
  if (hasGitHubIssueStatuses) {
    return [...GITHUB_ISSUE_STATUS_FILTER_KEYS, ...STATUS_FILTER_KEYS.slice(1)];
  }
  return STATUS_FILTER_KEYS;
}

export function groupWorkItemsForStatusFilter<TWorkItem extends WorkItem>(
  workItems: TWorkItem[],
  statusFilter: StatusFilterType,
  customStatusOptions?: readonly DropdownOption[],
  resolveCategory?: (status: string) => string
): WorkItemGroup<TWorkItem>[] {
  const groups = groupWorkItemsByStatus(
    workItems,
    undefined,
    customStatusOptions,
    resolveCategory
  );
  if (statusFilter === "all") {
    const deletedItems = workItems.filter(isDeletedWorkItem);
    if (deletedItems.length === 0) return groups;
    return [
      ...groups,
      {
        status: "deleted",
        config: {
          value: "deleted",
          label: "Delete Bin",
          color: "var(--color-text-3)",
        },
        items: deletedItems,
      },
    ];
  }

  const mappedStatus = FILTER_TO_STATUS[statusFilter];
  return groups.filter(
    (group) =>
      group.status === mappedStatus ||
      (resolveCategory ? resolveCategory(group.status) === mappedStatus : false)
  );
}

export function countWorkItemsByStatus(
  workItems: WorkItem[],
  resolveCategory?: (status: string) => string
): StatusCounts {
  const activeItems = workItems.filter(
    (workItem) => !isDeletedWorkItem(workItem)
  );
  const counts: StatusCounts = {
    all: activeItems.length,
    backlog: 0,
    todo: 0,
    inProgress: 0,
    inReview: 0,
    blocked: 0,
    done: 0,
    cancelled: 0,
    duplicate: 0,
    open: 0,
    closed: 0,
  };

  for (const key of [
    ...STATUS_FILTER_KEYS,
    ...GITHUB_ISSUE_STATUS_FILTER_KEYS,
  ]) {
    if (key === "all") continue;
    const mappedStatus = FILTER_TO_STATUS[key];
    counts[key] = mappedStatus
      ? activeItems.filter((workItem) => {
          const status = getWorkItemStatus(workItem);
          return (
            status === mappedStatus ||
            resolveCategory?.(status) === mappedStatus
          );
        }).length
      : 0;
  }

  return counts;
}

export function getWorkItemNavigation(
  filteredWorkItems: WorkItem[],
  selectedWorkItemId: string | null
): WorkItemNavigation {
  const currentIndex = filteredWorkItems.findIndex(
    (workItem) => workItem.session_id === selectedWorkItemId
  );
  return {
    hasPrev: currentIndex > 0,
    hasNext: currentIndex >= 0 && currentIndex < filteredWorkItems.length - 1,
    currentIndex,
  };
}

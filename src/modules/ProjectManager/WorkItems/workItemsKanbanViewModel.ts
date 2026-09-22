import type { PropertyDefinition } from "@src/api/http/project";
import {
  DEFAULT_KANBAN_COLUMNS,
  GITHUB_ISSUE_KANBAN_COLUMNS,
} from "@src/features/KanbanBoard/config";
import type {
  KanbanColumnConfig,
  KanbanTask,
} from "@src/features/KanbanBoard/types";
import { BookOpen01Icon, TagsIcon, UserCircleIcon } from "@src/icons";
import { ENTITY_COLORS } from "@src/modules/ProjectManager/config/manage";
import type { Person } from "@src/types/core/shared";
import { GITHUB_ISSUE_STATUS, type WorkItem } from "@src/types/core/workItem";

import {
  PROPERTY_FILTER_NONE_VALUE,
  groupWorkItemsByProperty,
} from "./propertyViewModel";
import {
  getWorkItemStatus,
  isDeletedWorkItem,
} from "./workItemsStatusViewModel";

export const WORK_ITEMS_KANBAN_GROUP = {
  STATUS: "status",
  ASSIGNED_TO: "assigned_to",
  CREATED_BY: "created_by",
  PROJECT: "project",
  PROPERTY: "property",
} as const;

export type WorkItemsKanbanGroup =
  (typeof WORK_ITEMS_KANBAN_GROUP)[keyof typeof WORK_ITEMS_KANBAN_GROUP];

export const NO_PROJECT_GROUP_KEY = "__no_project__";

export const TABLE_GROUP_BY_PROJECT = "__project__";

const PROPERTY_KANBAN_COLORS = Object.values(ENTITY_COLORS);

export interface WorkItemProjectGroup<TWorkItem extends WorkItem = WorkItem> {
  key: string;
  label: string;
  items: TWorkItem[];
}

export function groupWorkItemsByProject<TWorkItem extends WorkItem>(
  workItems: readonly TWorkItem[],
  noProjectLabel: string
): WorkItemProjectGroup<TWorkItem>[] {
  const groups = new Map<string, WorkItemProjectGroup<TWorkItem>>();
  groups.set(NO_PROJECT_GROUP_KEY, {
    key: NO_PROJECT_GROUP_KEY,
    label: noProjectLabel,
    items: [],
  });
  for (const workItem of workItems) {
    const project = workItem.project;
    if (!project) {
      groups.get(NO_PROJECT_GROUP_KEY)?.items.push(workItem);
      continue;
    }
    const key = `project:${project.id}`;
    const group = groups.get(key) ?? { key, label: project.name, items: [] };
    group.items.push(workItem);
    groups.set(key, group);
  }
  return [...groups.values()].sort((left, right) => {
    if (left.key === NO_PROJECT_GROUP_KEY) return 1;
    if (right.key === NO_PROJECT_GROUP_KEY) return -1;
    return left.label.localeCompare(right.label);
  });
}

const UNASSIGNED_PERSON_COLUMN_ID = "person:unassigned" as const;

function getPersonForGroup(
  workItem: WorkItem,
  groupBy: WorkItemsKanbanGroup
): Person | undefined {
  if (groupBy === WORK_ITEMS_KANBAN_GROUP.CREATED_BY) {
    return workItem.createdBy;
  }
  return workItem.assignee;
}

function getPersonColumnId(
  workItem: WorkItem,
  groupBy: WorkItemsKanbanGroup
): KanbanTask["status"] {
  return `person:${getPersonForGroup(workItem, groupBy)?.id || "unassigned"}`;
}

function getProjectColumnId(workItem: WorkItem): KanbanTask["status"] {
  return (
    workItem.project ? `project:${workItem.project.id}` : NO_PROJECT_GROUP_KEY
  ) as KanbanTask["status"];
}

function pinColumnsFirst(
  columns: KanbanColumnConfig[],
  pinnedColumnIds: readonly string[] = []
): KanbanColumnConfig[] {
  if (pinnedColumnIds.length === 0) return columns;
  const firstPinnedColumnId = pinnedColumnIds.find((columnId) =>
    columns.some((column) => column.id === columnId)
  );
  if (!firstPinnedColumnId) return columns;
  return [
    ...columns.filter((column) => column.id === firstPinnedColumnId),
    ...columns.filter((column) => column.id !== firstPinnedColumnId),
  ];
}

function hasGitHubIssueStatus(workItems: WorkItem[]): boolean {
  return workItems.some((workItem) => {
    const status = getWorkItemStatus(workItem);
    return (
      status === GITHUB_ISSUE_STATUS.OPEN ||
      status === GITHUB_ISSUE_STATUS.CLOSED
    );
  });
}

function hasWorkflowStatus(workItems: WorkItem[]): boolean {
  return workItems.some((workItem) => {
    const status = getWorkItemStatus(workItem);
    return DEFAULT_KANBAN_COLUMNS.some((column) => column.id === status);
  });
}

export function getStatusKanbanColumns(
  workItems: WorkItem[]
): KanbanColumnConfig[] {
  const activeItems = workItems.filter(
    (workItem) => !isDeletedWorkItem(workItem)
  );
  const hasIssueStatuses = hasGitHubIssueStatus(activeItems);
  const hasDefaultWorkflowStatuses = hasWorkflowStatus(activeItems);

  if (hasIssueStatuses && !hasDefaultWorkflowStatuses) {
    return GITHUB_ISSUE_KANBAN_COLUMNS;
  }

  if (hasIssueStatuses) {
    return [...GITHUB_ISSUE_KANBAN_COLUMNS, ...DEFAULT_KANBAN_COLUMNS];
  }

  return DEFAULT_KANBAN_COLUMNS;
}

export function getPersonKanbanColumns(
  workItems: WorkItem[],
  groupBy: WorkItemsKanbanGroup,
  unassignedTitle: string,
  pinnedColumnIds: readonly string[] = []
): KanbanColumnConfig[] {
  const people = new Map<string, { name: string; color?: string }>();
  let hasUnassigned = false;

  for (const workItem of workItems) {
    if (isDeletedWorkItem(workItem)) continue;
    const person = getPersonForGroup(workItem, groupBy);
    if (!person) {
      hasUnassigned = true;
      continue;
    }
    people.set(person.id, { name: person.name, color: person.color });
  }

  const personColumns = [...people]
    .sort(([, first], [, second]) => first.name.localeCompare(second.name))
    .map(([id, person]) => {
      const color = person.color || "var(--color-primary-6)";
      return {
        id: `person:${id}` as KanbanTask["status"],
        title: person.name,
        icon: UserCircleIcon,
        color,
        bgColor: `color-mix(in srgb, ${color} 10%, transparent)`,
        dotColor: color,
        headerBgColor: `color-mix(in srgb, ${color} 8%, transparent)`,
        showAddButton: false,
      } satisfies KanbanColumnConfig;
    });

  const columns = hasUnassigned
    ? [
        ...personColumns,
        {
          id: UNASSIGNED_PERSON_COLUMN_ID,
          title: unassignedTitle,
          icon: UserCircleIcon,
          color: "var(--color-text-3)",
          bgColor: "color-mix(in srgb, var(--color-text-3) 10%, transparent)",
          dotColor: "var(--color-text-3)",
          headerBgColor:
            "color-mix(in srgb, var(--color-text-3) 8%, transparent)",
          showAddButton: false,
        },
      ]
    : personColumns;

  return pinColumnsFirst(columns, pinnedColumnIds);
}

export function getProjectKanbanColumns(
  workItems: WorkItem[],
  noProjectTitle: string,
  pinnedColumnIds: readonly string[] = []
): KanbanColumnConfig[] {
  const activeItems = workItems.filter(
    (workItem) => !isDeletedWorkItem(workItem)
  );
  const groups = groupWorkItemsByProject(activeItems, noProjectTitle);
  const columns = groups.map((group) => {
    const isNoProject = group.key === NO_PROJECT_GROUP_KEY;
    const color = isNoProject
      ? "var(--color-text-3)"
      : group.items[0]?.project?.color || "var(--color-primary-6)";
    return {
      id: group.key as KanbanTask["status"],
      title: group.label,
      icon: BookOpen01Icon,
      color,
      bgColor: `color-mix(in srgb, ${color} 10%, transparent)`,
      dotColor: color,
      headerBgColor: `color-mix(in srgb, ${color} 8%, transparent)`,
      showAddButton: false,
    } satisfies KanbanColumnConfig;
  });
  return pinColumnsFirst(columns, pinnedColumnIds);
}

export function getPropertyKanbanColumns(
  workItems: WorkItem[],
  definition: PropertyDefinition,
  valuesByItem: ReadonlyMap<string, ReadonlyMap<string, unknown>>,
  members: readonly Person[],
  noValueTitle: string
): KanbanColumnConfig[] {
  const activeItems = workItems.filter(
    (workItem) => !isDeletedWorkItem(workItem)
  );
  const groups = groupWorkItemsByProperty(
    activeItems,
    definition,
    valuesByItem,
    members
  );
  return groups.map((group, index) => {
    const isNoValue = group.key === PROPERTY_FILTER_NONE_VALUE;
    const color = isNoValue
      ? "var(--color-text-3)"
      : PROPERTY_KANBAN_COLORS[index % PROPERTY_KANBAN_COLORS.length];
    return {
      id: `property:${group.key}` as KanbanTask["status"],
      title: isNoValue ? noValueTitle : group.label,
      icon: TagsIcon,
      color,
      bgColor: `color-mix(in srgb, ${color} 10%, transparent)`,
      dotColor: color,
      headerBgColor: `color-mix(in srgb, ${color} 8%, transparent)`,
      showAddButton: false,
    } satisfies KanbanColumnConfig;
  });
}

export function workItemsToPropertyKanbanTasks(
  workItems: WorkItem[],
  definition: PropertyDefinition,
  valuesByItem: ReadonlyMap<string, ReadonlyMap<string, unknown>>,
  members: readonly Person[]
): KanbanTask[] {
  const activeItems = workItems.filter(
    (workItem) => !isDeletedWorkItem(workItem)
  );
  const groups = groupWorkItemsByProperty(
    activeItems,
    definition,
    valuesByItem,
    members
  );
  return groups.flatMap((group) =>
    group.items.map(
      (workItem) =>
        ({
          id: workItem.session_id,
          title: workItem.name,
          description: workItem.spec,
          status: `property:${group.key}` as KanbanTask["status"],
          priority: workItem.priority as KanbanTask["priority"],
          assignee: workItem.assignee?.name,
          labels: workItem.labels,
        }) satisfies KanbanTask
    )
  );
}

export function getWorkItemsKanbanColumns(
  workItems: WorkItem[],
  groupBy: WorkItemsKanbanGroup,
  unassignedTitle: string,
  pinnedColumnIds: readonly string[] = [],
  noProjectTitle: string = unassignedTitle
): KanbanColumnConfig[] {
  if (groupBy === WORK_ITEMS_KANBAN_GROUP.STATUS) {
    return getStatusKanbanColumns(workItems);
  }
  if (groupBy === WORK_ITEMS_KANBAN_GROUP.PROJECT) {
    return getProjectKanbanColumns(workItems, noProjectTitle, pinnedColumnIds);
  }
  if (groupBy === WORK_ITEMS_KANBAN_GROUP.PROPERTY) {
    return [];
  }
  return getPersonKanbanColumns(
    workItems,
    groupBy,
    unassignedTitle,
    pinnedColumnIds
  );
}

export function workItemToKanbanTask(
  workItem: WorkItem,
  groupBy: WorkItemsKanbanGroup = WORK_ITEMS_KANBAN_GROUP.STATUS
): KanbanTask {
  return {
    id: workItem.session_id,
    title: workItem.name,
    description: workItem.spec,
    status:
      groupBy === WORK_ITEMS_KANBAN_GROUP.STATUS
        ? getWorkItemStatus(workItem)
        : groupBy === WORK_ITEMS_KANBAN_GROUP.PROJECT
          ? getProjectColumnId(workItem)
          : getPersonColumnId(workItem, groupBy),
    priority: workItem.priority as KanbanTask["priority"],
    assignee: workItem.assignee?.name,
    labels: workItem.labels,
  };
}

export function workItemsToKanbanTasks(
  workItems: WorkItem[],
  groupBy: WorkItemsKanbanGroup = WORK_ITEMS_KANBAN_GROUP.STATUS
): KanbanTask[] {
  return workItems
    .filter((workItem) => !isDeletedWorkItem(workItem))
    .map((workItem) => workItemToKanbanTask(workItem, groupBy));
}

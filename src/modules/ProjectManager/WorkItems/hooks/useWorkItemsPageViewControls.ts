import { type Dispatch, type SetStateAction, useState } from "react";

import type { Person } from "@src/types/core/shared";

import type { WorkItemsTableSort } from "../components/WorkItemsTableView";
import {
  WORK_ITEMS_KANBAN_GROUP,
  type WorkItemsKanbanGroup,
} from "../workItemsViewModel";
import type { useWorkItems } from "./useWorkItems";
import type { useWorkItemsPageInteractions } from "./useWorkItemsPageInteractions";
import type { useWorkItemsPageScope } from "./useWorkItemsPageScope";
import { useWorkItemsSavedViews } from "./useWorkItemsSavedViews";
import { useWorkItemsSurfaceControls } from "./useWorkItemsSurfaceControls";

type WorkItemsPageScope = ReturnType<typeof useWorkItemsPageScope>;

interface UseWorkItemsPageViewControlsParams {
  state: ReturnType<typeof useWorkItems>["state"];
  scope: Pick<
    WorkItemsPageScope,
    | "isWorkItemsSurface"
    | "resolvedProjectSlug"
    | "savedViewPreferenceOwnerId"
    | "activeProjectView"
    | "useSplitListHeader"
  >;
  interactions: ReturnType<typeof useWorkItemsPageInteractions>;
  orgId: string;
  listFullscreen: boolean;
  setListFullscreen: Dispatch<SetStateAction<boolean>>;
  availableMembers: Person[];
}

/**
 * View settings of the Work Items list (Kanban group-by, table columns and
 * sort), the saved views that apply them, and the header surface controls
 * that change them.
 */
export function useWorkItemsPageViewControls({
  state,
  scope,
  interactions,
  orgId,
  listFullscreen,
  setListFullscreen,
  availableMembers,
}: UseWorkItemsPageViewControlsParams) {
  const {
    isWorkItemsSurface,
    resolvedProjectSlug,
    savedViewPreferenceOwnerId,
    activeProjectView,
    useSplitListHeader,
  } = scope;
  const {
    handleProjectViewChange,
    handleHeaderTabChange,
    propertyScopeKey,
    setPropertyViewSettings,
    propertyFilterPropertyId,
    handlePropertyFilterPropertyChange,
    handlePropertyFilterChange,
    handlePropertyGroupByChange,
    propertyView,
    availablePropertyIds,
    applicablePropertyFilter,
    applicablePropertyGroupBy,
  } = interactions;

  const [kanbanGroupBy, setKanbanGroupBy] = useState<WorkItemsKanbanGroup>(
    WORK_ITEMS_KANBAN_GROUP.STATUS
  );
  const [tableColumns, setTableColumns] = useState<string[] | null>(null);
  const [tableSort, setTableSort] = useState<WorkItemsTableSort | null>(null);

  const { savedViewsControl } = useWorkItemsSavedViews({
    state,
    isWorkItemsSurface,
    orgId,
    resolvedProjectSlug,
    savedViewPreferenceOwnerId,
    propertyScopeKey,
    setPropertyViewSettings,
    applicablePropertyFilter,
    applicablePropertyGroupBy,
    handleHeaderTabChange,
    kanbanGroupBy,
    setKanbanGroupBy,
    tableColumns,
    setTableColumns,
    tableSort,
    setTableSort,
  });

  const {
    projectSurfaceControls,
    workItemsSearchControl,
    workItemsEndControl,
  } = useWorkItemsSurfaceControls({
    state,
    activeProjectView,
    isWorkItemsSurface,
    useSplitListHeader,
    handleProjectViewChange,
    handleHeaderTabChange,
    kanbanGroupBy,
    setKanbanGroupBy,
    listFullscreen,
    setListFullscreen,
    propertyView,
    availablePropertyIds,
    propertyFilterPropertyId,
    applicablePropertyFilter,
    applicablePropertyGroupBy,
    handlePropertyFilterPropertyChange,
    handlePropertyFilterChange,
    handlePropertyGroupByChange,
    availableMembers,
    savedViewsControl,
  });

  return {
    kanbanGroupBy,
    tableColumns,
    setTableColumns,
    tableSort,
    setTableSort,
    projectSurfaceControls,
    workItemsSearchControl,
    workItemsEndControl,
  };
}

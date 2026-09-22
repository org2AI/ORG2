import React, {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useMemo,
} from "react";

import type { SavedView, SavedViewDisplay } from "@src/api/http/project";

import SavedViewsControl from "../components/SavedViewsControl";
import type { WorkItemsTableSort } from "../components/WorkItemsTableView";
import type { WorkItemPropertyFilter } from "../propertyViewModel";
import type { StatusFilterType, WorkItemsViewTab } from "../types";
import {
  WORK_ITEMS_KANBAN_GROUP,
  type WorkItemsKanbanGroup,
} from "../workItemsViewModel";
import type { useWorkItems } from "./useWorkItems";
import type { WorkItemsPropertyViewSettings } from "./useWorkItemsPropertyView";
import { WORK_ITEMS_VIEW_TABS } from "./useWorkItemsSurfaceControls";

interface UseWorkItemsSavedViewsParams {
  state: ReturnType<typeof useWorkItems>["state"];
  isWorkItemsSurface: boolean;
  orgId: string;
  resolvedProjectSlug: string | null;
  savedViewPreferenceOwnerId: string;
  propertyScopeKey: string;
  setPropertyViewSettings: Dispatch<
    SetStateAction<WorkItemsPropertyViewSettings>
  >;
  applicablePropertyFilter: WorkItemPropertyFilter | null;
  applicablePropertyGroupBy: string | null;
  handleHeaderTabChange: (nextTab: WorkItemsViewTab) => void;
  kanbanGroupBy: WorkItemsKanbanGroup;
  setKanbanGroupBy: Dispatch<SetStateAction<WorkItemsKanbanGroup>>;
  tableColumns: string[] | null;
  setTableColumns: Dispatch<SetStateAction<string[] | null>>;
  tableSort: WorkItemsTableSort | null;
  setTableSort: Dispatch<SetStateAction<WorkItemsTableSort | null>>;
}

/**
 * Saved-view control for the Work Items header: snapshots the current query /
 * display settings and applies a stored view back onto page state.
 */
export function useWorkItemsSavedViews({
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
}: UseWorkItemsSavedViewsParams) {
  const handleApplySavedView = useCallback(
    (view: SavedView, display: SavedViewDisplay) => {
      const query = view.query ?? {};
      if (typeof query.statusFilter === "string") {
        state.setStatusFilter(query.statusFilter as StatusFilterType);
      }
      state.setSearchQuery(
        typeof query.searchQuery === "string" ? query.searchQuery : ""
      );
      const nextPropertyFilter = query.propertyFilter;
      const validPropertyFilter =
        nextPropertyFilter &&
        typeof nextPropertyFilter.propertyId === "string" &&
        typeof nextPropertyFilter.valueToken === "string"
          ? nextPropertyFilter
          : null;
      setPropertyViewSettings({
        scopeKey: propertyScopeKey,
        selectedPropertyId: validPropertyFilter?.propertyId ?? null,
        filter: validPropertyFilter,
        groupBy:
          typeof display.propertyGroupBy === "string"
            ? display.propertyGroupBy
            : null,
      });
      handleHeaderTabChange(
        typeof display.viewTab === "string" &&
          (WORK_ITEMS_VIEW_TABS as readonly string[]).includes(display.viewTab)
          ? (display.viewTab as WorkItemsViewTab)
          : "List"
      );
      setKanbanGroupBy(
        typeof display.kanbanGroupBy === "string"
          ? (display.kanbanGroupBy as WorkItemsKanbanGroup)
          : WORK_ITEMS_KANBAN_GROUP.STATUS
      );
      setTableColumns(
        Array.isArray(display.tableColumns) ? display.tableColumns : null
      );
      setTableSort(
        typeof display.sortBy === "string" &&
          (display.sortDirection === "asc" || display.sortDirection === "desc")
          ? {
              sortBy: display.sortBy,
              sortDirection: display.sortDirection,
            }
          : null
      );
    },
    [
      handleHeaderTabChange,
      propertyScopeKey,
      setKanbanGroupBy,
      setPropertyViewSettings,
      setTableColumns,
      setTableSort,
      state,
    ]
  );

  const savedViewsControl = useMemo(
    () =>
      isWorkItemsSurface ? (
        <SavedViewsControl
          orgId={orgId}
          projectSlug={resolvedProjectSlug ?? null}
          preferenceOwnerId={savedViewPreferenceOwnerId}
          currentQuery={{
            statusFilter: state.statusFilter,
            searchQuery: state.searchQuery,
            propertyFilter: applicablePropertyFilter ?? undefined,
          }}
          currentDisplay={{
            viewTab: state.activeTab,
            kanbanGroupBy,
            tableColumns: tableColumns ?? undefined,
            propertyGroupBy: applicablePropertyGroupBy ?? undefined,
            sortBy: tableSort?.sortBy,
            sortDirection: tableSort?.sortDirection,
          }}
          onApply={handleApplySavedView}
        />
      ) : null,
    [
      orgId,
      handleApplySavedView,
      isWorkItemsSurface,
      kanbanGroupBy,
      applicablePropertyFilter,
      applicablePropertyGroupBy,
      resolvedProjectSlug,
      savedViewPreferenceOwnerId,
      state.activeTab,
      state.searchQuery,
      state.statusFilter,
      tableColumns,
      tableSort,
    ]
  );

  return { savedViewsControl };
}

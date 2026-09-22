import { useCallback, useMemo, useState } from "react";

import {
  type WorkItemPropertyFilter,
  filterWorkItemsByProperty,
  indexScopePropertyValues,
} from "../propertyViewModel";
import { useWorkItemPropertyView } from "./useWorkItemPropertyView";
import type { useWorkItems } from "./useWorkItems";

type WorkItemsPageData = ReturnType<typeof useWorkItems>["data"];
type WorkItemsPageProjectData = ReturnType<typeof useWorkItems>["projectData"];

export interface WorkItemsPropertyViewSettings {
  scopeKey: string;
  selectedPropertyId: string | null;
  filter: WorkItemPropertyFilter | null;
  groupBy: string | null;
}

interface UseWorkItemsPropertyViewParams {
  project: WorkItemsPageProjectData["project"];
  cachedProjectSlug?: string;
  isActive: boolean;
  filteredWorkItems: WorkItemsPageData["filteredWorkItems"];
  groupedWorkItems: WorkItemsPageData["groupedWorkItems"];
  kanbanTasks: WorkItemsPageData["kanbanTasks"];
  ganttTasks: WorkItemsPageData["ganttTasks"];
  calendarEvents: WorkItemsPageData["calendarEvents"];
}

/**
 * Scope-keyed property filter / group-by settings for the Work Items page plus
 * the property-filtered projections of every view's data set.
 */
export function useWorkItemsPropertyView({
  project,
  cachedProjectSlug,
  isActive,
  filteredWorkItems,
  groupedWorkItems,
  kanbanTasks,
  ganttTasks,
  calendarEvents,
}: UseWorkItemsPropertyViewParams) {
  const propertyOrgId = project?.orgId ?? "personal-org";
  const propertyProjectSlug = project?.slug ?? cachedProjectSlug ?? null;
  const propertyScopeKey = JSON.stringify([propertyOrgId, propertyProjectSlug]);
  const [propertyViewSettings, setPropertyViewSettings] =
    useState<WorkItemsPropertyViewSettings>(() => ({
      scopeKey: propertyScopeKey,
      selectedPropertyId: null,
      filter: null,
      groupBy: null,
    }));
  const propertySettingsMatchScope =
    propertyViewSettings.scopeKey === propertyScopeKey;
  const propertyFilterPropertyId = propertySettingsMatchScope
    ? propertyViewSettings.selectedPropertyId
    : null;
  const propertyFilter = propertySettingsMatchScope
    ? propertyViewSettings.filter
    : null;
  const propertyGroupBy = propertySettingsMatchScope
    ? propertyViewSettings.groupBy
    : null;
  const handlePropertyFilterPropertyChange = useCallback(
    (selectedPropertyId: string | null) => {
      setPropertyViewSettings((current) => {
        const currentFilter =
          current.scopeKey === propertyScopeKey ? current.filter : null;
        return {
          scopeKey: propertyScopeKey,
          selectedPropertyId,
          filter:
            currentFilter?.propertyId === selectedPropertyId
              ? currentFilter
              : null,
          groupBy:
            current.scopeKey === propertyScopeKey ? current.groupBy : null,
        };
      });
    },
    [propertyScopeKey]
  );
  const handlePropertyFilterChange = useCallback(
    (filter: WorkItemPropertyFilter | null) => {
      setPropertyViewSettings((current) => ({
        scopeKey: propertyScopeKey,
        selectedPropertyId:
          filter?.propertyId ??
          (current.scopeKey === propertyScopeKey
            ? current.selectedPropertyId
            : null),
        filter,
        groupBy: current.scopeKey === propertyScopeKey ? current.groupBy : null,
      }));
    },
    [propertyScopeKey]
  );
  const handlePropertyGroupByChange = useCallback(
    (groupBy: string | null) => {
      setPropertyViewSettings((current) => ({
        scopeKey: propertyScopeKey,
        selectedPropertyId:
          current.scopeKey === propertyScopeKey
            ? current.selectedPropertyId
            : null,
        filter: current.scopeKey === propertyScopeKey ? current.filter : null,
        groupBy,
      }));
    },
    [propertyScopeKey]
  );
  const propertyView = useWorkItemPropertyView({
    orgId: propertyOrgId,
    projectSlug: propertyProjectSlug,
    isActive,
  });
  const availablePropertyIds = useMemo(
    () => new Set(propertyView.definitions.map((definition) => definition.id)),
    [propertyView.definitions]
  );
  const applicablePropertyFilter =
    propertyView.ready &&
    propertyFilter &&
    availablePropertyIds.has(propertyFilter.propertyId)
      ? propertyFilter
      : null;
  const applicablePropertyGroupBy =
    propertyView.ready &&
    propertyGroupBy &&
    availablePropertyIds.has(propertyGroupBy)
      ? propertyGroupBy
      : null;
  const propertyValuesByItem = useMemo(
    () => indexScopePropertyValues(propertyView.values),
    [propertyView.values]
  );
  const propertyFilteredWorkItems = useMemo(
    () =>
      filterWorkItemsByProperty(
        filteredWorkItems,
        applicablePropertyFilter,
        propertyValuesByItem
      ),
    [applicablePropertyFilter, filteredWorkItems, propertyValuesByItem]
  );
  const propertyFilteredIds = useMemo(
    () => new Set(propertyFilteredWorkItems.map((item) => item.session_id)),
    [propertyFilteredWorkItems]
  );
  const propertyGroupedWorkItems = useMemo(
    () =>
      groupedWorkItems.map((group) => ({
        ...group,
        items: group.items.filter((item) =>
          propertyFilteredIds.has(item.session_id)
        ),
      })),
    [groupedWorkItems, propertyFilteredIds]
  );
  const propertyKanbanTasks = useMemo(
    () => kanbanTasks.filter((task) => propertyFilteredIds.has(task.id)),
    [kanbanTasks, propertyFilteredIds]
  );
  const propertyGanttTasks = useMemo(
    () => ganttTasks.filter((task) => propertyFilteredIds.has(task.id)),
    [ganttTasks, propertyFilteredIds]
  );
  const propertyCalendarEvents = useMemo(
    () => calendarEvents.filter((event) => propertyFilteredIds.has(event.id)),
    [calendarEvents, propertyFilteredIds]
  );

  return {
    propertyOrgId,
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
    propertyFilteredWorkItems,
    propertyGroupedWorkItems,
    propertyKanbanTasks,
    propertyGanttTasks,
    propertyCalendarEvents,
  };
}

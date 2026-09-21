import type { Dispatch, SetStateAction } from "react";

import type { WorkItemsPageProps } from "../workItemsPageProps";
import type { useWorkItems } from "./useWorkItems";
import { useWorkItemsPageActions } from "./useWorkItemsPageActions";
import { useWorkItemsPropertyView } from "./useWorkItemsPropertyView";

interface UseWorkItemsPageInteractionsParams extends Pick<
  WorkItemsPageProps,
  "cachedProjectSlug" | "onProjectViewChange" | "onExpandWorkItemToTab"
> {
  workItems: ReturnType<typeof useWorkItems>;
  isActive: boolean;
  setListFullscreen: Dispatch<SetStateAction<boolean>>;
  setCollapseAllSignal: Dispatch<SetStateAction<number>>;
  setHasWorkItemPendingChanges: Dispatch<SetStateAction<boolean>>;
}

/**
 * List interactions of the Work Items page: the page handlers (tab / surface
 * switching, open / close / delete, collapse, status filter) and the custom
 * property filter / group-by view over the loaded work items.
 */
export function useWorkItemsPageInteractions({
  workItems,
  cachedProjectSlug,
  isActive,
  setListFullscreen,
  setCollapseAllSignal,
  setHasWorkItemPendingChanges,
  onProjectViewChange,
  onExpandWorkItemToTab,
}: UseWorkItemsPageInteractionsParams) {
  const { state, data, projectData, handlers } = workItems;
  const { setStatusFilter } = state;

  const pageActions = useWorkItemsPageActions({
    handlers,
    activeTab: state.activeTab,
    workItems: data.workItems,
    selectedWorkItem: data.selectedWorkItem,
    setStatusFilter,
    setListFullscreen,
    setCollapseAllSignal,
    setHasWorkItemPendingChanges,
    onProjectViewChange,
    onExpandWorkItemToTab,
  });

  const propertyViewState = useWorkItemsPropertyView({
    project: projectData.project,
    cachedProjectSlug,
    isActive,
    filteredWorkItems: data.filteredWorkItems,
    groupedWorkItems: data.groupedWorkItems,
    kanbanTasks: data.kanbanTasks,
    ganttTasks: data.ganttTasks,
    calendarEvents: data.calendarEvents,
  });

  return { ...pageActions, ...propertyViewState };
}

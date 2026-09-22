import type { WorkItemStatus } from "@src/types/core/workItem";

import type { WorkItemsPageProps } from "../workItemsPageProps";
import type { useWorkItems } from "./useWorkItems";
import { useWorkItemsProjectSyncAdapter } from "./useWorkItemsProjectSyncAdapter";
import { useWorkItemsSync } from "./useWorkItemsSync";
import { useWorkItemsTabBarState } from "./useWorkItemsTabBarState";

interface UseWorkItemsPageIntegrationsParams extends Pick<
  WorkItemsPageProps,
  | "onProjectDeleted"
  | "workStationTabId"
  | "projectId"
  | "onCreateWorkItem"
  | "onEmbeddedWorkItemDetailStateChange"
> {
  workItems: ReturnType<typeof useWorkItems>;
  projectName: string;
  resolvedProjectSlug: string | null;
  isActive: boolean;
  onAddListItem: (status: WorkItemStatus) => void;
}

/**
 * Outside integrations of the Work Items page: project sync (delete
 * propagation and the story sync adapter) and the Workstation tab bar
 * registration.
 */
export function useWorkItemsPageIntegrations({
  workItems,
  projectName,
  onProjectDeleted,
  resolvedProjectSlug,
  isActive,
  workStationTabId,
  projectId,
  onCreateWorkItem,
  onAddListItem,
  onEmbeddedWorkItemDetailStateChange,
}: UseWorkItemsPageIntegrationsParams) {
  const { state, data, projectData, handlers } = workItems;

  const { handleDeleteProject } = useWorkItemsSync({
    project: projectData.project,
    projectName,
    rawMembers: projectData.rawMembers,
    workItemCount: data.workItems.length,
    onProjectDeleted,
  });

  const projectSyncAdapterId =
    useWorkItemsProjectSyncAdapter(resolvedProjectSlug);

  const {
    actionsInStationTabBar: tabBarActionsInStationTabBar,
    propertiesActionAvailable,
  } = useWorkItemsTabBarState({
    activeTab: state.activeTab,
    showProperties: state.showProperties,
    isActive,
    workStationTabId,
    projectId,
    projectName,
    resolvedProjectSlug,
    selectedWorkItem: data.selectedWorkItem,
    onToggleProperties: handlers.handleToggleProperties,
    onCreateWorkItem,
    onAddListItem,
    onEmbeddedWorkItemDetailStateChange,
  });

  return {
    handleDeleteProject,
    projectSyncAdapterId,
    tabBarActionsInStationTabBar,
    propertiesActionAvailable,
  };
}

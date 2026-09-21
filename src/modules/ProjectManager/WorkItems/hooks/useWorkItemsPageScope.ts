import type { WorkItemsPageProps } from "../workItemsPageProps";
import type { useWorkItems } from "./useWorkItems";
import { useWorkItemsHeaderState } from "./useWorkItemsHeaderState";
import { useWorkItemsPageEffects } from "./useWorkItemsPageEffects";
import { useWorkItemsPageModel } from "./useWorkItemsPageModel";

interface UseWorkItemsPageScopeParams extends Pick<
  WorkItemsPageProps,
  | "breadcrumbSegments"
  | "pageTitle"
  | "onOpenProjects"
  | "onProjectSlugResolved"
> {
  workItems: ReturnType<typeof useWorkItems>;
  tabProjectName: string;
  isActive: boolean;
  listFullscreen: boolean;
}

/**
 * The project the Work Items page shows: header title and source project,
 * the derived page model, and the page-level subscriptions (status-filter
 * reset, slug report, sync deep link).
 */
export function useWorkItemsPageScope({
  workItems,
  breadcrumbSegments,
  pageTitle,
  tabProjectName,
  onOpenProjects,
  onProjectSlugResolved,
  isActive,
  listFullscreen,
}: UseWorkItemsPageScopeParams) {
  const { state, data, projectData, handlers } = workItems;
  const { handleTabChange } = handlers;
  const { statusFilter, setStatusFilter } = state;

  const { projectName, headerTitle, sourceProject } = useWorkItemsHeaderState({
    pageTitle,
    tabProjectName,
    project: projectData.project,
    projectLoading: projectData.loading,
  });

  const pageModel = useWorkItemsPageModel({
    breadcrumbSegments,
    onOpenProjects,
    isActive,
    activeTab: state.activeTab,
    listFullscreen,
    workItems: data.workItems,
    selectedWorkItem: data.selectedWorkItem,
    getShortId: data.getShortId,
    project: projectData.project,
    rawMembers: projectData.rawMembers,
    sourceProject,
  });

  const { settingsSectionRequest } = useWorkItemsPageEffects({
    statusFilter,
    setStatusFilter,
    statusFilterKeys: pageModel.statusFilterKeys,
    resolvedSlug: projectData.project?.slug,
    onProjectSlugResolved,
    activeTab: state.activeTab,
    handleTabChange,
  });

  return {
    projectName,
    headerTitle,
    sourceProject,
    ...pageModel,
    settingsSectionRequest,
  };
}

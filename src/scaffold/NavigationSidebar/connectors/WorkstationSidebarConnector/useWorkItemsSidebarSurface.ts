import { useState } from "react";

import { useProjectsWorkItemMenuItems } from "../useProjectsWorkItemMenuItems/index";
import { useProjectsMenuItemClick } from "./useProjectsMenuItemClick";
import type { useSidebarStationNavigation } from "./useSidebarStationNavigation";

type StationNavigation = ReturnType<typeof useSidebarStationNavigation>;
interface WorkItemsSidebarSurfaceParams {
  enabled: boolean;
  activeProjectOrgId: Parameters<
    typeof useProjectsWorkItemMenuItems
  >[0]["selectedOrgId"];
  activateMyStationRouteForProjectTabContent: StationNavigation["activateMyStationRouteForProjectTabContent"];
}

/** Always mounted: visibility only gates the existing project data source. */
export function useWorkItemsSidebarSurface({
  enabled,
  activeProjectOrgId,
  activateMyStationRouteForProjectTabContent,
}: WorkItemsSidebarSurfaceParams) {
  const [projectsSelectedMenuItemId, setProjectsSelectedMenuItemId] =
    useState("");
  const [projectsCollapsedSectionIds, setProjectsCollapsedSectionIds] =
    useState<Set<string>>(() => new Set());
  const {
    menuItems: projectsWorkItemMenuItems,
    projectMap: projectsProjectMap,
    loading: projectsWorkItemsLoading,
    toChatPanelProject,
  } = useProjectsWorkItemMenuItems({
    enabled,
    searchQuery: "",
    selectedOrgId: activeProjectOrgId,
  });
  const handleProjectsMenuItemClick = useProjectsMenuItemClick({
    activateMyStationRouteForProjectTabContent,
    projectsProjectMap,
    setProjectsSelectedMenuItemId,
    toChatPanelProject,
  });

  return {
    menuItems: projectsWorkItemMenuItems,
    loading: projectsWorkItemsLoading,
    onMenuItemClick: handleProjectsMenuItemClick,
    selectedMenuItemId: projectsSelectedMenuItemId,
    setSelectedMenuItemId: setProjectsSelectedMenuItemId,
    collapsedSectionIds: projectsCollapsedSectionIds,
    onCollapsedSectionIdsChange: setProjectsCollapsedSectionIds,
  };
}

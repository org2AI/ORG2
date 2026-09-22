import { useSetAtom } from "jotai";
import { useCallback } from "react";

import {
  openCollabOrgSpotlight,
  openGitHubIssuesImportSpotlight,
} from "@src/scaffold/GlobalSpotlight/openSpotlight";
import type { NavigationMenuItem } from "@src/scaffold/NavigationSidebar/components/NavigationMenu/config";
import {
  openChatPanelCreateTargetAtom,
  openProjectInChatPanelTabAtom,
} from "@src/store/chatPanel/chatPanelTabsAtom";
import {
  CHAT_PANEL_CREATE_TARGET,
  type ChatPanelSelectedProject,
} from "@src/store/ui/chatPanel/selectionAtoms";

import {
  COLLAB_ADD_ORG_MENU_ITEM_ID,
  PROJECTS_IMPORT_GITHUB_ISSUES_MENU_ITEM_ID,
  PROJECTS_NEW_PROJECT_MENU_ITEM_ID,
  PROJECTS_NEW_WORK_ITEM_MENU_ITEM_ID,
} from "../sidebarConnectorUtils";
import { getProjectsProjectOverviewSlug } from "../useProjectsWorkItemMenuItems/index";

interface UseProjectsMenuItemClickParams<Project> {
  activateMyStationRouteForProjectTabContent: () => void;
  projectsProjectMap: ReadonlyMap<string, Project>;
  setProjectsSelectedMenuItemId: (id: string) => void;
  toChatPanelProject: (project: Project) => ChatPanelSelectedProject;
}

export function useProjectsMenuItemClick<Project>({
  activateMyStationRouteForProjectTabContent,
  projectsProjectMap,
  setProjectsSelectedMenuItemId,
  toChatPanelProject,
}: UseProjectsMenuItemClickParams<Project>): (
  key: string,
  item: NavigationMenuItem
) => void {
  // Project detail surfaces open as dedicated chat-pane tabs. Creator actions
  // target the singleton Launchpad instead.
  const openProjectTab = useSetAtom(openProjectInChatPanelTabAtom);
  const openCreateTarget = useSetAtom(openChatPanelCreateTargetAtom);
  return useCallback(
    (_key: string, item: NavigationMenuItem) => {
      if (item.id === COLLAB_ADD_ORG_MENU_ITEM_ID) {
        openCollabOrgSpotlight();
        return;
      }

      if (item.id === PROJECTS_NEW_PROJECT_MENU_ITEM_ID) {
        openCreateTarget({
          target: CHAT_PANEL_CREATE_TARGET.PROJECT,
        });
        return;
      }

      if (item.id === PROJECTS_IMPORT_GITHUB_ISSUES_MENU_ITEM_ID) {
        openGitHubIssuesImportSpotlight();
        return;
      }

      if (item.id === PROJECTS_NEW_WORK_ITEM_MENU_ITEM_ID) {
        openCreateTarget({ target: CHAT_PANEL_CREATE_TARGET.WORK_ITEM });
        return;
      }

      const projectOverviewSlug = getProjectsProjectOverviewSlug(item.id);
      if (!projectOverviewSlug) return;
      const project = projectsProjectMap.get(projectOverviewSlug);
      if (!project) return;
      activateMyStationRouteForProjectTabContent();
      setProjectsSelectedMenuItemId(item.id);
      openProjectTab(toChatPanelProject(project));
    },
    [
      activateMyStationRouteForProjectTabContent,
      openCreateTarget,
      openProjectTab,
      projectsProjectMap,
      setProjectsSelectedMenuItemId,
      toChatPanelProject,
    ]
  );
}

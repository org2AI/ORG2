import type {
  LabelEntry,
  MemberEntry,
  ProjectData,
} from "@src/api/http/project";
import type { NavigationMenuItem } from "@src/scaffold/NavigationSidebar/components/NavigationMenu/config";
import type { ChatPanelSelectedProject } from "@src/store/ui/chatPanel/selectionAtoms";

export interface SidebarProject {
  projectData: ProjectData;
  projectSyncAdapterId: string | null;
  orgId: string;
  orgName: string;
  labelMap: Map<string, LabelEntry>;
  memberMap: Map<string, MemberEntry>;
}

export interface UseProjectsWorkItemMenuItemsParams {
  enabled: boolean;
  searchQuery: string;
  selectedOrgId?: string;
}

export interface UseProjectsWorkItemMenuItemsResult {
  menuItems: NavigationMenuItem[];
  projectMap: Map<string, SidebarProject>;
  loading: boolean;
  toChatPanelProject: (project: SidebarProject) => ChatPanelSelectedProject;
}

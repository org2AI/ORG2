import { projectDataToUI } from "@src/api/http/project";
import type { ChatPanelSelectedProject } from "@src/store/ui/chatPanel/selectionAtoms";

import type { SidebarProject } from "./types";

export function toChatPanelProject(
  project: SidebarProject
): ChatPanelSelectedProject {
  return {
    project: projectDataToUI(project.projectData, {
      labelMap: project.labelMap,
      memberMap: project.memberMap,
    }),
    projectSlug: project.projectData.slug,
    projectSyncAdapterId: project.projectSyncAdapterId,
    orgId: project.orgId,
    orgName: project.orgName,
  };
}

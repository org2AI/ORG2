import React, { Suspense } from "react";

import { Placeholder } from "@src/components/Placeholder";
import type { useProjectOrgCloudPermissions } from "@src/features/Org2Cloud/useProjectOrgCloudPermissions";
import type {
  LinkedRepoOption,
  ProjectData,
} from "@src/modules/ProjectManager/shared";

import { OverviewPropertiesPanel } from "../components";
import { useBufferedProjectProperties } from "./useBufferedProjectProperties";
import { useEnsureStatusDefinitions } from "./useStatusDefinitions";
import type { useWorkItems } from "./useWorkItems";
import type { useWorkItemsPageEffects } from "./useWorkItemsPageEffects";
import type { useWorkItemsSync } from "./useWorkItemsSync";

const WorkItemsSettings = React.lazy(
  () => import("../components/WorkItemsSettings")
);

interface UseWorkItemsProjectPanesParams {
  projectId: string;
  projectName: string;
  sourceProject: ProjectData;
  onProjectUpdate: (updates: Partial<ProjectData>) => void;
  hasWorkItemPendingChanges: boolean;
  onSetUnsaved?: (unsaved: boolean) => void;
  onProjectNameUpdated?: (projectName: string) => void;
  projectData: ReturnType<typeof useWorkItems>["projectData"];
  availableRepos: LinkedRepoOption[];
  resolvedProjectSlug: string | null;
  canAdministerProjectOrg: ReturnType<
    typeof useProjectOrgCloudPermissions
  >["canAdminister"];
  handleDeleteProject: ReturnType<
    typeof useWorkItemsSync
  >["handleDeleteProject"];
  onOpenRepoSettings?: () => void;
  settingsSectionRequest: ReturnType<
    typeof useWorkItemsPageEffects
  >["settingsSectionRequest"];
}

/**
 * Project-level panes of the Work Items page: the buffered project
 * properties (Overview side panel) and the lazily loaded Settings view.
 */
export function useWorkItemsProjectPanes({
  projectId,
  projectName,
  sourceProject,
  onProjectUpdate,
  hasWorkItemPendingChanges,
  onSetUnsaved,
  onProjectNameUpdated,
  projectData,
  availableRepos,
  resolvedProjectSlug,
  canAdministerProjectOrg,
  handleDeleteProject,
  onOpenRepoSettings,
  settingsSectionRequest,
}: UseWorkItemsProjectPanesParams) {
  const {
    displayProject,
    handleLocalProjectUpdate,
    handleUpdateProjectMembers,
    handleProjectNameChange,
    handleProjectDescriptionChange,
    handleWorkItemPrefixUpdate,
  } = useBufferedProjectProperties({
    projectId,
    sourceProject,
    onProjectUpdate,
    hasWorkItemPendingChanges,
    onSetUnsaved,
    onProjectNameUpdated,
  });

  useEnsureStatusDefinitions(displayProject.orgId ?? "personal-org");

  const overviewPropertiesPanel = (
    <OverviewPropertiesPanel
      project={displayProject}
      onUpdate={handleLocalProjectUpdate}
      availableMembers={projectData.availableMembers}
      availableTeams={projectData.availableTeams}
      availableLabels={projectData.availableLabels}
      availableRepos={availableRepos}
    />
  );

  const settingsContent = (
    <Suspense fallback={<Placeholder variant="loading" />}>
      <WorkItemsSettings
        orgId={displayProject.orgId ?? "personal-org"}
        members={projectData.rawMembers}
        onUpdateMembers={projectData.updateMembers}
        labels={projectData.rawLabels}
        onUpdateLabels={projectData.updateLabels}
        slug={resolvedProjectSlug ?? projectId}
        projectName={projectName}
        workItemPrefix={displayProject.workItemPrefix ?? "PRJ"}
        workItemPrefixCustom={displayProject.workItemPrefixCustom ?? false}
        onUpdateWorkItemPrefix={handleWorkItemPrefixUpdate}
        onDeleteProject={
          canAdministerProjectOrg(displayProject.orgId)
            ? handleDeleteProject
            : undefined
        }
        projectMembers={displayProject.members ?? []}
        onUpdateProjectMembers={handleUpdateProjectMembers}
        onOpenRepoSettings={onOpenRepoSettings}
        sectionRequest={settingsSectionRequest}
      />
    </Suspense>
  );

  const resolvedProjectDescription =
    displayProject.description ?? projectData.project?.description;

  return {
    displayProject,
    handleLocalProjectUpdate,
    handleProjectNameChange,
    handleProjectDescriptionChange,
    overviewPropertiesPanel,
    settingsContent,
    resolvedProjectDescription,
  };
}

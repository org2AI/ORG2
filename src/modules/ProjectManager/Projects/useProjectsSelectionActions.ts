import { emit } from "@tauri-apps/api/event";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { STORY_SYNC_ADAPTER } from "@src/api/http/integrations/syncConnections";
import { projectApi, projectSyncApi } from "@src/api/http/project";
import Message from "@src/components/Message";
import type { useProjectOrgCloudPermissions } from "@src/features/Org2Cloud/useProjectOrgCloudPermissions";
import {
  WORKSPACE_SOURCE,
  type WorkspaceProject,
} from "@src/modules/ProjectManager/workspaceAggregate";
import type { Project } from "@src/types/core/project";
import { confirmDestructiveAction } from "@src/util/dialogs/confirmDestructiveAction";

interface UseProjectsSelectionActionsParams {
  fileProjects: WorkspaceProject[];
  filteredProjects: WorkspaceProject[];
  loadFileProjects: () => Promise<void>;
  canAdministerProjectOrg: ReturnType<
    typeof useProjectOrgCloudPermissions
  >["canAdminister"];
}

/**
 * Multi-select state and the destructive project actions of the Projects
 * page: single / bulk delete and detaching a GitHub-synced project source.
 */
export function useProjectsSelectionActions({
  fileProjects,
  filteredProjects,
  loadFileProjects,
  canAdministerProjectOrg,
}: UseProjectsSelectionActionsParams) {
  const { t } = useTranslation("projects");
  const [selectedProjectIds, setSelectedProjectIds] = useState<Set<string>>(
    new Set()
  );
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [unlinkingProjectId, setUnlinkingProjectId] = useState<string | null>(
    null
  );

  // Linear rows are read-only. Managed-cloud projects additionally require
  // an owner/admin role; the backend remains authoritative, while this gate
  // keeps forbidden single and bulk delete controls out of the member UX.
  const isProjectDeletable = useCallback(
    (project: WorkspaceProject) =>
      project.workspaceSource?.source !== WORKSPACE_SOURCE.LINEAR &&
      canAdministerProjectOrg(project.orgId),
    [canAdministerProjectOrg]
  );

  const isProjectSourceUnlinkable = useCallback(
    (project: WorkspaceProject) =>
      project.workspaceSource?.source !== WORKSPACE_SOURCE.LINEAR &&
      project.syncAdapterId === STORY_SYNC_ADAPTER.GITHUB &&
      Boolean(project.slug) &&
      canAdministerProjectOrg(project.orgId),
    [canAdministerProjectOrg]
  );

  const showCheckboxesOnAllRows = selectedProjectIds.size > 0;
  const selectableFilteredProjectCount = useMemo(
    () => filteredProjects.filter(isProjectDeletable).length,
    [filteredProjects, isProjectDeletable]
  );

  const handleProjectCheckedChange = useCallback(
    (projectId: string, checked: boolean) => {
      const project = fileProjects.find((item) => item.id === projectId);
      if (project && !isProjectDeletable(project)) return;
      setSelectedProjectIds((previous) => {
        const next = new Set(previous);
        if (checked) {
          next.add(projectId);
        } else {
          next.delete(projectId);
        }
        return next;
      });
    },
    [fileProjects, isProjectDeletable]
  );

  const handleSelectAllProjects = useCallback(() => {
    setSelectedProjectIds(
      new Set(
        filteredProjects.filter(isProjectDeletable).map((project) => project.id)
      )
    );
  }, [filteredProjects, isProjectDeletable]);

  const handleUnselectAllProjects = useCallback(() => {
    setSelectedProjectIds(new Set());
  }, []);

  const handleBulkDeleteProjects = useCallback(async () => {
    const projectIds = Array.from(selectedProjectIds);
    if (projectIds.length === 0) return;

    const confirmed = await confirmDestructiveAction({
      title: t("common:actions.confirmDelete"),
      message: t("common:actions.confirmDeleteMessage"),
      okLabel: t("common:actions.delete"),
      cancelLabel: t("common:actions.cancel"),
    });
    if (!confirmed) return;

    setBulkDeleting(true);
    try {
      const projectById = new Map(
        fileProjects.map((project) => [project.id, project])
      );
      for (const projectId of projectIds) {
        const project = projectById.get(projectId);
        if (!project) continue;
        // Defensive re-check: the collab role may have changed between
        // selection and delete (see isProjectDeletable above).
        if (!isProjectDeletable(project)) continue;
        const slug =
          project.slug ||
          project.name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "");
        await projectApi.deleteProject(slug);
      }
      await emit("orgii-data-changed");
      setSelectedProjectIds(new Set());
      await loadFileProjects();
    } finally {
      setBulkDeleting(false);
    }
  }, [
    selectedProjectIds,
    t,
    fileProjects,
    isProjectDeletable,
    loadFileProjects,
  ]);

  const handleDeleteProject = useCallback(
    async (project: Project) => {
      const slug =
        project.slug ||
        project.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "");
      await projectApi.deleteProject(slug);
      await emit("orgii-data-changed");
      setSelectedProjectIds((previous) => {
        const next = new Set(previous);
        next.delete(project.id);
        return next;
      });
      await loadFileProjects();
    },
    [loadFileProjects]
  );

  const handleUnlinkProjectSource = useCallback(
    async (project: WorkspaceProject) => {
      if (
        unlinkingProjectId !== null ||
        !project.slug ||
        !isProjectSourceUnlinkable(project)
      ) {
        return;
      }

      const confirmed = await confirmDestructiveAction({
        title: t("settings.sync.adapterPicker.detachProjectTitle", {
          project: project.name,
        }),
        message: t("settings.sync.adapterPicker.detachProjectDescription"),
        okLabel: t("settings.sync.adapterPicker.detachProjectMenuLabel"),
        cancelLabel: t("common:actions.cancel"),
      });
      if (!confirmed) return;

      setUnlinkingProjectId(project.id);
      try {
        await projectSyncApi.detachAdapter(project.slug);
        setSelectedProjectIds((previous) => {
          const next = new Set(previous);
          next.delete(project.id);
          return next;
        });
        await loadFileProjects();
        Message.success(
          t("settings.sync.adapterPicker.detachProjectSuccess", {
            project: project.name,
          })
        );
      } catch (error) {
        Message.error(
          t("settings.sync.errors.detachFailed", {
            error: error instanceof Error ? error.message : String(error),
          })
        );
      } finally {
        setUnlinkingProjectId(null);
      }
    },
    [isProjectSourceUnlinkable, loadFileProjects, t, unlinkingProjectId]
  );

  return {
    selectedProjectIds,
    bulkDeleting,
    unlinkingProjectId,
    isProjectDeletable,
    isProjectSourceUnlinkable,
    showCheckboxesOnAllRows,
    selectableFilteredProjectCount,
    handleProjectCheckedChange,
    handleSelectAllProjects,
    handleUnselectAllProjects,
    handleBulkDeleteProjects,
    handleDeleteProject,
    handleUnlinkProjectSource,
  };
}

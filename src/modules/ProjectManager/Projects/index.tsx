/**
 * Projects Page
 *
 * Lists projects from the centralized `.orgii` project store.
 * "Add Project" opens in a separate tab (handled by ProjectManagerLayout).
 * Repo settings are a separate tab — this page is list-only.
 */
import { useAtomValue } from "jotai";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Placeholder } from "@src/components/Placeholder";
import { ROUTES } from "@src/config/routes";
import { useProjectOrgCloudPermissions } from "@src/features/Org2Cloud/useProjectOrgCloudPermissions";
import { useAppNavigate as useNavigate } from "@src/hooks/navigation/useAppNavigate";
import { useProjectDataChanged } from "@src/hooks/project";
import type { LinearProjectSelection } from "@src/modules/ProjectManager/Panels/ProjectManagerSidebar/content/WorkspaceTreeContent";
import WorkItemSection from "@src/modules/ProjectManager/WorkItems/components/WorkItemSection";
import { MultiSelectBar } from "@src/modules/ProjectManager/WorkItems/components/WorkItemsFooterBars";
import { getProjectStatusConfig } from "@src/modules/ProjectManager/config/manage";
import { useProjectManagerWorkItemsTabBarRegistration } from "@src/modules/ProjectManager/hooks/useProjectManagerWorkItemsTabBarRegistration";
import type { ProjectManagerBreadcrumbSegment } from "@src/modules/ProjectManager/shared/components/ProjectManagerBreadcrumb";
import VirtualizedGroupedList from "@src/modules/ProjectManager/shared/components/VirtualizedGroupedList";
import { PROJECT_MANAGER_PLACEHOLDER_PLACEMENT } from "@src/modules/ProjectManager/shared/placeholderTokens";
import { WORKSPACE_SOURCE } from "@src/modules/ProjectManager/workspaceAggregate";
import { projectListRefreshAtom } from "@src/store/project/projectAtom";

import { ProjectRow, ProjectsPageHeader } from "./components";
import {
  type ProjectsGroupMode,
  type WorkspaceSourceMode,
} from "./projectsUtils";
import { useProjectsFileData } from "./useProjectsFileData";
import { useProjectsGrouping } from "./useProjectsGrouping";
import { useProjectsHeaderControls } from "./useProjectsHeaderControls";
import { useProjectsSelectionActions } from "./useProjectsSelectionActions";

// ============================================
// Types
// ============================================

// Stable base shape used as a DropdownOption foundation for non-status groups.
// value/color/icon are always overridden by the group; only label/bgColor are
// inherited (WorkItemSection only reads color and icon from statusConfig).
const SECTION_BASE_CONFIG = getProjectStatusConfig("planned");

interface ProjectsPageProps {
  breadcrumbSegments?: readonly ProjectManagerBreadcrumbSegment[];
  /** Callback to open a project as a tab (in the unified tab system) */
  onOpenProject?: (
    projectId: string,
    projectName: string,
    projectSlug?: string
  ) => void;
  /** Callback to open the "New Project" tab */
  onAddProject?: () => void;
  /** Callback to open a Linear project when Workspace includes Linear rows. */
  onOpenLinearProject?: (selection: LinearProjectSelection) => void;
  orgId?: string;
  allowExternalSources?: boolean;
  /** Publish page controls into the global WorkstationTabHeader. */
  publishToWorkstationHeader?: boolean;
  /** Workstation tab id used to publish tab-bar trailing controls. */
  workStationTabId?: string;
  /** Host slot used by the global WorkstationTabHeader. */
  workstationHeaderHost?: "project" | "workManagement";
  /** Hide shell chrome and keep published controls together on the left. */
  selfContainedWorkstationHeader?: boolean;
  /** Keep controls in a dedicated local 36px row below host chrome. */
  surfaceOwnedHeader?: boolean;
  /** Parent-owned context control leading the dedicated surface row. */
  surfaceHeaderLeading?: React.ReactNode;
  /** Org hub surface pills shown after the breadcrumb (Overview / Projects / …). */
  orgSurfaceControls?: React.ReactNode;
}

// ============================================
// Component
// ============================================

const ProjectsPage: React.FC<ProjectsPageProps> = ({
  breadcrumbSegments,
  onOpenProject,
  onAddProject,
  onOpenLinearProject,
  orgId,
  allowExternalSources = false,
  publishToWorkstationHeader = false,
  workStationTabId,
  workstationHeaderHost = "project",
  selfContainedWorkstationHeader = false,
  surfaceOwnedHeader = false,
  surfaceHeaderLeading,
  orgSurfaceControls,
}) => {
  const { t } = useTranslation("projects");
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  const [groupMode, setGroupMode] = useState<ProjectsGroupMode>("status");
  const [collapseAllSignal, setCollapseAllSignal] = useState(0);
  const [workspaceSourceMode, setWorkspaceSourceMode] =
    useState<WorkspaceSourceMode>("local_only");

  const pageTitle = t("projects.dashboardTitle");
  const includeExternalSources =
    allowExternalSources && workspaceSourceMode === "include_external";

  // Watch for refresh signals after project creation or deletion
  const refreshSignal = useAtomValue(projectListRefreshAtom);

  useEffect(() => {
    if (!allowExternalSources) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- pre-existing reset of the source-mode pill when a host disables external sources; the React Compiler rule only started analysing this component once its body was split into hooks
      setWorkspaceSourceMode("local_only");
    }
  }, [allowExternalSources]);

  const {
    fileProjects,
    fileProjectsLoading,
    fileProjectsLoaded,
    fileError,
    loadProjectsForRepo,
    loadFileProjects,
  } = useProjectsFileData({ orgId, includeExternalSources });

  useEffect(() => {
    void loadProjectsForRepo();
  }, [loadProjectsForRepo, refreshSignal]);

  useProjectDataChanged(
    useCallback(() => {
      void loadFileProjects();
    }, [loadFileProjects])
  );

  const filteredProjects = useMemo(() => {
    if (!searchQuery.trim()) return fileProjects;
    const query = searchQuery.toLowerCase();
    return fileProjects.filter((project) => {
      const name = project.name.toLowerCase();
      const description = (project.description || "").toLowerCase();
      return name.includes(query) || description.includes(query);
    });
  }, [fileProjects, searchQuery]);

  const groupedProjects = useProjectsGrouping({ filteredProjects, groupMode });
  const { canAdminister: canAdministerProjectOrg } =
    useProjectOrgCloudPermissions();

  const {
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
  } = useProjectsSelectionActions({
    fileProjects,
    filteredProjects,
    loadFileProjects,
    canAdministerProjectOrg,
  });

  const loading = fileProjectsLoading;
  const showInitialLoading = loading && !fileProjectsLoaded;

  // ---- Navigation ----

  const handleProjectClick = useCallback(
    (projectId: string) => {
      const project = fileProjects.find((item) => item.id === projectId);
      if (
        project?.workspaceSource?.source === WORKSPACE_SOURCE.LINEAR &&
        onOpenLinearProject
      ) {
        onOpenLinearProject({
          connectionId: project.workspaceSource.connectionId,
          projectId: project.workspaceSource.projectId,
          projectName: project.workspaceSource.projectName,
          teamId: project.workspaceSource.teamId,
          teamName: project.workspaceSource.teamName,
        });
        return;
      }

      if (onOpenProject) {
        const name = project?.name ?? projectId;
        onOpenProject(projectId, name, project?.slug);
      } else {
        navigate(`${ROUTES.workStation.project.path}?project=${projectId}`);
      }
    },
    [onOpenLinearProject, onOpenProject, fileProjects, navigate]
  );

  const handleRefresh = useCallback(() => {
    loadFileProjects();
  }, [loadFileProjects]);

  const handleCollapseAll = useCallback(() => {
    setCollapseAllSignal((currentSignal) => currentSignal + 1);
  }, []);

  const { headerLeadingControls, headerTrailingControls } =
    useProjectsHeaderControls({
      groupMode,
      setGroupMode,
      allowExternalSources,
      workspaceSourceMode,
      setWorkspaceSourceMode,
      searchQuery,
      setSearchQuery,
      orgSurfaceControls,
    });

  const virtualProjectGroups = useMemo(
    () =>
      groupedProjects.map((group) => ({
        key: group.key,
        group,
        items: group.projects,
      })),
    [groupedProjects]
  );

  const defaultProjectGroupExpanded = useCallback(
    () => collapseAllSignal === 0,
    [collapseAllSignal]
  );

  useProjectManagerWorkItemsTabBarRegistration({
    workStationTabId,
    enabled: publishToWorkstationHeader,
    showPropertiesActive: false,
    onSearch: null,
    onRefresh: handleRefresh,
    refreshLoading: loading,
    onToggleProperties: null,
    onAddProject,
    onAddWorkItem: null,
  });

  // ============================================
  // Render
  // ============================================

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <ProjectsPageHeader
        title={pageTitle}
        breadcrumbSegments={breadcrumbSegments}
        onCollapseAll={handleCollapseAll}
        onRefresh={handleRefresh}
        onAddProject={onAddProject}
        refreshLoading={loading}
        leadingControls={headerLeadingControls}
        trailingControls={headerTrailingControls}
        publishToWorkstationHeader={publishToWorkstationHeader}
        surfaceOwnedHeader={surfaceOwnedHeader}
        surfaceHeaderLeading={surfaceHeaderLeading}
        workstationHeaderHost={workstationHeaderHost}
        selfContainedWorkstationHeader={selfContainedWorkstationHeader}
      />

      <div className="min-h-0 flex-1 overflow-hidden">
        <div className="flex h-full flex-col overflow-hidden">
          <div className="scrollbar-hide min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
            {showInitialLoading ? (
              <Placeholder
                variant="loading"
                placement={PROJECT_MANAGER_PLACEHOLDER_PLACEMENT}
                title={t("projects.loading")}
                fillParentHeight
              />
            ) : fileError && fileProjects.length === 0 ? (
              <Placeholder
                variant="error"
                placement={PROJECT_MANAGER_PLACEHOLDER_PLACEMENT}
                title={fileError}
                fillParentHeight
              />
            ) : filteredProjects.length === 0 ? (
              <Placeholder
                variant={fileProjects.length === 0 ? "empty" : "no-results"}
                placement={PROJECT_MANAGER_PLACEHOLDER_PLACEMENT}
                title={
                  fileProjects.length === 0
                    ? t("projects.emptyState")
                    : t("projects.noResults")
                }
                subtitle={
                  fileProjects.length === 0
                    ? t("projects.emptyStateSubtitle")
                    : undefined
                }
                action={
                  fileProjects.length === 0 && onAddProject
                    ? {
                        label: t("projects.createFirstProject"),
                        onClick: onAddProject,
                      }
                    : undefined
                }
                fillParentHeight
              />
            ) : (
              <VirtualizedGroupedList
                key={collapseAllSignal}
                testId="projects-virtual-list"
                groups={virtualProjectGroups}
                defaultExpanded={defaultProjectGroupExpanded}
                getItemKey={(project) => project.id}
                renderGroupHeader={(group, expanded, onExpandedChange) => (
                  <WorkItemSection
                    status={group.key}
                    statusConfig={{
                      ...SECTION_BASE_CONFIG,
                      value: group.key,
                      color: group.color,
                      icon: group.icon,
                    }}
                    label={group.label}
                    count={group.projects.length}
                    expanded={expanded}
                    onExpandedChange={onExpandedChange}
                    virtualizedHeader
                    variant="table"
                  />
                )}
                renderItem={(project) => (
                  <div>
                    <ProjectRow
                      project={project}
                      isSelected={false}
                      variant="table"
                      isChecked={selectedProjectIds.has(project.id)}
                      showCheckboxes={showCheckboxesOnAllRows}
                      onSelect={handleProjectClick}
                      onCheckedChange={handleProjectCheckedChange}
                      onUnlinkSource={
                        isProjectSourceUnlinkable(project)
                          ? () => void handleUnlinkProjectSource(project)
                          : undefined
                      }
                      unlinkingSource={unlinkingProjectId === project.id}
                      onDelete={
                        isProjectDeletable(project)
                          ? handleDeleteProject
                          : undefined
                      }
                    />
                  </div>
                )}
              />
            )}
          </div>
        </div>
      </div>

      <MultiSelectBar
        selectedCount={selectedProjectIds.size}
        visibleItemCount={selectableFilteredProjectCount}
        deleting={bulkDeleting}
        onSelectAll={handleSelectAllProjects}
        onUnselectAll={handleUnselectAllProjects}
        onDelete={handleBulkDeleteProjects}
      />
    </div>
  );
};

export default ProjectsPage;

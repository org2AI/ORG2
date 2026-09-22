import { useAtomValue } from "jotai";
import React, { useMemo } from "react";

import { HEADER_ICON_SIZE } from "@src/config/workstation/tokens";
import { useCurrentUserMemberIds } from "@src/hooks/project/useCurrentUserMemberId";
import { DeliveryBox01Icon, HugeiconsIcon } from "@src/icons";
import type {
  LinkedRepoOption,
  ProjectData,
} from "@src/modules/ProjectManager/shared";
import type { ProjectManagerBreadcrumbSegment } from "@src/modules/ProjectManager/shared/components/ProjectManagerBreadcrumb";
import { reposAtom } from "@src/store/repo";
import { userAtom } from "@src/store/user/userAtom";
import { activeWorkspaceRootPathAtom } from "@src/store/workspace";
import { PROJECT_DETAIL_SURFACE_VIEW } from "@src/store/workstation/tabs";

import type { WorkItemsViewTab } from "../types";
import { getStatusFilterKeysForWorkItems } from "../workItemsViewModel";
import type { useWorkItems } from "./useWorkItems";

type WorkItemsPageData = ReturnType<typeof useWorkItems>["data"];
type WorkItemsPageProjectData = ReturnType<typeof useWorkItems>["projectData"];

interface UseWorkItemsPageModelParams {
  breadcrumbSegments?: readonly ProjectManagerBreadcrumbSegment[];
  onOpenProjects?: () => void;
  isActive: boolean;
  activeTab: WorkItemsViewTab;
  listFullscreen: boolean;
  workItems: WorkItemsPageData["workItems"];
  selectedWorkItem: WorkItemsPageData["selectedWorkItem"];
  getShortId: WorkItemsPageData["getShortId"];
  project: WorkItemsPageProjectData["project"];
  rawMembers: WorkItemsPageProjectData["rawMembers"];
  sourceProject: ProjectData;
}

/**
 * Derived, render-only values for the Work Items page: breadcrumb wiring,
 * atom-backed lookups, surface flags and identity fragments. No effects.
 */
export function useWorkItemsPageModel({
  breadcrumbSegments,
  onOpenProjects,
  isActive,
  activeTab,
  listFullscreen,
  workItems,
  selectedWorkItem,
  getShortId,
  project,
  rawMembers,
  sourceProject,
}: UseWorkItemsPageModelParams) {
  const interactiveBreadcrumbSegments = useMemo(
    () =>
      breadcrumbSegments?.map((segment, index) =>
        index === 0 && onOpenProjects && !segment.onClick
          ? { ...segment, onClick: onOpenProjects }
          : segment
      ),
    [breadcrumbSegments, onOpenProjects]
  );
  const activeWorkspaceRootPath = useAtomValue(activeWorkspaceRootPathAtom);
  const currentUser = useAtomValue(userAtom);
  const savedViewPreferenceOwnerId =
    currentUser.uuid?.trim() || currentUser.authing_id?.trim() || "local";
  const allRepos = useAtomValue(reposAtom);
  const availableRepos = useMemo<LinkedRepoOption[]>(
    () =>
      allRepos
        .map((repo) => ({
          id: repo.path ?? repo.fs_uri ?? repo.id,
          name: repo.name || repo.path || repo.id,
        }))
        .filter((repo) => repo.id),
    [allRepos]
  );
  const { memberIds: currentUserMemberIds } =
    useCurrentUserMemberIds(rawMembers);
  const pinnedKanbanColumnIds = useMemo(
    () => [...currentUserMemberIds].map((memberId) => `person:${memberId}`),
    [currentUserMemberIds]
  );
  const statusFilterKeys = useMemo(
    () => getStatusFilterKeysForWorkItems(workItems),
    [workItems]
  );

  const linkedRepoPath = sourceProject?.linkedRepos?.[0]?.id;
  const resolvedRepoPath = linkedRepoPath ?? activeWorkspaceRootPath ?? null;
  const resolvedProjectSlug = project?.slug ?? null;
  const projectIdentityIcon = useMemo(
    () => (
      <HugeiconsIcon
        icon={DeliveryBox01Icon}
        data-icon="box"
        size={HEADER_ICON_SIZE.sm}
        strokeWidth={1.75}
      />
    ),
    []
  );
  const selectedShortId = selectedWorkItem
    ? (getShortId(selectedWorkItem.session_id) ?? null)
    : null;

  const useSplitListHeader =
    isActive && activeTab === "List" && !listFullscreen;

  const activeProjectView =
    activeTab === "Overview"
      ? PROJECT_DETAIL_SURFACE_VIEW.OVERVIEW
      : PROJECT_DETAIL_SURFACE_VIEW.WORK_ITEMS;
  const isWorkItemsSurface =
    activeProjectView === PROJECT_DETAIL_SURFACE_VIEW.WORK_ITEMS;

  return {
    interactiveBreadcrumbSegments,
    savedViewPreferenceOwnerId,
    availableRepos,
    pinnedKanbanColumnIds,
    statusFilterKeys,
    resolvedRepoPath,
    resolvedProjectSlug,
    projectIdentityIcon,
    selectedShortId,
    useSplitListHeader,
    activeProjectView,
    isWorkItemsSurface,
  };
}

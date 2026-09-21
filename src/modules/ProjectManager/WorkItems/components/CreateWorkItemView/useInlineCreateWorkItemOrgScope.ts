import { useAtomValue } from "jotai";
import { useMemo } from "react";

import type { ProjectOrg } from "@src/api/http/project";
import type { Org2CloudOrg } from "@src/features/Org2Cloud/org2CloudOrgsAtom";
import { resolveProjectOrgScopeId } from "@src/features/Organizations/orgSelectorEntries";
import { sidebarSelectedOrgIdAtom } from "@src/features/Organizations/sidebarOrgScopeAtom";
import type { WorkItemProject } from "@src/types/core/workItem";

import {
  DEFAULT_PERSONAL_PROJECT_ORG_ID,
  filterSelectableProjectOrgs,
} from "../../../projectOrgVisibility";
import type { CreateWorkItemProjectOption } from "./types";

interface UseInlineCreateWorkItemOrgScopeOptions {
  cloudOrgs: Org2CloudOrg[];
  projectOrgs: ProjectOrg[];
  surfaceOrgId?: string | null;
  availableProjects: WorkItemProject[];
  loadedProjects: CreateWorkItemProjectOption[];
}

/**
 * The org a new Work Item is created under, and the projects offered for it.
 */
export function useInlineCreateWorkItemOrgScope({
  cloudOrgs,
  projectOrgs,
  surfaceOrgId,
  availableProjects,
  loadedProjects,
}: UseInlineCreateWorkItemOrgScopeOptions) {
  const selectableProjectOrgs = useMemo(
    () => filterSelectableProjectOrgs(projectOrgs, cloudOrgs),
    [cloudOrgs, projectOrgs]
  );
  const selectableProjectOrgIds = useMemo(
    () => new Set(selectableProjectOrgs.map((org) => org.id)),
    [selectableProjectOrgs]
  );

  // The organization is not picked here — a work item belongs to whichever
  // org the app is currently scoped to. A creator opened inside a specific
  // org surface keeps that surface's org; everything else follows the
  // globally selected org from the sidebar.
  const globalOrgSelectorValue = useAtomValue(sidebarSelectedOrgIdAtom);
  const globalProjectOrgId = useMemo(
    () => resolveProjectOrgScopeId(globalOrgSelectorValue, projectOrgs),
    [globalOrgSelectorValue, projectOrgs]
  );
  const requestedOrgId = surfaceOrgId ?? globalProjectOrgId;
  const effectiveOrgId = selectableProjectOrgIds.has(requestedOrgId)
    ? requestedOrgId
    : DEFAULT_PERSONAL_PROJECT_ORG_ID;

  // Only projects under the effective org are offered — picking a project
  // must never silently move the item to another organization.
  const resolvedProjects = useMemo<CreateWorkItemProjectOption[]>(() => {
    const projects: CreateWorkItemProjectOption[] =
      availableProjects.length > 0 ? availableProjects : loadedProjects;
    return projects.filter(
      (project) =>
        (project.orgId ?? DEFAULT_PERSONAL_PROJECT_ORG_ID) === effectiveOrgId
    );
  }, [availableProjects, loadedProjects, effectiveOrgId]);

  return { selectableProjectOrgs, effectiveOrgId, resolvedProjects };
}

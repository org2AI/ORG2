import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { projectApi } from "@src/api/http/project";
import type { ProjectOrg } from "@src/api/http/project";
import { projectSyncApi } from "@src/api/http/project/sync";
import { COLLAB_SYNC_PROVIDER } from "@src/features/Org2Cloud/org2CloudProjectOrgAlias";
import { createLogger } from "@src/hooks/logger";
import { useProjectDataChanged } from "@src/hooks/project";
import { useCollabOutboxPending } from "@src/hooks/project/useCollabOutboxPending";
import { STORY_PERSONAL_ORG_FILTER_ID } from "@src/store/workstation/tabs/factories/project";
import { mapWithConcurrency } from "@src/util/collections/mapWithConcurrency";

import { toChatPanelProject } from "./chatPanelMapping";
import { buildByOrgMenuItems } from "./groupingBuilders";
import { getProjectsProjectOverviewSlug } from "./idHelpers";
import type {
  SidebarProject,
  UseProjectsWorkItemMenuItemsParams,
  UseProjectsWorkItemMenuItemsResult,
} from "./types";

const logger = createLogger("ProjectsWorkItemSidebar");

export { getProjectsProjectOverviewSlug };

export function useProjectsWorkItemMenuItems({
  enabled,
  searchQuery = "",
  selectedOrgId,
}: UseProjectsWorkItemMenuItemsParams): UseProjectsWorkItemMenuItemsResult {
  const { t } = useTranslation(["projects", "common", "navigation"]);
  const [localOrgs, setLocalOrgs] = useState<ProjectOrg[]>([]);
  const [localProjects, setLocalProjects] = useState<SidebarProject[]>([]);
  const [loading, setLoading] = useState(false);

  /** Org ids accepted by the selector filter. */
  const selectedOrgIdSet = useMemo(() => {
    if (!selectedOrgId) return null;
    return new Set([selectedOrgId]);
  }, [selectedOrgId]);

  const scopedLocalProjects = useMemo(
    () =>
      selectedOrgIdSet
        ? localProjects.filter((project) => selectedOrgIdSet.has(project.orgId))
        : localProjects,
    [localProjects, selectedOrgIdSet]
  );
  const loadLocalProjects = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const [orgs, projects] = await Promise.all([
        projectApi.readOrgs(),
        projectApi.readProjects(),
      ]);
      setLocalOrgs(orgs);
      const orgNameById = new Map<string, string>([
        [STORY_PERSONAL_ORG_FILTER_ID, t("projects:orgs.personalOrg")],
        ...orgs.map((org) => [org.id, org.name] as const),
      ]);
      const projectResults = await mapWithConcurrency(
        projects,
        4,
        async (project) => {
          const [labelsFile, membersFile, syncStatus] = await Promise.all([
            projectApi.readLabels(project.slug),
            projectApi.readMembers(project.slug),
            projectSyncApi.status(project.slug).catch(() => null),
          ]);
          const labelMap = new Map(
            labelsFile.labels.map((label) => [label.id, label])
          );
          const memberMap = new Map(
            membersFile.members.map((member) => [member.id, member])
          );
          const orgId = project.meta.org_id || STORY_PERSONAL_ORG_FILTER_ID;
          const orgName =
            orgNameById.get(orgId) ||
            (orgId === STORY_PERSONAL_ORG_FILTER_ID
              ? t("projects:orgs.personalOrg")
              : t("navigation:labels.org"));
          const projectEntry: SidebarProject = {
            projectData: project,
            projectSyncAdapterId: syncStatus?.adapter_id ?? null,
            orgId,
            orgName,
            labelMap,
            memberMap,
          };
          return projectEntry;
        }
      );
      setLocalProjects(projectResults);
    } catch (error) {
      logger.error("Failed to load project sidebar items:", error);
      setLocalOrgs([]);
      setLocalProjects([]);
    } finally {
      setLoading(false);
    }
  }, [enabled, t]);

  useEffect(() => {
    void loadLocalProjects();
  }, [loadLocalProjects]);

  useProjectDataChanged(
    useCallback(() => {
      if (enabled) {
        void loadLocalProjects();
      }
    }, [enabled, loadLocalProjects])
  );

  const projectMap = useMemo(() => {
    const map = new Map<string, SidebarProject>();
    for (const project of scopedLocalProjects) {
      map.set(project.projectData.slug, project);
    }
    return map;
  }, [scopedLocalProjects]);

  const collabOrgIds = useMemo(
    () =>
      localOrgs
        .filter((org) => org.sync_provider === COLLAB_SYNC_PROVIDER)
        .map((org) => org.id)
        .sort(),
    [localOrgs]
  );
  const { pendingProjectIds } = useCollabOutboxPending(collabOrgIds);

  const menuItems = useMemo(
    () =>
      buildByOrgMenuItems({
        searchQuery,
        t,
        localProjects: scopedLocalProjects,
        pendingSync: {
          projectIds: pendingProjectIds,
        },
      }),
    [searchQuery, t, scopedLocalProjects, pendingProjectIds]
  );

  return {
    menuItems,
    projectMap,
    loading,
    toChatPanelProject,
  };
}

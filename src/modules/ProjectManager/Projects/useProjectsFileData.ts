import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  type LabelEntry,
  type MemberEntry,
  projectApi,
  projectDataToUI,
} from "@src/api/http/project";
import { createLogger } from "@src/hooks/logger";
import {
  type WorkspaceProject,
  loadWorkspaceLinearProjects,
} from "@src/modules/ProjectManager/workspaceAggregate";

const log = createLogger("ProjectsPage");

const EMPTY_LABEL_MAP = new Map<string, LabelEntry>();
const EMPTY_MEMBER_MAP = new Map<string, MemberEntry>();

interface UseProjectsFileDataParams {
  orgId?: string;
  includeExternalSources: boolean;
}

/**
 * Loads the `.orgii` project store (plus Linear projects when external
 * sources are included) with a mounted/generation guard so stale reads never
 * overwrite a newer result. The caller owns the refresh triggers.
 */
export function useProjectsFileData({
  orgId,
  includeExternalSources,
}: UseProjectsFileDataParams) {
  const { t } = useTranslation("projects");
  const [fileProjects, setFileProjects] = useState<WorkspaceProject[]>([]);
  const [fileProjectsLoading, setFileProjectsLoading] = useState(false);
  const [fileProjectsLoaded, setFileProjectsLoaded] = useState(false);
  const fileProjectsLoadedRef = useRef(false);
  const loadLifecycleRef = useRef({ mounted: true, generation: 0 });
  const [fileError, setFileError] = useState<string | null>(null);

  useEffect(() => {
    const lifecycle = loadLifecycleRef.current;
    lifecycle.mounted = true;
    return () => {
      lifecycle.mounted = false;
      lifecycle.generation += 1;
    };
  }, []);

  const loadProjectsForRepo = useCallback(async () => {
    const generation = ++loadLifecycleRef.current.generation;
    const isCurrent = () => {
      const lifecycle = loadLifecycleRef.current;
      return lifecycle.mounted && lifecycle.generation === generation;
    };
    setFileProjectsLoading(true);
    setFileError(null);
    try {
      const [projectsData, linearProjects] = await Promise.all([
        projectApi.readProjects({ orgId }),
        includeExternalSources ? loadWorkspaceLinearProjects() : [],
      ]);
      if (!isCurrent()) return;
      const localProjects = projectsData.map((project) =>
        projectDataToUI(project, {
          labelMap: EMPTY_LABEL_MAP,
          memberMap: EMPTY_MEMBER_MAP,
        })
      );
      setFileProjects([...localProjects, ...linearProjects]);
      fileProjectsLoadedRef.current = true;
      setFileProjectsLoaded(true);
    } catch (err) {
      if (!isCurrent()) return;
      log.error("[ProjectsPage] Failed to load projects:", err);
      if (!fileProjectsLoadedRef.current) {
        setFileProjects([]);
      }
      setFileError(
        err instanceof Error ? err.message : t("projects.loadProjectsFailed")
      );
    } finally {
      if (isCurrent()) setFileProjectsLoading(false);
    }
  }, [includeExternalSources, orgId, t]);

  const loadFileProjects = useCallback(async () => {
    await loadProjectsForRepo();
  }, [loadProjectsForRepo]);

  return {
    fileProjects,
    fileProjectsLoading,
    fileProjectsLoaded,
    fileError,
    loadProjectsForRepo,
    loadFileProjects,
  };
}

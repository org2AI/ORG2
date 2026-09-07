import { useEffect, useMemo, useState } from "react";

import {
  claudeCodeRecentPaths,
  codexAppRecentPaths,
  cursorCliRecentPaths,
  opencodeRecentPaths,
  qoderRecentPaths,
  warpRecentPaths,
  windsurfRecentPaths,
  zcodeRecentPaths,
} from "@src/api/tauri/externalHistory";
import { createLogger } from "@src/hooks/logger";
import type { RepoItem } from "@src/scaffold/GlobalSpotlight/types";
import { REPO_KIND } from "@src/store/repo";

import { getWorkingDirectoryPathDisplayName } from "../../palettes/WorkingDirectoryPalette/workingDirectoryPathImport";

const EXTERNAL_RECENT_PATH_LIMIT = 12;

interface RecentPathRecord {
  path: string;
  name?: string;
  lastUsedAt: string;
  sessionCount: number;
}

interface UseExternalRecentPathsOptions {
  enabled: boolean;
  existingRepoPaths: readonly string[];
  searchQuery: string;
}

interface UseExternalRecentPathsReturn {
  recentPathRepos: RepoItem[];
}

function normalizePath(path: string): string {
  return path
    .trim()
    .replace(/^file:\/\//, "")
    .replace(/[\\/]+$/, "");
}

function mergeRecentPaths(paths: RecentPathRecord[]): RecentPathRecord[] {
  const byPath = new Map<string, RecentPathRecord>();

  for (const recentPath of paths) {
    const path = normalizePath(recentPath.path);
    if (!path) continue;

    const existing = byPath.get(path);
    if (!existing) {
      byPath.set(path, { ...recentPath, path });
      continue;
    }

    byPath.set(path, {
      path,
      name: existing.name ?? recentPath.name,
      lastUsedAt:
        recentPath.lastUsedAt > existing.lastUsedAt
          ? recentPath.lastUsedAt
          : existing.lastUsedAt,
      sessionCount: existing.sessionCount + recentPath.sessionCount,
    });
  }

  return [...byPath.values()].sort((pathA, pathB) =>
    pathB.lastUsedAt.localeCompare(pathA.lastUsedAt)
  );
}

// One bounded in-flight batch per webview, shared by simultaneously open pickers.
// Results live only in mounted consumers; reopening revalidates app history.
let inFlight: Promise<RecentPathRecord[]> | undefined;
const log = createLogger("ExternalRecentPaths");
const recentPathSources = {
  codexAppRecentPaths,
  claudeCodeRecentPaths,
  cursorCliRecentPaths,
  opencodeRecentPaths,
  windsurfRecentPaths,
  warpRecentPaths,
  zcodeRecentPaths,
  qoderRecentPaths,
};

function loadExternalRecentPaths(): Promise<RecentPathRecord[]> {
  if (inFlight) return inFlight;
  const sources = Object.entries(recentPathSources);
  inFlight = Promise.allSettled(
    sources.map(([, load]) => load({ limit: EXTERNAL_RECENT_PATH_LIMIT }))
  )
    .then((results) => {
      const paths: RecentPathRecord[] = [];
      results.forEach((result, index) => {
        if (result.status === "fulfilled") paths.push(...result.value);
        else log.warn(`Failed to load ${sources[index][0]}`, result.reason);
      });
      return mergeRecentPaths(paths);
    })
    .finally(() => {
      inFlight = undefined;
    });
  return inFlight;
}

export function useExternalRecentPaths({
  enabled,
  existingRepoPaths,
  searchQuery,
}: UseExternalRecentPathsOptions): UseExternalRecentPathsReturn {
  const [paths, setPaths] = useState<RecentPathRecord[]>([]);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    const load = () => {
      if (document.visibilityState === "hidden") return;
      void loadExternalRecentPaths().then((recentPaths) => {
        if (!cancelled) setPaths(recentPaths);
      });
    };
    load();
    document.addEventListener("visibilitychange", load);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", load);
    };
  }, [enabled]);

  const existingPaths = useMemo(
    () => new Set(existingRepoPaths.map(normalizePath).filter(Boolean)),
    [existingRepoPaths]
  );

  const normalizedQuery = searchQuery.trim().toLowerCase();

  const recentPathRepos = useMemo(() => {
    return paths
      .filter(
        (recentPath) => !existingPaths.has(normalizePath(recentPath.path))
      )
      .filter((recentPath) => {
        if (!normalizedQuery) return true;
        const name =
          recentPath.name ??
          getWorkingDirectoryPathDisplayName(recentPath.path);
        return [name, recentPath.path].some((value) =>
          value.toLowerCase().includes(normalizedQuery)
        );
      })
      .slice(0, EXTERNAL_RECENT_PATH_LIMIT)
      .map((recentPath): RepoItem => {
        const name =
          recentPath.name ??
          getWorkingDirectoryPathDisplayName(recentPath.path);
        return {
          id: `external-recent:${recentPath.path}`,
          name,
          description: recentPath.path,
          fs_uri: recentPath.path,
          kind: REPO_KIND.FOLDER,
        };
      });
  }, [existingPaths, normalizedQuery, paths]);

  return { recentPathRepos };
}

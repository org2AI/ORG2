import { useMemo } from "react";

import { isSystemPathRepoItem } from "@src/features/SessionCreator/utils/systemPathSource";
import { workspaceMatchesRepoFilter } from "@src/features/TeamCollaboration/orgScopeRepoFilter";

import type { WorkspaceSwitchEntry } from "../../hooks";
import type { RepoItem } from "../../types";

interface UseWorkingDirectoryDropdownScopeOptions {
  repos: readonly RepoItem[];
  leadingRepos: readonly RepoItem[];
  workspaces: WorkspaceSwitchEntry[];
  searchQuery: string;
  repoFilter?: (repo: {
    repo_url?: string | null;
    fs_uri?: string | null;
  }) => boolean;
}

/**
 * Org-scope membership for repo and workspace rows, plus the query-filtered
 * workspace list. Rows are never hidden by the scope — the section builder
 * groups non-members under "Outside this org".
 */
export function useWorkingDirectoryDropdownScope({
  repos,
  leadingRepos,
  workspaces,
  searchQuery,
  repoFilter,
}: UseWorkingDirectoryDropdownScopeOptions) {
  // Org scope never hides rows — non-matching ones group under "Outside
  // this org". System-path rows bypass the predicate; running repoFilter on
  // them would prime git-remote resolution against the user's home directory.
  const outsideOrgRepoIds = useMemo(() => {
    if (!repoFilter) return null;
    const ids = new Set<string>();
    for (const repo of [...leadingRepos, ...repos]) {
      if (!isSystemPathRepoItem(repo) && !repoFilter(repo)) ids.add(repo.id);
    }
    return ids;
  }, [leadingRepos, repos, repoFilter]);

  const outsideOrgWorkspaceIds = useMemo(() => {
    if (!repoFilter) return null;
    const ids = new Set<string>();
    for (const entry of workspaces) {
      if (
        !workspaceMatchesRepoFilter(
          entry.workspace.folders.map((folder) => folder.folderPath),
          repoFilter
        )
      ) {
        ids.add(entry.workspace.workspaceId);
      }
    }
    return ids;
  }, [workspaces, repoFilter]);

  // Filter multi-repo workspaces by the same query as repos. Match against
  // workspace name and member folder names so users can find a workspace by
  // any of its repos.
  const filteredWorkspaces = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return workspaces;
    return workspaces.filter((entry) => {
      if (entry.workspace.name.toLowerCase().includes(query)) return true;
      return entry.folderNames.some((name) =>
        name.toLowerCase().includes(query)
      );
    });
  }, [workspaces, searchQuery]);

  return { outsideOrgRepoIds, outsideOrgWorkspaceIds, filteredWorkspaces };
}

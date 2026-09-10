import { REPO_KIND, type Repo } from "@src/store/repo";
import { matchRepoByPath } from "@src/store/repo/matchRepoByPath";
import type { WorkspaceFolder } from "@src/types/workspace";

import { WORKING_DIRECTORY_ACTIONS } from "./spotlightActionDefinitions.navigation";
import type { SpotlightStaticActionDefinition } from "./spotlightActionDefinitions.types";

/** Expand branch commands from the active working directory's Git repositories. */
export function buildWorkingDirectoryActions(
  repos: readonly Repo[],
  selectedRepoId: string | undefined,
  workspaceFolders: readonly WorkspaceFolder[],
  workspaceActive: boolean
): SpotlightStaticActionDefinition[] {
  const candidates = workspaceActive
    ? workspaceFolders
        .filter((folder) => folder.kind !== "folder")
        .map(
          (folder) =>
            repos.find((repo) => repo.id === folder.repoId) ??
            matchRepoByPath(repos, folder.path)
        )
    : [repos.find((repo) => repo.id === selectedRepoId)];
  const gitRepos = [
    ...new Map(
      candidates
        .filter((repo): repo is Repo => repo?.kind === REPO_KIND.GIT)
        .map((repo) => [repo.id, repo] as const)
    ).values(),
  ];

  return WORKING_DIRECTORY_ACTIONS.flatMap((action) => {
    if (action.id !== "switch-branch") return [action];
    return gitRepos.map(
      (repo): SpotlightStaticActionDefinition => ({
        ...action,
        id: `switch-branch:${repo.id}`,
        labelKey: "selectors.spotlight.actions.switchBranch.repoLabel",
        labelValues: { repoName: repo.name },
        keywords: [...action.keywords, repo.name],
        payload: { repoId: repo.id },
      })
    );
  });
}

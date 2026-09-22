import type { Store } from "jotai/vanilla/store";

import { getGitRemotes } from "@src/api/http/git/remotes";
import {
  getGitHubRepoPermissionsLocal,
  listPRsLocal,
} from "@src/api/tauri/github";
import type { GitHubRepoPermissions } from "@src/api/tauri/github";
import type { PullRequestListState } from "@src/api/tauri/github";
import { loadGitHubRepoPermissions } from "@src/features/GitHubWork/githubIssueDetailCoordinator";
import {
  coalesceGitHubListRequest,
  getCachedIssues,
  getCachedPrs,
  isIssueCacheStale,
  isPrCacheStale,
  setCachedPrs,
  updateCachedClosedIssues,
  updateCachedOpenIssues,
} from "@src/services/git/githubListCache";
import { parseGithubRepoFullName } from "@src/services/git/operations/createPullRequest";
import { fetchIssues } from "@src/services/git/operations/githubIssues";
import { REPO_KIND } from "@src/store/repo";
import type { Repo } from "@src/store/repo/types";

import {
  EMPTY_REPO_ISSUES,
  type RepoIssueLoadResult,
  type RepoIssueState,
  type RepoPrLoadResult,
  type RepoPrState,
} from "./githubWorkItemsLifecycleState";
import type { GitHubIssuePageState } from "./githubWorkItemsSearchQuery";
import {
  type GitHubRepoSource,
  getGitHubListCacheKey,
  resolveSingleGitHubRepoSource,
} from "./githubWorkItemsTypes";

export const ISSUE_PAGE_SIZE = 50;
const PR_PAGE_SIZE = 50;
export const GITHUB_SOURCE_CONCURRENCY = 4;

export function getCachedRepoIssues(source: GitHubRepoSource): RepoIssueState {
  const cached = getCachedIssues(getGitHubListCacheKey(source));
  if (!cached) return EMPTY_REPO_ISSUES;
  return {
    openIssues: cached.openIssues,
    closedIssues: cached.closedIssues,
    openLoaded: typeof cached.openCachedAt === "number",
    closedLoaded: typeof cached.closedCachedAt === "number",
    openHasMore: cached.openIssues.length >= ISSUE_PAGE_SIZE,
    closedHasMore: cached.closedIssues.length >= ISSUE_PAGE_SIZE,
    openNextPage: cached.openIssues.length >= ISSUE_PAGE_SIZE ? 2 : null,
    closedNextPage: cached.closedIssues.length >= ISSUE_PAGE_SIZE ? 2 : null,
  };
}

export function getCachedRepoPrs(source: GitHubRepoSource): RepoPrState {
  const cacheKey = getGitHubListCacheKey(source);
  const open = getCachedPrs(cacheKey, "open");
  const closed = getCachedPrs(cacheKey, "closed");
  return {
    openPrs: open?.prs ?? [],
    closedPrs: closed?.prs ?? [],
    openLoaded: Boolean(open),
    closedLoaded: Boolean(closed),
    openError: null,
    closedError: null,
  };
}

export async function resolveGitHubRepoSource(
  repo: Repo
): Promise<GitHubRepoSource | null> {
  if (repo.kind !== REPO_KIND.GIT || !repo.path) return null;
  let remoteUrl = repo.repo_url;
  if (!remoteUrl) {
    try {
      remoteUrl = (
        await getGitRemotes({ repo_id: repo.id, repo_path: repo.path })
      )?.remotes?.find((remote) => remote.name === "origin")?.url;
    } catch {
      return null;
    }
  }
  if (!remoteUrl) return null;
  const repoFullName = parseGithubRepoFullName(remoteUrl);
  if (!repoFullName) return null;
  return {
    repoId: repo.id,
    repoPath: repo.path,
    label: repo.name,
    remoteUrl,
    repoFullName,
    viewerLogin: null,
    permissions: null,
    authScope: null,
  };
}

export async function loadRepoPermissions(
  store: Store,
  source: GitHubRepoSource,
  authScope: string
): Promise<[string, GitHubRepoPermissions | null]> {
  const permissions = await loadGitHubRepoPermissions(
    store,
    authScope,
    source.repoFullName,
    () => getGitHubRepoPermissionsLocal(source.repoFullName)
  ).catch(() => null);
  return [source.repoFullName, permissions];
}

export async function loadRepoIssues(
  source: GitHubRepoSource,
  states: GitHubIssuePageState[],
  force: boolean
): Promise<RepoIssueLoadResult> {
  const cacheKey = getGitHubListCacheKey(source);
  const cached = getCachedRepoIssues(source);
  if (!force && states.every((state) => !isIssueCacheStale(cacheKey, state))) {
    return { source, ...cached, error: null };
  }
  const results = await coalesceGitHubListRequest(
    `work-management:issues:${states.join(",")}:${cacheKey}`,
    () =>
      Promise.all(
        states.map((state) =>
          fetchIssues(source.remoteUrl, {
            state,
            page: 1,
            perPage: ISSUE_PAGE_SIZE,
          })
        )
      )
  );
  const resultByState = new Map(
    states.map((state, index) => [state, results[index]] as const)
  );
  const openResult = resultByState.get("open");
  const closedResult = resultByState.get("closed");
  const openIssues = openResult?.data?.issues ?? cached.openIssues;
  const closedIssues = closedResult?.data?.issues ?? cached.closedIssues;
  if (openResult?.data) updateCachedOpenIssues(cacheKey, openIssues);
  if (closedResult?.data) updateCachedClosedIssues(cacheKey, closedIssues);
  return {
    source,
    openIssues,
    closedIssues,
    openLoaded: Boolean(openResult?.data) || cached.openLoaded,
    closedLoaded: Boolean(closedResult?.data) || cached.closedLoaded,
    openHasMore: openResult?.data?.has_more ?? cached.openHasMore,
    closedHasMore: closedResult?.data?.has_more ?? cached.closedHasMore,
    openNextPage: openResult?.data?.next_page ?? cached.openNextPage,
    closedNextPage: closedResult?.data?.next_page ?? cached.closedNextPage,
    error: openResult?.error ?? closedResult?.error ?? null,
  };
}

export async function loadRepoPrs(
  source: GitHubRepoSource,
  state: PullRequestListState,
  force: boolean
): Promise<RepoPrLoadResult> {
  const cacheKey = getGitHubListCacheKey(source);
  const cached = getCachedPrs(cacheKey, state);
  if (cached && !force && !isPrCacheStale(cacheKey, state)) {
    return { source, state, prs: cached.prs, loaded: true, error: null };
  }
  try {
    const prs = await coalesceGitHubListRequest(
      `work-management:prs:${state}:${cacheKey}`,
      () => listPRsLocal(source.repoFullName, state, PR_PAGE_SIZE)
    );
    setCachedPrs(cacheKey, prs, state);
    return { source, state, prs, loaded: true, error: null };
  } catch (error: unknown) {
    return {
      source,
      state,
      prs: cached?.prs ?? [],
      loaded: Boolean(cached),
      error: String(error),
    };
  }
}

export function selectGitHubLoadSources({
  sources,
  selectedRepo,
  selectedRepoPath,
}: {
  sources: GitHubRepoSource[];
  selectedRepo: string;
  selectedRepoPath: string | null;
}): GitHubRepoSource[] {
  const selectedSource = resolveSingleGitHubRepoSource(
    sources,
    selectedRepo,
    selectedRepoPath
  );
  return selectedSource ? [selectedSource] : [];
}

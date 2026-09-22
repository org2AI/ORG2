import type { Store } from "jotai/vanilla/store";
import isEqual from "lodash/isEqual";
import type { Dispatch, SetStateAction } from "react";

import type {
  GitHubIssue,
  OpenPRItem,
  PullRequestListState,
} from "@src/api/tauri/github";
import { GITHUB_LIST_CACHE_TTL_MS } from "@src/services/git/githubListCache";
import { REPO_KIND } from "@src/store/repo";
import type { Repo } from "@src/store/repo/types";
import { StoreScopedSnapshotCache } from "@src/util/cache/storeScopedSnapshotCache";

import type { GitHubQueryScope } from "./githubWorkItemsSearchQuery";
import type { GitHubRepoSource } from "./githubWorkItemsTypes";

const MAX_RETAINED_GITHUB_LIST_SCOPES = 4;
const MAX_RETAINED_GITHUB_REPOS = 8;
const MAX_RETAINED_ISSUES_PER_STATE = 100;
const MAX_RETAINED_PRS_PER_STATE = 100;

export interface RepoIssueState {
  openIssues: GitHubIssue[];
  closedIssues: GitHubIssue[];
  openLoaded: boolean;
  closedLoaded: boolean;
  openHasMore: boolean;
  closedHasMore: boolean;
  openNextPage: number | null;
  closedNextPage: number | null;
}

export interface RepoPrState {
  openPrs: OpenPRItem[];
  closedPrs: OpenPRItem[];
  openLoaded: boolean;
  closedLoaded: boolean;
  openError: string | null;
  closedError: string | null;
}

export interface GitHubWorkItemsLifecycleSnapshot {
  viewerLogin: string;
  repoSources: GitHubRepoSource[];
  repoIssueMap: Record<string, RepoIssueState>;
  repoPrMap: Record<string, RepoPrState>;
  loadError: string | null;
}

export const retainedLifecycleSnapshots = new StoreScopedSnapshotCache<
  string,
  GitHubWorkItemsLifecycleSnapshot
>(MAX_RETAINED_GITHUB_LIST_SCOPES, GITHUB_LIST_CACHE_TTL_MS);
export const resolvedViewerByStore = new WeakMap<Store, string>();

export interface RepoIssueLoadResult extends RepoIssueState {
  source: GitHubRepoSource;
  error: string | null;
}

export interface RepoPrLoadResult {
  source: GitHubRepoSource;
  state: PullRequestListState;
  prs: OpenPRItem[];
  loaded: boolean;
  error: string | null;
}

export const EMPTY_REPO_ISSUES: RepoIssueState = {
  openIssues: [],
  closedIssues: [],
  openLoaded: false,
  closedLoaded: false,
  openHasMore: false,
  closedHasMore: false,
  openNextPage: null,
  closedNextPage: null,
};

export const EMPTY_REPO_PRS: RepoPrState = {
  openPrs: [],
  closedPrs: [],
  openLoaded: false,
  closedLoaded: false,
  openError: null,
  closedError: null,
};

export function hasCompletedGitHubLifecycleScope(
  completedRetentionKey: string | null,
  retentionKey: string
): boolean {
  return completedRetentionKey === retentionKey;
}

export function getRepoIssueMapKey(source: GitHubRepoSource): string {
  return source.repoFullName;
}

export function getGitHubLifecycleRetentionKey(
  repos: readonly Repo[],
  scope: Extract<GitHubQueryScope, "issue" | "pr">
): string {
  return JSON.stringify([
    scope,
    ...repos
      .filter((repo) => repo.kind === REPO_KIND.GIT && repo.path)
      .map(
        (repo) =>
          [
            repo.id ?? "",
            repo.path ?? "",
            repo.repo_url ?? "",
            repo.name,
          ] as const
      )
      .sort(([leftId], [rightId]) => leftId.localeCompare(rightId)),
  ]);
}

function boundedIssueState(state: RepoIssueState): RepoIssueState {
  return {
    ...state,
    openIssues: state.openIssues.slice(0, MAX_RETAINED_ISSUES_PER_STATE),
    closedIssues: state.closedIssues.slice(0, MAX_RETAINED_ISSUES_PER_STATE),
  };
}

function boundedPrState(state: RepoPrState): RepoPrState {
  return {
    ...state,
    openPrs: state.openPrs.slice(0, MAX_RETAINED_PRS_PER_STATE),
    closedPrs: state.closedPrs.slice(0, MAX_RETAINED_PRS_PER_STATE),
  };
}

export function retainGitHubWorkItemsLifecycleSnapshot({
  current,
  viewerLogin,
  repoSources,
  repoIssueMap,
  repoPrMap,
  loadError,
}: {
  current?: GitHubWorkItemsLifecycleSnapshot;
  viewerLogin: string;
  repoSources: GitHubRepoSource[];
  repoIssueMap: Record<string, RepoIssueState>;
  repoPrMap: Record<string, RepoPrState>;
  loadError: string | null;
}): GitHubWorkItemsLifecycleSnapshot {
  const boundedSources = repoSources.slice(0, MAX_RETAINED_GITHUB_REPOS);
  const retainedRepoNames = new Set(
    boundedSources.map((source) => source.repoFullName)
  );
  const boundedIssueMap = Object.fromEntries(
    Object.entries(repoIssueMap)
      .filter(([repoFullName]) => retainedRepoNames.has(repoFullName))
      .map(([repoFullName, state]) => [repoFullName, boundedIssueState(state)])
  );
  const boundedPrMap = Object.fromEntries(
    Object.entries(repoPrMap)
      .filter(([repoFullName]) => retainedRepoNames.has(repoFullName))
      .map(([repoFullName, state]) => [repoFullName, boundedPrState(state)])
  );
  const next = {
    viewerLogin,
    repoSources: boundedSources,
    repoIssueMap: boundedIssueMap,
    repoPrMap: boundedPrMap,
    loadError,
  };
  return current && isEqual(current, next) ? current : next;
}

export function setIfChanged<T>(
  setValue: Dispatch<SetStateAction<T>>,
  nextValue: NoInfer<T>
): void {
  setValue((current) => (isEqual(current, nextValue) ? current : nextValue));
}

export function mergeUniqueIssues(
  existingIssues: GitHubIssue[],
  incomingIssues: GitHubIssue[]
): GitHubIssue[] {
  const seenIssueNumbers = new Set(existingIssues.map((issue) => issue.number));
  return [
    ...existingIssues,
    ...incomingIssues.filter((issue) => !seenIssueNumbers.has(issue.number)),
  ];
}

export function mergeRepoIssueLoadResults(
  current: Record<string, RepoIssueState>,
  resolvedSources: readonly GitHubRepoSource[],
  results: readonly RepoIssueLoadResult[]
): Record<string, RepoIssueState> {
  const next = Object.fromEntries(
    resolvedSources.map((source) => {
      const key = getRepoIssueMapKey(source);
      return [key, current[key] ?? EMPTY_REPO_ISSUES];
    })
  );
  for (const { source, error: _error, ...state } of results) {
    next[getRepoIssueMapKey(source)] = state;
  }
  return isEqual(current, next) ? current : next;
}

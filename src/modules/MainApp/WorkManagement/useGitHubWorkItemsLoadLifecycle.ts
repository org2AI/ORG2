import { useStore } from "jotai";
import isEqual from "lodash/isEqual";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getGitHubViewerLogin } from "@src/api/tauri/github";
import type { PullRequestListState } from "@src/api/tauri/github";
import {
  loadGitHubDetailAuthScope,
  loadGitHubViewer,
} from "@src/features/GitHubWork/githubIssueDetailCoordinator";
import { REPO_KIND } from "@src/store/repo";
import type { Repo } from "@src/store/repo/types";
import { mapWithConcurrency } from "@src/util/collections/mapWithConcurrency";

import {
  EMPTY_REPO_PRS,
  type RepoIssueState,
  type RepoPrState,
  getGitHubLifecycleRetentionKey,
  getRepoIssueMapKey,
  hasCompletedGitHubLifecycleScope,
  mergeRepoIssueLoadResults,
  resolvedViewerByStore,
  retainGitHubWorkItemsLifecycleSnapshot,
  retainedLifecycleSnapshots,
  setIfChanged,
} from "./githubWorkItemsLifecycleState";
import {
  GITHUB_SOURCE_CONCURRENCY,
  getCachedRepoIssues,
  getCachedRepoPrs,
  loadRepoIssues,
  loadRepoPermissions,
  loadRepoPrs,
  resolveGitHubRepoSource,
  selectGitHubLoadSources,
} from "./githubWorkItemsRepoLoaders";
import type {
  GitHubIssuePageState,
  GitHubQueryScope,
} from "./githubWorkItemsSearchQuery";
import type { GitHubRepoSource } from "./githubWorkItemsTypes";

export {
  EMPTY_REPO_ISSUES,
  EMPTY_REPO_PRS,
  type GitHubWorkItemsLifecycleSnapshot,
  type RepoIssueLoadResult,
  type RepoIssueState,
  type RepoPrLoadResult,
  type RepoPrState,
  getGitHubLifecycleRetentionKey,
  getRepoIssueMapKey,
  hasCompletedGitHubLifecycleScope,
  mergeRepoIssueLoadResults,
  mergeUniqueIssues,
  retainGitHubWorkItemsLifecycleSnapshot,
} from "./githubWorkItemsLifecycleState";
export {
  ISSUE_PAGE_SIZE,
  loadRepoPermissions,
  loadRepoPrs,
  selectGitHubLoadSources,
} from "./githubWorkItemsRepoLoaders";

export function useGitHubWorkItemsLoadLifecycle({
  repos,
  scope,
  issueStates,
  prStates,
  refreshNonce,
  selectedRepo = "__current__",
  selectedRepoPath = null,
}: {
  repos: Repo[];
  scope: Extract<GitHubQueryScope, "issue" | "pr">;
  issueStates: GitHubIssuePageState[];
  prStates: PullRequestListState[];
  refreshNonce: number;
  selectedRepo?: string;
  selectedRepoPath?: string | null;
}) {
  const store = useStore();
  const gitRepos = useMemo(
    () => repos.filter((repo) => repo.kind === REPO_KIND.GIT && repo.path),
    [repos]
  );
  const retentionKey = useMemo(
    () => getGitHubLifecycleRetentionKey(gitRepos, scope),
    [gitRepos, scope]
  );
  const retainedSnapshot = useMemo(() => {
    const currentViewer = resolvedViewerByStore.get(store);
    const snapshot = retainedLifecycleSnapshots.get(store, retentionKey);
    return snapshot && snapshot.viewerLogin === currentViewer ? snapshot : null;
  }, [retentionKey, store]);
  const [repoSources, setRepoSources] = useState<GitHubRepoSource[]>(
    () => retainedSnapshot?.repoSources ?? []
  );
  const [repoIssueMap, setRepoIssueMap] = useState<
    Record<string, RepoIssueState>
  >(() => retainedSnapshot?.repoIssueMap ?? {});
  const [repoPrMap, setRepoPrMap] = useState<Record<string, RepoPrState>>(
    () => retainedSnapshot?.repoPrMap ?? {}
  );
  const [loading, setLoading] = useState(() => !retainedSnapshot);
  const [loadError, setLoadError] = useState<string | null>(
    () => retainedSnapshot?.loadError ?? null
  );
  const [completedRetentionKey, setCompletedRetentionKey] = useState<
    string | null
  >(retainedSnapshot || gitRepos.length === 0 ? retentionKey : null);
  const loadedRef = useRef(Boolean(retainedSnapshot));
  const handledRefreshNonceRef = useRef(0);
  const permissionViewerRef = useRef<string | null>(
    retainedSnapshot?.viewerLogin ?? null
  );

  useEffect(() => {
    const viewerLogin = permissionViewerRef.current;
    if (!viewerLogin || !loadedRef.current || loading) return;
    const current = retainedLifecycleSnapshots.get(store, retentionKey);
    retainedLifecycleSnapshots.set(
      store,
      retentionKey,
      retainGitHubWorkItemsLifecycleSnapshot({
        current,
        viewerLogin,
        repoSources,
        repoIssueMap,
        repoPrMap,
        loadError,
      })
    );
  }, [
    loadError,
    loading,
    repoIssueMap,
    repoPrMap,
    repoSources,
    retentionKey,
    store,
  ]);

  useEffect(() => {
    let cancelled = false;
    const forceRefresh = refreshNonce !== handledRefreshNonceRef.current;
    handledRefreshNonceRef.current = refreshNonce;
    void (async () => {
      if (forceRefresh || !loadedRef.current) setLoading(true);
      setLoadError(null);
      if (gitRepos.length === 0) {
        permissionViewerRef.current = null;
        loadedRef.current = true;
        setIfChanged(setRepoSources, []);
        setIfChanged(setRepoIssueMap, {});
        setIfChanged(setRepoPrMap, {});
        setCompletedRetentionKey(retentionKey);
        setLoading(false);
        return;
      }
      const authScopePromise = loadGitHubDetailAuthScope(store).catch(
        () => null
      );
      const viewerResultPromise = authScopePromise.then((authScope) =>
        loadGitHubViewer(
          store,
          authScope ?? "github.com:unresolved",
          getGitHubViewerLogin
        ).then(
          (login) => ({ login, error: null }),
          (error: unknown) => ({ login: null, error: String(error) })
        )
      );
      const [authScope, viewerResult, sources] = await Promise.all([
        authScopePromise,
        viewerResultPromise,
        mapWithConcurrency(
          gitRepos,
          GITHUB_SOURCE_CONCURRENCY,
          resolveGitHubRepoSource
        ),
      ]);
      if (cancelled) return;
      const viewerLoginError = viewerResult.error;
      const resolvedSources = sources
        .filter((source): source is GitHubRepoSource => Boolean(source))
        .map((source) => ({
          ...source,
          viewerLogin: viewerResult.login,
          authScope,
        }));
      if (cancelled) return;
      if (!viewerResult.login) {
        permissionViewerRef.current = null;
        resolvedViewerByStore.delete(store);
        retainedLifecycleSnapshots.delete(store, retentionKey);
        loadedRef.current = false;
        setIfChanged(setRepoSources, resolvedSources);
        setIfChanged(setRepoIssueMap, {});
        setIfChanged(setRepoPrMap, {});
        setLoadError(
          viewerLoginError ?? "GitHub viewer identity is unavailable"
        );
        setCompletedRetentionKey(retentionKey);
        setLoading(false);
        return;
      }
      const viewerChanged =
        permissionViewerRef.current !== null &&
        permissionViewerRef.current !== viewerResult.login;
      if (permissionViewerRef.current !== viewerResult.login) {
        permissionViewerRef.current = viewerResult.login;
      }
      resolvedViewerByStore.set(store, viewerResult.login);
      if (viewerChanged) {
        retainedLifecycleSnapshots.delete(store, retentionKey);
        setIfChanged(setRepoSources, []);
        setIfChanged(setRepoIssueMap, {});
        setIfChanged(setRepoPrMap, {});
      }
      setIfChanged(
        setRepoIssueMap,
        scope === "issue"
          ? Object.fromEntries(
              resolvedSources.map((source) => [
                getRepoIssueMapKey(source),
                getCachedRepoIssues(source),
              ])
            )
          : {}
      );
      setIfChanged(
        setRepoPrMap,
        scope === "pr"
          ? Object.fromEntries(
              resolvedSources.map((source) => [
                getRepoIssueMapKey(source),
                getCachedRepoPrs(source),
              ])
            )
          : {}
      );
      if (resolvedSources.length === 0) {
        loadedRef.current = true;
        setIfChanged(setRepoSources, []);
        setCompletedRetentionKey(retentionKey);
        setLoading(false);
        return;
      }
      const sourcesToLoad = selectGitHubLoadSources({
        sources: resolvedSources,
        selectedRepo,
        selectedRepoPath,
      });
      const [permissionResults, issueResults, prResults] = await Promise.all([
        mapWithConcurrency(sourcesToLoad, GITHUB_SOURCE_CONCURRENCY, (source) =>
          loadRepoPermissions(
            store,
            source,
            authScope ?? "github.com:unresolved"
          )
        ),
        scope === "issue"
          ? mapWithConcurrency(
              sourcesToLoad,
              GITHUB_SOURCE_CONCURRENCY,
              (source) => loadRepoIssues(source, issueStates, forceRefresh)
            )
          : Promise.resolve([]),
        scope === "pr"
          ? mapWithConcurrency(
              sourcesToLoad.flatMap((source) =>
                prStates.map((state) => ({ source, state }))
              ),
              GITHUB_SOURCE_CONCURRENCY,
              ({ source, state }) => loadRepoPrs(source, state, forceRefresh)
            )
          : Promise.resolve([]),
      ]);
      if (cancelled) return;
      const permissionByRepo = new Map(permissionResults);
      loadedRef.current = true;
      setIfChanged(
        setRepoSources,
        resolvedSources.map((source) => ({
          ...source,
          permissions: permissionByRepo.get(source.repoFullName) ?? null,
        }))
      );
      if (scope === "issue") {
        setRepoIssueMap((current) =>
          mergeRepoIssueLoadResults(current, resolvedSources, issueResults)
        );
      } else {
        setRepoPrMap((current) => {
          const next = { ...current };
          for (const result of prResults) {
            const key = getRepoIssueMapKey(result.source);
            const currentState = next[key] ?? EMPTY_REPO_PRS;
            next[key] =
              result.state === "open"
                ? {
                    ...currentState,
                    openPrs: result.prs,
                    openLoaded: result.loaded,
                    openError: result.error,
                  }
                : {
                    ...currentState,
                    closedPrs: result.prs,
                    closedLoaded: result.loaded,
                    closedError: result.error,
                  };
          }
          return isEqual(current, next) ? current : next;
        });
      }
      setLoadError(
        viewerLoginError ??
          issueResults.find((result) => result.error)?.error ??
          prResults.find((result) => result.error)?.error ??
          null
      );
      setCompletedRetentionKey(retentionKey);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [
    gitRepos,
    issueStates,
    prStates,
    refreshNonce,
    scope,
    selectedRepo,
    selectedRepoPath,
    store,
    retentionKey,
  ]);

  const updateIssueMap = useCallback(
    (
      update: (
        current: Record<string, RepoIssueState>
      ) => Record<string, RepoIssueState>
    ) =>
      setRepoIssueMap((current) => {
        const next = update(current);
        return isEqual(current, next) ? current : next;
      }),
    []
  );
  const updatePrMap = useCallback(
    (
      update: (
        current: Record<string, RepoPrState>
      ) => Record<string, RepoPrState>
    ) =>
      setRepoPrMap((current) => {
        const next = update(current);
        return isEqual(current, next) ? current : next;
      }),
    []
  );
  const setListError = useCallback((error: string | null) => {
    setLoadError(error);
  }, []);

  const initialLoading = !hasCompletedGitHubLifecycleScope(
    completedRetentionKey,
    retentionKey
  );
  return {
    repoSources,
    repoIssueMap,
    repoPrMap,
    loading: loading || initialLoading,
    initialLoading,
    loadError,
    updateIssueMap,
    updatePrMap,
    setListError,
  };
}

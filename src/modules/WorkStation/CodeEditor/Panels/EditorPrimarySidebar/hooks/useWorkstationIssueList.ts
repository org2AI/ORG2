/**
 * Open / closed issue lists for the workstation Issues panel: cache-seeded
 * section state, first-page and load-more fetches, and the re-auth signal
 * raised by a rejected API call.
 */
import type React from "react";
import { useCallback, useEffect, useState } from "react";

import {
  coalesceGitHubListRequest,
  getCachedIssues,
  isIssueCacheStale,
  updateCachedClosedIssues,
  updateCachedOpenIssues,
} from "@src/services/git/githubListCache";
import { fetchIssues } from "@src/services/git/operations/githubIssues";
import type { GitHubIssue } from "@src/services/git/operations/githubIssues";

import type { IssueSectionLoadState } from "./workstationIssueHelpers";

const ISSUE_PAGE_SIZE = 50;

function mergeUniqueIssues(
  existingIssues: GitHubIssue[],
  incomingIssues: GitHubIssue[]
): GitHubIssue[] {
  const seenIssueNumbers = new Set(existingIssues.map((issue) => issue.number));
  return [
    ...existingIssues,
    ...incomingIssues.filter((issue) => !seenIssueNumbers.has(issue.number)),
  ];
}

export function useWorkstationIssueList({
  hasGitHubAuth,
  mountedRef,
  repoKey,
  resolvedRemoteUrl,
}: {
  hasGitHubAuth: boolean;
  mountedRef: React.RefObject<boolean>;
  repoKey: string;
  resolvedRemoteUrl: string | null;
}) {
  // Set to true when the API returns a re-authorization error so the UI can
  // show a targeted prompt instead of a generic error or empty state.
  const [needsReAuth, setNeedsReAuth] = useState(false);

  // Seed from cache immediately so the list shows on re-entry without a spinner
  const cached = getCachedIssues(repoKey);
  const [openLoadState, setOpenLoadState] = useState<IssueSectionLoadState>(
    cached ? "ready" : "idle"
  );
  const [closedLoadState, setClosedLoadState] = useState<IssueSectionLoadState>(
    cached?.closedIssues.length && !isIssueCacheStale(repoKey, "closed")
      ? "ready"
      : "idle"
  );
  const [openIssues, setOpenIssues] = useState<GitHubIssue[]>(
    cached?.openIssues ?? []
  );
  const [closedIssues, setClosedIssues] = useState<GitHubIssue[]>(
    cached?.closedIssues ?? []
  );
  const [openHasMore, setOpenHasMore] = useState(
    (cached?.openIssues.length ?? 0) >= ISSUE_PAGE_SIZE
  );
  const [closedHasMore, setClosedHasMore] = useState(
    (cached?.closedIssues.length ?? 0) >= ISSUE_PAGE_SIZE
  );
  const [openNextPage, setOpenNextPage] = useState<number | null>(
    (cached?.openIssues.length ?? 0) >= ISSUE_PAGE_SIZE ? 2 : null
  );
  const [closedNextPage, setClosedNextPage] = useState<number | null>(
    (cached?.closedIssues.length ?? 0) >= ISSUE_PAGE_SIZE ? 2 : null
  );
  const [openLoadingMore, setOpenLoadingMore] = useState(false);
  const [closedLoadingMore, setClosedLoadingMore] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const [closedError, setClosedError] = useState<string | null>(null);

  const handleFetchError = useCallback(
    (
      error: string,
      setError: (e: string | null) => void,
      setLoad: (s: IssueSectionLoadState) => void
    ) => {
      const isReAuth =
        /ReAuthError/i.test(error) || /re-authorization required/i.test(error);
      if (isReAuth) {
        setNeedsReAuth(true);
      } else {
        setError(error);
      }
      setLoad("error");
    },
    [setNeedsReAuth]
  );

  const fetchOpen = useCallback(async () => {
    if (!resolvedRemoteUrl || !hasGitHubAuth) return;
    setOpenLoadState("loading");
    setOpenError(null);
    const result = await fetchIssues(resolvedRemoteUrl, {
      state: "open",
      page: 1,
      perPage: ISSUE_PAGE_SIZE,
    });
    if (!mountedRef.current) return;
    if (result.error) {
      handleFetchError(result.error, setOpenError, setOpenLoadState);
      return;
    }
    const issues = result.data!.issues;
    setOpenIssues(issues);
    setOpenHasMore(result.data!.has_more);
    setOpenNextPage(result.data!.next_page);
    setOpenLoadState("ready");
    updateCachedOpenIssues(repoKey, issues);
  }, [resolvedRemoteUrl, hasGitHubAuth, handleFetchError, repoKey, mountedRef]);

  const fetchClosed = useCallback(async () => {
    if (!resolvedRemoteUrl || !hasGitHubAuth) return;
    setClosedLoadState("loading");
    setClosedError(null);
    const result = await coalesceGitHubListRequest(
      `workstation:issues:closed:${resolvedRemoteUrl}:${repoKey}`,
      () =>
        fetchIssues(resolvedRemoteUrl, {
          state: "closed",
          page: 1,
          perPage: ISSUE_PAGE_SIZE,
        })
    );
    if (!mountedRef.current) return;
    if (result.error) {
      handleFetchError(result.error, setClosedError, setClosedLoadState);
      return;
    }
    const issues = result.data!.issues;
    setClosedIssues(issues);
    setClosedHasMore(result.data!.has_more);
    setClosedNextPage(result.data!.next_page);
    setClosedLoadState("ready");
    updateCachedClosedIssues(repoKey, issues);
  }, [resolvedRemoteUrl, hasGitHubAuth, handleFetchError, repoKey, mountedRef]);

  const loadMoreOpen = useCallback(async () => {
    if (!resolvedRemoteUrl || !hasGitHubAuth || !openHasMore || !openNextPage)
      return;
    setOpenLoadingMore(true);
    setOpenError(null);
    const result = await fetchIssues(resolvedRemoteUrl, {
      state: "open",
      page: openNextPage,
      perPage: ISSUE_PAGE_SIZE,
    });
    if (!mountedRef.current) return;
    setOpenLoadingMore(false);
    if (result.error) {
      handleFetchError(result.error, setOpenError, setOpenLoadState);
      return;
    }
    setOpenIssues((current) => {
      const issues = mergeUniqueIssues(current, result.data!.issues);
      updateCachedOpenIssues(repoKey, issues);
      return issues;
    });
    setOpenHasMore(result.data!.has_more);
    setOpenNextPage(result.data!.next_page);
  }, [
    resolvedRemoteUrl,
    hasGitHubAuth,
    openHasMore,
    openNextPage,
    handleFetchError,
    repoKey,
    mountedRef,
  ]);

  const loadMoreClosed = useCallback(async () => {
    if (
      !resolvedRemoteUrl ||
      !hasGitHubAuth ||
      !closedHasMore ||
      !closedNextPage
    )
      return;
    setClosedLoadingMore(true);
    setClosedError(null);
    const result = await fetchIssues(resolvedRemoteUrl, {
      state: "closed",
      page: closedNextPage,
      perPage: ISSUE_PAGE_SIZE,
    });
    if (!mountedRef.current) return;
    setClosedLoadingMore(false);
    if (result.error) {
      handleFetchError(result.error, setClosedError, setClosedLoadState);
      return;
    }
    setClosedIssues((current) => {
      const issues = mergeUniqueIssues(current, result.data!.issues);
      updateCachedClosedIssues(repoKey, issues);
      return issues;
    });
    setClosedHasMore(result.data!.has_more);
    setClosedNextPage(result.data!.next_page);
  }, [
    resolvedRemoteUrl,
    hasGitHubAuth,
    closedHasMore,
    closedNextPage,
    handleFetchError,
    repoKey,
    mountedRef,
  ]);

  // Fetch open issues on mount / auth ready.
  // Skip the network hit when the cache is still fresh (< 10 min) — the UI
  // already shows cached rows so there's no spinner flash on re-entry.
  // Deferred via setTimeout to avoid synchronous setState inside effect body.
  useEffect(() => {
    if (!resolvedRemoteUrl || !hasGitHubAuth) return;
    if (!isIssueCacheStale(repoKey)) return;
    const timer = setTimeout(() => void fetchOpen(), 0);
    return () => clearTimeout(timer);
  }, [resolvedRemoteUrl, hasGitHubAuth, fetchOpen, repoKey]);

  return {
    closedError,
    closedHasMore,
    closedIssues,
    closedLoadState,
    closedLoadingMore,
    fetchClosed,
    fetchOpen,
    loadMoreClosed,
    loadMoreOpen,
    needsReAuth,
    openError,
    openHasMore,
    openIssues,
    openLoadState,
    openLoadingMore,
  };
}

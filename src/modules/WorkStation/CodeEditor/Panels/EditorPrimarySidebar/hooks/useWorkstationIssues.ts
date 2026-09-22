/**
 * useWorkstationIssues
 *
 * Core data layer for the GitHub Issues panel in the workstation sidebar.
 * Owns fetch/create/update/close/reopen/comment logic, writes to
 * workstationIssueListAtom and workstationSelectedIssueAtom, and exposes
 * stable callbacks that the UI components consume.
 */
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useMemo, useRef } from "react";

import {
  workstationIssueCallbackAtomFamily,
  workstationIssueListAtomFamily,
  workstationSelectedIssueAtomFamily,
} from "@src/store/workstation/codeEditor/workstationIssueAtom";
import type { IssueFilterState } from "@src/store/workstation/codeEditor/workstationIssueAtom";
import { workstationRepoScopeKey } from "@src/store/workstation/codeEditor/workstationPrAtom";
import { retainWorkstationRepoScope } from "@src/store/workstation/codeEditor/workstationRepoScopeRetention";

import { useWorkstationIssueList } from "./useWorkstationIssueList";
import { useWorkstationIssueMutations } from "./useWorkstationIssueMutations";
import { useWorkstationIssueRemote } from "./useWorkstationIssueRemote";
import { useWorkstationIssueRepoMetadata } from "./useWorkstationIssueRepoMetadata";
import { useWorkstationIssueSearch } from "./useWorkstationIssueSearch";

export type { IssueFilterState };
export type { UpdateIssueFields } from "./useWorkstationIssueMutations";

export interface UseWorkstationIssuesOptions {
  repoPath: string;
  repoId?: string;
  branchName?: string;
  remoteUrl?: string;
}

export function useWorkstationIssues({
  repoPath,
  repoId,
  remoteUrl: remoteUrlProp,
}: UseWorkstationIssuesOptions) {
  const apiRepoId = repoId ?? "default";
  const scopeKey = workstationRepoScopeKey(repoId, repoPath);
  // Keep this repo's list atoms alive while mounted; released scopes fall
  // into a bounded warm window instead of living for the app lifetime.
  useEffect(() => retainWorkstationRepoScope(scopeKey), [scopeKey]);
  const setListState = useSetAtom(workstationIssueListAtomFamily(scopeKey));
  const setSelectedState = useSetAtom(
    workstationSelectedIssueAtomFamily(scopeKey)
  );
  const setCallbackAtom = useSetAtom(
    workstationIssueCallbackAtomFamily(scopeKey)
  );

  const selectedState = useAtomValue(
    workstationSelectedIssueAtomFamily(scopeKey)
  );

  const mountedRef = useRef(true);
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // ── Auth / remote URL resolution ──────────────────────────────────────────

  const { hasGitHubAuth, remoteUrlLoading, resolvedRemoteUrl } =
    useWorkstationIssueRemote({ apiRepoId, remoteUrlProp, repoPath });

  // Stable cache key — use repoPath so it survives workspace switches
  const repoKey = repoPath;

  // ── Search debounce ───────────────────────────────────────────────────────

  const { applySearch, handleSetSearchQuery, searchQuery } =
    useWorkstationIssueSearch();

  // ── Separate open / closed fetch state ───────────────────────────────────

  const {
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
  } = useWorkstationIssueList({
    hasGitHubAuth,
    mountedRef,
    repoKey,
    resolvedRemoteUrl,
  });

  const refresh = useCallback(
    (includeClosed = false) => {
      void fetchOpen();
      if (includeClosed && closedLoadState !== "loading") void fetchClosed();
    },
    [fetchOpen, fetchClosed, closedLoadState]
  );

  // Keep the shared atom in sync (used by external consumers like agent callbacks)
  useEffect(() => {
    const combined = [...openIssues, ...closedIssues];
    setListState((prev) => ({
      ...prev,
      issues: combined,
      loading: openLoadState === "loading",
      error: openError,
    }));
  }, [openIssues, closedIssues, openLoadState, openError, setListState]);

  // Keep legacy filterState around so mutation callbacks that reference it compile
  const filterState: IssueFilterState = "all";
  const setFilterState = (_: IssueFilterState) => {
    /* no-op — UI no longer drives this */
  };

  // Refetch on debounced search change (client-side filter applied in UI)
  // Search filtering is done client-side via filterIssuesByQuery helper

  // Fetch repo labels + collaborators once auth is available
  const { collaborators, repoLabels } = useWorkstationIssueRepoMetadata({
    hasGitHubAuth,
    resolvedRemoteUrl,
  });

  // ── Issue selection + mutations ───────────────────────────────────────────

  const {
    handleAddComment,
    handleCloseIssue,
    handleCreateIssue,
    handleReopenIssue,
    handleUpdateIssue,
    selectIssue,
  } = useWorkstationIssueMutations({
    mountedRef,
    resolvedRemoteUrl,
    setListState,
    setSelectedState,
  });

  // ── Expose openNewIssueForm callback ──────────────────────────────────────
  // This is populated by IssuesContent once it mounts; the atom acts as a
  // shared signal so PinnedActionsBar / agents can trigger it externally.

  // Clean up atoms on unmount
  useEffect(() => {
    return () => {
      if (!mountedRef.current) return;
      setListState({
        issues: [],
        loading: false,
        error: null,
        filter: "open",
        labelFilter: "",
        searchQuery: "",
        page: 1,
        hasMore: false,
      });
      setSelectedState({
        issue: null,
        timeline: [],
        loading: false,
        timelineLoading: false,
        error: null,
        submittingComment: false,
      });
      setCallbackAtom({
        openNewIssueForm: null,
        closeIssue: null,
        reopenIssue: null,
        addComment: null,
        refreshIssues: null,
      });
    };
  }, [setListState, setSelectedState, setCallbackAtom]);

  // ── Derived values ────────────────────────────────────────────────────────

  const filteredOpen = useMemo(
    () => applySearch(openIssues),
    [openIssues, applySearch]
  );
  const filteredClosed = useMemo(
    () => applySearch(closedIssues),
    [closedIssues, applySearch]
  );

  return {
    // Per-section data
    openIssues: filteredOpen,
    closedIssues: filteredClosed,
    openLoadState,
    closedLoadState,
    openError,
    closedError,
    fetchClosed,
    openHasMore,
    closedHasMore,
    openLoadingMore,
    closedLoadingMore,
    loadMoreOpen,
    loadMoreClosed,
    // Legacy combined — kept for atom sync / mutation callbacks
    issues: useMemo(
      () => applySearch([...openIssues, ...closedIssues]),
      [openIssues, closedIssues, applySearch]
    ),
    loading: openLoadState === "loading",
    remoteUrlLoading,
    needsReAuth,
    error: openError,
    filterState,
    setFilterState,
    searchQuery,
    setSearchQuery: handleSetSearchQuery,
    selectedIssue: selectedState.issue,
    selectIssue,
    timeline: selectedState.timeline,
    timelineLoading: selectedState.timelineLoading,
    submittingComment: selectedState.submittingComment,
    handleCreateIssue,
    handleUpdateIssue,
    handleCloseIssue,
    handleReopenIssue,
    handleAddComment,
    refresh,
    repoLabels,
    collaborators,
    hasGitHubAuth,
  };
}

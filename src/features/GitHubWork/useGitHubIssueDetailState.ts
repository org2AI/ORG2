import { useAtomValue, useSetAtom, useStore } from "jotai";
import { useEffect, useRef, useState } from "react";

import {
  getGitHubRepoPermissionsLocal,
  getGitHubViewerLogin,
} from "@src/api/tauri/github";
import type { GitHubRepoPermissions } from "@src/api/tauri/github";
import {
  githubIssueResourceKey,
  loadGitHubDetailAuthScope,
  loadGitHubRepoPermissions,
  loadGitHubViewer,
  primeGitHubRepoPermissions,
  primeGitHubViewer,
} from "@src/features/GitHubWork/githubIssueDetailCoordinator";
import {
  retainWorkstationIssueDetailScope,
  workstationIssueCallbackAtomFamily,
  workstationSelectedIssueAtomFamily,
} from "@src/store/workstation/codeEditor/workstationIssueAtom";
import { workstationRepoScopeKey } from "@src/store/workstation/codeEditor/workstationPrAtom";

import {
  GITHUB_ISSUE_UNAVAILABLE_ERROR,
  type GitHubIssueInteractionResolution,
  resolveGitHubIssueRepoFullName,
  resolveViewer,
} from "./useGitHubIssueDetailState/resolution";
import { useGitHubIssueAssigneeConfig } from "./useGitHubIssueDetailState/useGitHubIssueAssigneeConfig";
import { useGitHubIssueDetailBundleLoader } from "./useGitHubIssueDetailState/useGitHubIssueDetailBundleLoader";
import { useGitHubIssueInteraction } from "./useGitHubIssueDetailState/useGitHubIssueInteraction";

export {
  GITHUB_ISSUE_TIMEOUT_ERROR,
  GITHUB_ISSUE_UNAVAILABLE_ERROR,
  resolveGitHubIssueRepoFullName,
} from "./useGitHubIssueDetailState/resolution";

export interface GitHubIssueDetailStateOptions {
  /** Omit for repo-scoped Source Control, which already owns the selection. */
  issueNumber?: number;
  repoPath: string;
  repoId?: string;
  remoteUrl?: string;
  stateScopeKey?: string;
  /** Identity-scoped list data can provide these to skip duplicate requests. */
  authScope?: string;
  viewerLogin?: string | null;
  repoPermissions?: GitHubRepoPermissions | null;
}

/** Shared issue-detail state and Inbox-style interactions for every host. */
export function useGitHubIssueDetailState({
  issueNumber: requestedIssueNumber,
  repoPath,
  repoId,
  remoteUrl,
  stateScopeKey: requestedStateScopeKey,
  authScope: providedAuthScope,
  viewerLogin: providedViewerLogin,
  repoPermissions: providedRepoPermissions,
}: GitHubIssueDetailStateOptions) {
  const store = useStore();
  const repoScopeKey = workstationRepoScopeKey(repoId, repoPath);
  const stateScopeKey = requestedStateScopeKey ?? repoScopeKey;
  const selectedState = useAtomValue(
    workstationSelectedIssueAtomFamily(stateScopeKey)
  );
  const issueNumber = requestedIssueNumber ?? selectedState.issue?.number ?? 0;
  const callbacks = useAtomValue(
    workstationIssueCallbackAtomFamily(repoScopeKey)
  );
  const setSelectedState = useSetAtom(
    workstationSelectedIssueAtomFamily(stateScopeKey)
  );
  const [resolution, setResolution] =
    useState<GitHubIssueInteractionResolution | null>(null);
  const authResolutionKey = `${repoPath}|${remoteUrl ?? ""}`;
  const [resolvedAuth, setResolvedAuth] = useState<{
    key: string;
    scope: string | null;
  } | null>(null);
  const authScope =
    providedAuthScope ??
    (resolvedAuth?.key === authResolutionKey ? resolvedAuth.scope : null);
  /**
   * Auth-scope resolution has produced an answer for this repository — either a
   * scope or a definitive failure. Until it has, a missing scope is pending
   * rather than terminal.
   */
  const authScopeResolved =
    providedAuthScope !== undefined || resolvedAuth?.key === authResolutionKey;
  const selectedIssueRef = useRef(selectedState.issue);
  const selectedTimelineRef = useRef(selectedState.timeline);
  const requestGenerationRef = useRef(0);

  useEffect(() => {
    selectedIssueRef.current = selectedState.issue;
    selectedTimelineRef.current = selectedState.timeline;
  }, [selectedState.issue, selectedState.timeline]);

  useEffect(() => {
    // Repo-scoped Source Control state owns the user's current selection and
    // must survive switching editor panes. Standalone detail scopes are
    // disposable and otherwise grow the primitive-key atom family forever.
    const preserveSelection = stateScopeKey === repoScopeKey;
    const release = retainWorkstationIssueDetailScope(stateScopeKey, {
      evictOnFinalRelease: !preserveSelection,
    });
    return () => {
      if (release() && preserveSelection) {
        // The issue remains selected for the next Source Control visit, but
        // the potentially large timeline has a bounded mounted lifetime.
        setSelectedState((current) => ({
          ...current,
          resourceKey: null,
          timeline: [],
          timelineLoading: false,
        }));
      }
    };
  }, [repoScopeKey, setSelectedState, stateScopeKey]);

  useEffect(() => {
    if (providedAuthScope || (!repoPath && !remoteUrl)) return;
    let cancelled = false;
    void loadGitHubDetailAuthScope(store)
      .then((scope) => {
        if (!cancelled) setResolvedAuth({ key: authResolutionKey, scope });
      })
      .catch(() => {
        if (!cancelled)
          setResolvedAuth({ key: authResolutionKey, scope: null });
      });
    return () => {
      cancelled = true;
    };
  }, [authResolutionKey, providedAuthScope, remoteUrl, repoPath, store]);

  const repoFullName = resolveGitHubIssueRepoFullName(
    remoteUrl,
    selectedState.issue?.html_url
  );
  const requestKey =
    authScope && repoFullName && issueNumber > 0
      ? githubIssueResourceKey(authScope, repoFullName, issueNumber)
      : null;
  const selectedStateMatches =
    Boolean(requestKey) &&
    selectedState.resourceKey === requestKey &&
    selectedState.issue?.number === issueNumber;
  const currentResolution = resolution?.key === requestKey ? resolution : null;
  /**
   * A host that names its own issue has three outcomes, not two: the request is
   * still running, it settled with the issue, or it settled without one — a
   * failed fetch, an unresolvable repository, or auth-scope resolution that
   * failed outright. Only the first is loading. Folding the third into
   * "loading" strands every consumer on a skeleton that never resolves and
   * erases the error that explains it, so keep the outcomes separable here.
   */
  const ownsRequestedIssue = Boolean(requestedIssueNumber && remoteUrl);
  const requestSettledWithoutIssue =
    ownsRequestedIssue &&
    !selectedStateMatches &&
    (requestKey
      ? selectedState.resourceKey === requestKey && !selectedState.loading
      : authScopeResolved);

  useGitHubIssueDetailBundleLoader({
    store,
    requestKey,
    issueNumber,
    remoteUrl,
    repoFullName,
    selectedStateMatches,
    setSelectedState,
  });

  useEffect(() => {
    const generation = ++requestGenerationRef.current;
    if (!requestKey || !repoFullName || !authScope) return;
    let cancelled = false;
    const currentIssue =
      selectedState.resourceKey === requestKey
        ? selectedIssueRef.current
        : null;
    const currentTimeline =
      selectedState.resourceKey === requestKey
        ? selectedTimelineRef.current
        : [];

    if (providedViewerLogin) {
      primeGitHubViewer(store, authScope, providedViewerLogin);
    }
    if (providedRepoPermissions) {
      primeGitHubRepoPermissions(
        store,
        authScope,
        repoFullName,
        providedRepoPermissions
      );
    }
    void Promise.allSettled([
      loadGitHubViewer(store, authScope, getGitHubViewerLogin),
      loadGitHubRepoPermissions(store, authScope, repoFullName, () =>
        getGitHubRepoPermissionsLocal(repoFullName)
      ),
    ]).then(([viewerResult, permissionsResult]) => {
      if (cancelled || requestGenerationRef.current !== generation) return;
      setResolution({
        key: requestKey,
        viewer:
          viewerResult.status === "fulfilled"
            ? resolveViewer(viewerResult.value, currentIssue, currentTimeline)
            : null,
        permissions:
          permissionsResult.status === "fulfilled"
            ? permissionsResult.value
            : null,
        duplicateCandidates: [],
        duplicateCandidatesLoaded: false,
        loadingDuplicateCandidates: false,
        duplicateCandidatesError: false,
        assignableUsers: [],
        assignableUsersLoaded: false,
        loadingAssignableUsers: false,
        assigneesError: null,
        submittingComment: false,
        updatingBody: false,
        updatingStatus: false,
        updatingAssignees: false,
        error: null,
      });
    });

    return () => {
      cancelled = true;
      if (requestGenerationRef.current === generation) {
        requestGenerationRef.current += 1;
      }
    };
  }, [
    authScope,
    providedRepoPermissions,
    providedViewerLogin,
    repoFullName,
    requestKey,
    selectedState.resourceKey,
    store,
  ]);

  const interaction = useGitHubIssueInteraction({
    store,
    requestKey,
    repoFullName,
    authScope,
    issueNumber,
    currentResolution,
    setResolution,
    selectedState,
    setSelectedState,
    callbacks,
    requestGenerationRef,
    ownsRequestedIssue,
    requestSettledWithoutIssue,
    selectedStateMatches,
  });

  const assigneeConfig = useGitHubIssueAssigneeConfig({
    store,
    requestKey,
    repoFullName,
    authScope,
    currentResolution,
    setResolution,
    selectedState,
    setSelectedState,
    callbacks,
    requestGenerationRef,
  });

  const visibleSelectedState =
    !ownsRequestedIssue || selectedStateMatches
      ? selectedState
      : requestSettledWithoutIssue
        ? {
            ...selectedState,
            issue: null,
            timeline: [],
            loading: false,
            timelineLoading: false,
            // Never surface an error left behind by a previous selection.
            error:
              requestKey &&
              selectedState.resourceKey === requestKey &&
              selectedState.error
                ? selectedState.error
                : GITHUB_ISSUE_UNAVAILABLE_ERROR,
          }
        : {
            ...selectedState,
            issue: null,
            timeline: [],
            loading: true,
            timelineLoading: true,
            error: null,
          };

  return { selectedState: visibleSelectedState, interaction, assigneeConfig };
}

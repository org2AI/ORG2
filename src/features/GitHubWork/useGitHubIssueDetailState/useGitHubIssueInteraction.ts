import type { Store } from "jotai/vanilla/store";
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useMemo,
} from "react";

import {
  createIssueCommentLocal,
  listIssueTimelineLocal,
  updateIssueLocal,
} from "@src/api/tauri/github";
import type { GitHubIssue } from "@src/api/tauri/github";
import {
  invalidateGitHubIssueDetailBundle,
  invalidateGitHubIssueTimeline,
  loadGitHubIssueTimeline,
  primeGitHubIssueDetailBundle,
  primeGitHubIssueTimeline,
} from "@src/features/GitHubWork/githubIssueDetailCoordinator";
import type {
  GitHubIssueInteractionConfig,
  GitHubIssueStatusChangeOptions,
} from "@src/modules/ProjectManager/WorkItems/components/WorkItemContent/types";
import { issueCommentToTimelineItem } from "@src/services/git/operations/githubIssues";
import type {
  WorkstationIssueCallbacks,
  WorkstationSelectedIssueState,
} from "@src/store/workstation/codeEditor/workstationIssueAtom";

import {
  type GitHubIssueInteractionResolution,
  canEditIssue,
  resolveViewer,
} from "./resolution";
import { useGitHubIssueDuplicateCandidates } from "./useGitHubIssueDuplicateCandidates";

/** Comment, body, status and duplicate-candidate interactions for the issue. */
export function useGitHubIssueInteraction({
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
}: {
  store: Store;
  requestKey: string | null;
  repoFullName: string | null;
  authScope: string | null;
  issueNumber: number;
  currentResolution: GitHubIssueInteractionResolution | null;
  setResolution: Dispatch<
    SetStateAction<GitHubIssueInteractionResolution | null>
  >;
  selectedState: WorkstationSelectedIssueState;
  setSelectedState: (
    update: SetStateAction<WorkstationSelectedIssueState>
  ) => void;
  callbacks: WorkstationIssueCallbacks;
  requestGenerationRef: { current: number };
  ownsRequestedIssue: boolean;
  requestSettledWithoutIssue: boolean;
  selectedStateMatches: boolean;
}): GitHubIssueInteractionConfig {
  const loadDuplicateCandidates = useGitHubIssueDuplicateCandidates({
    store,
    requestKey,
    repoFullName,
    authScope,
    issueNumber,
    currentResolution,
    setResolution,
    requestGenerationRef,
  });

  const addComment = useCallback(
    async (body: string) => {
      const issue = selectedState.issue;
      if (
        !requestKey ||
        !repoFullName ||
        !issue ||
        !currentResolution?.viewer ||
        currentResolution.submittingComment
      ) {
        throw new Error("github_comment_unavailable");
      }
      setResolution((current) =>
        current?.key === requestKey
          ? { ...current, submittingComment: true, error: null }
          : current
      );

      try {
        const comment = await createIssueCommentLocal(
          repoFullName,
          issue.number,
          body
        );
        invalidateGitHubIssueDetailBundle(store, requestKey);
        invalidateGitHubIssueTimeline(store, requestKey);
        setSelectedState((current) =>
          current.issue?.number === issue.number
            ? {
                ...current,
                issue: {
                  ...current.issue,
                  comments: current.issue.comments + 1,
                },
                timeline: [
                  ...current.timeline,
                  issueCommentToTimelineItem(comment),
                ],
              }
            : current
        );
        setResolution((current) =>
          current?.key === requestKey
            ? { ...current, submittingComment: false, error: null }
            : current
        );
      } catch (error) {
        setResolution((current) =>
          current?.key === requestKey
            ? { ...current, submittingComment: false, error: "comment" }
            : current
        );
        throw error;
      }
    },
    [
      currentResolution,
      repoFullName,
      requestKey,
      selectedState.issue,
      setResolution,
      setSelectedState,
      store,
    ]
  );

  const updateBody = useCallback(
    async (body: string) => {
      const issue = selectedState.issue;
      if (
        !requestKey ||
        !repoFullName ||
        !issue ||
        !currentResolution ||
        currentResolution.updatingBody ||
        currentResolution.updatingStatus
      ) {
        throw new Error("github_body_update_unavailable");
      }
      if (!canEditIssue(currentResolution, issue)) {
        throw new Error("github_body_update_forbidden");
      }

      setResolution((current) =>
        current?.key === requestKey
          ? { ...current, updatingBody: true, error: null }
          : current
      );
      try {
        const updatedIssue = await updateIssueLocal(
          repoFullName,
          issue.number,
          { body }
        );
        invalidateGitHubIssueDetailBundle(store, requestKey);
        setSelectedState((current) =>
          current.issue?.number === issue.number
            ? { ...current, issue: updatedIssue }
            : current
        );
        setResolution((current) =>
          current?.key === requestKey
            ? { ...current, updatingBody: false }
            : current
        );
        callbacks.refreshIssues?.();
      } catch (error) {
        setResolution((current) =>
          current?.key === requestKey
            ? { ...current, updatingBody: false }
            : current
        );
        throw error;
      }
    },
    [
      callbacks,
      currentResolution,
      repoFullName,
      requestKey,
      selectedState.issue,
      setResolution,
      setSelectedState,
      store,
    ]
  );

  const changeStatus = useCallback(
    async (
      state: GitHubIssue["state"],
      options?: GitHubIssueStatusChangeOptions
    ) => {
      const issue = selectedState.issue;
      if (
        !requestKey ||
        !repoFullName ||
        !issue ||
        !currentResolution ||
        currentResolution.updatingStatus ||
        currentResolution.updatingBody
      ) {
        throw new Error("github_status_unavailable");
      }
      if (!canEditIssue(currentResolution, issue)) {
        throw new Error("github_status_forbidden");
      }
      const stateReason =
        state === "closed" ? (options?.stateReason ?? "completed") : undefined;
      if (
        stateReason === "duplicate" &&
        (!options?.duplicateIssueId || options.duplicateIssueId <= 0)
      ) {
        throw new Error("github_duplicate_issue_required");
      }

      setResolution((current) =>
        current?.key === requestKey
          ? { ...current, updatingStatus: true, error: null }
          : current
      );
      try {
        const updatedIssue = await updateIssueLocal(
          repoFullName,
          issue.number,
          {
            state,
            stateReason,
            ...(stateReason === "duplicate"
              ? { duplicateIssueId: options?.duplicateIssueId }
              : {}),
          }
        );
        const timeline = await loadGitHubIssueTimeline(
          store,
          requestKey,
          () => listIssueTimelineLocal(repoFullName, issue.number),
          { force: true }
        ).catch(() => selectedState.timeline);
        primeGitHubIssueTimeline(store, requestKey, timeline);
        primeGitHubIssueDetailBundle(store, requestKey, {
          issue: updatedIssue,
          timeline,
          error: null,
        });
        setSelectedState((current) =>
          current.issue?.number === issue.number
            ? { ...current, issue: updatedIssue, timeline }
            : current
        );
        setResolution((current) =>
          current?.key === requestKey
            ? { ...current, updatingStatus: false, error: null }
            : current
        );
        callbacks.refreshIssues?.();
      } catch (error) {
        setResolution((current) =>
          current?.key === requestKey
            ? { ...current, updatingStatus: false, error: "status" }
            : current
        );
        throw error;
      }
    },
    [
      callbacks,
      currentResolution,
      repoFullName,
      requestKey,
      selectedState.issue,
      selectedState.timeline,
      setResolution,
      setSelectedState,
      store,
    ]
  );

  return useMemo<GitHubIssueInteractionConfig>(() => {
    const issue = selectedState.issue;
    const canManageStatus = canEditIssue(currentResolution, issue);
    const viewer = currentResolution?.viewer
      ? resolveViewer(
          currentResolution.viewer.login,
          issue,
          selectedState.timeline
        )
      : null;

    return {
      viewer,
      issueState: issue?.state ?? "open",
      duplicateCandidates: currentResolution?.duplicateCandidates ?? [],
      duplicateCandidatesLoaded:
        currentResolution?.duplicateCandidatesLoaded ?? false,
      loadingDuplicateCandidates:
        currentResolution?.loadingDuplicateCandidates ?? false,
      duplicateCandidatesError:
        currentResolution?.duplicateCandidatesError ?? false,
      loading:
        ownsRequestedIssue &&
        !requestSettledWithoutIssue &&
        (!authScope || !selectedStateMatches || !currentResolution),
      canComment: Boolean(currentResolution?.viewer),
      canEditBody: canManageStatus,
      canManageStatus,
      submittingComment: currentResolution?.submittingComment ?? false,
      updatingBody: currentResolution?.updatingBody ?? false,
      updatingStatus: currentResolution?.updatingStatus ?? false,
      error: currentResolution?.error ?? null,
      onAddComment: addComment,
      onUpdateBody: updateBody,
      onLoadDuplicateCandidates: loadDuplicateCandidates,
      onStatusChange: changeStatus,
    };
  }, [
    addComment,
    changeStatus,
    currentResolution,
    loadDuplicateCandidates,
    authScope,
    ownsRequestedIssue,
    requestSettledWithoutIssue,
    selectedStateMatches,
    selectedState.issue,
    selectedState.timeline,
    updateBody,
  ]);
}

import type { Store } from "jotai/vanilla/store";
import { type Dispatch, type SetStateAction, useCallback } from "react";

import { listIssuesLocal } from "@src/api/tauri/github";
import { loadGitHubDuplicateCandidates } from "@src/features/GitHubWork/githubIssueDetailCoordinator";

import type { GitHubIssueInteractionResolution } from "./resolution";

/** Lazily loads the duplicate-target candidates for the close-as-duplicate flow. */
export function useGitHubIssueDuplicateCandidates({
  store,
  requestKey,
  repoFullName,
  authScope,
  issueNumber,
  currentResolution,
  setResolution,
  requestGenerationRef,
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
  requestGenerationRef: { current: number };
}): () => Promise<void> {
  return useCallback((): Promise<void> => {
    if (!requestKey || !repoFullName || !authScope || !currentResolution) {
      return Promise.reject(new Error("github_duplicate_issues_unavailable"));
    }
    if (currentResolution.duplicateCandidatesLoaded) {
      return Promise.resolve();
    }
    const generation = requestGenerationRef.current;

    setResolution((current) =>
      current?.key === requestKey
        ? {
            ...current,
            loadingDuplicateCandidates: true,
            duplicateCandidatesError: false,
          }
        : current
    );

    return loadGitHubDuplicateCandidates(
      store,
      authScope,
      repoFullName,
      issueNumber,
      async () => {
        const { issues } = await listIssuesLocal(repoFullName, {
          state: "all",
          page: 1,
          perPage: 100,
          includeLinkedPullRequests: false,
        });
        return issues.filter(
          (candidate) =>
            candidate.number !== issueNumber &&
            typeof candidate.id === "number" &&
            candidate.id > 0
        );
      }
    )
      .then((candidates) => {
        setResolution((current) =>
          current?.key === requestKey &&
          requestGenerationRef.current === generation
            ? {
                ...current,
                duplicateCandidates: candidates,
                duplicateCandidatesLoaded: true,
                loadingDuplicateCandidates: false,
                duplicateCandidatesError: false,
              }
            : current
        );
      })
      .catch((error) => {
        setResolution((current) =>
          current?.key === requestKey &&
          requestGenerationRef.current === generation
            ? {
                ...current,
                loadingDuplicateCandidates: false,
                duplicateCandidatesError: true,
              }
            : current
        );
        throw error;
      });
  }, [
    authScope,
    currentResolution,
    issueNumber,
    repoFullName,
    requestGenerationRef,
    requestKey,
    setResolution,
    store,
  ]);
}

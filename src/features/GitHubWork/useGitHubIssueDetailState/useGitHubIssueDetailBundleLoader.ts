import type { Store } from "jotai/vanilla/store";
import { type SetStateAction, useEffect } from "react";

import { getIssueLocal, listIssueTimelineLocal } from "@src/api/tauri/github";
import type { GitHubIssueTimelineItem } from "@src/api/tauri/github";
import {
  loadGitHubIssueDetailBundle,
  loadGitHubIssueTimeline,
} from "@src/features/GitHubWork/githubIssueDetailCoordinator";
import {
  fetchIssue,
  fetchIssueTimeline,
} from "@src/services/git/operations/githubIssues";
import type { WorkstationSelectedIssueState } from "@src/store/workstation/codeEditor/workstationIssueAtom";

import {
  GITHUB_ISSUE_TIMEOUT_ERROR,
  ISSUE_DETAIL_REQUEST_TIMEOUT_MS,
  withDeadline,
} from "./resolution";

/** Loads the issue + timeline bundle for the current request key. */
export function useGitHubIssueDetailBundleLoader({
  store,
  requestKey,
  issueNumber,
  remoteUrl,
  repoFullName,
  selectedStateMatches,
  setSelectedState,
}: {
  store: Store;
  requestKey: string | null;
  issueNumber: number;
  remoteUrl: string | undefined;
  repoFullName: string | null;
  selectedStateMatches: boolean;
  setSelectedState: (
    update: SetStateAction<WorkstationSelectedIssueState>
  ) => void;
}): void {
  useEffect(() => {
    if (!requestKey || issueNumber <= 0 || selectedStateMatches) {
      return;
    }
    let cancelled = false;
    setSelectedState((prev) => ({
      ...prev,
      resourceKey: requestKey,
      issue: null,
      timeline: [],
      loading: true,
      timelineLoading: true,
      error: null,
    }));
    void withDeadline(
      loadGitHubIssueDetailBundle(store, requestKey, async () => {
        const issueResultPromise = remoteUrl
          ? fetchIssue(remoteUrl, issueNumber)
          : getIssueLocal(repoFullName!, issueNumber).then((issue) => ({
              data: issue,
              error: null,
            }));
        let timeline: GitHubIssueTimelineItem[] = [];
        let timelineError: string | null = null;
        try {
          timeline = await loadGitHubIssueTimeline(
            store,
            requestKey,
            async () => {
              if (!remoteUrl) {
                return listIssueTimelineLocal(repoFullName!, issueNumber);
              }
              const timelineResult = await fetchIssueTimeline({
                remoteUrl,
                issueNumber,
              });
              if (timelineResult.error) throw new Error(timelineResult.error);
              return timelineResult.data ?? [];
            }
          );
        } catch (error) {
          timelineError =
            error instanceof Error ? error.message : String(error);
        }
        const issueResult = await issueResultPromise;
        return {
          issue: issueResult.data ?? null,
          timeline,
          error: issueResult.error ?? timelineError,
        };
      }),
      ISSUE_DETAIL_REQUEST_TIMEOUT_MS,
      () => ({
        issue: null,
        timeline: [],
        error: GITHUB_ISSUE_TIMEOUT_ERROR,
      })
    )
      .then((bundle) => {
        if (cancelled) return;
        setSelectedState((prev) =>
          prev.resourceKey === requestKey
            ? {
                ...prev,
                issue: bundle.issue,
                timeline: bundle.timeline,
                loading: false,
                timelineLoading: false,
                error: bundle.error,
              }
            : prev
        );
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setSelectedState((prev) =>
          prev.resourceKey === requestKey
            ? {
                ...prev,
                loading: false,
                timelineLoading: false,
                error: error instanceof Error ? error.message : String(error),
              }
            : prev
        );
      });
    return () => {
      cancelled = true;
    };
  }, [
    issueNumber,
    repoFullName,
    remoteUrl,
    requestKey,
    selectedStateMatches,
    setSelectedState,
    store,
  ]);
}

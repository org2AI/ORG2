import { useMemo } from "react";

import type { GitHubIssueTimelineItem } from "@src/api/tauri/github";
import {
  extractGitHubReferences,
  getWorkItemReferenceText,
  parseGitHubRepoFromItemUrl,
} from "@src/features/GitHubWork/GitHubLinkedReferences/references";
import type { WorkItem } from "@src/types/core/workItem";

interface UseWorkItemPanelLinkedReferencesArgs {
  workItem: WorkItem;
  githubIssueExternalUrl: string | undefined;
  githubTimelineItems: GitHubIssueTimelineItem[] | undefined;
}

/** GitHub references found in the work item text and its issue timeline. */
export function useWorkItemPanelLinkedReferences({
  workItem,
  githubIssueExternalUrl,
  githubTimelineItems,
}: UseWorkItemPanelLinkedReferencesArgs) {
  const defaultRepoFullName = useMemo(
    () =>
      githubIssueExternalUrl
        ? parseGitHubRepoFromItemUrl(githubIssueExternalUrl)
        : null,
    [githubIssueExternalUrl]
  );
  const githubTimelineText = useMemo(
    () => githubTimelineItems?.map((item) => item.body) ?? [],
    [githubTimelineItems]
  );
  const workItemReferenceText = useMemo(
    () =>
      getWorkItemReferenceText(
        {
          spec: workItem.spec,
          comments: workItem.comments,
        },
        githubTimelineText
      ),
    [githubTimelineText, workItem.comments, workItem.spec]
  );
  const linkedReferences = useMemo(
    () =>
      extractGitHubReferences(workItemReferenceText, { defaultRepoFullName }),
    [defaultRepoFullName, workItemReferenceText]
  );

  return { defaultRepoFullName, linkedReferences };
}

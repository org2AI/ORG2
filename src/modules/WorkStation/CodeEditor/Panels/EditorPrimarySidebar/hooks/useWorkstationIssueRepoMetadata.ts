/**
 * Repository metadata for the workstation Issues panel: the labels and
 * assignable collaborators fetched once GitHub auth is available.
 */
import { useEffect, useState } from "react";

import { createLogger } from "@src/hooks/logger";
import {
  fetchRepoAssignees,
  fetchRepoLabels,
} from "@src/services/git/operations/githubIssues";
import type {
  GitHubIssueLabel,
  GitHubIssueUser,
} from "@src/services/git/operations/githubIssues";

const logger = createLogger("WorkstationIssues");

export function useWorkstationIssueRepoMetadata({
  hasGitHubAuth,
  resolvedRemoteUrl,
}: {
  hasGitHubAuth: boolean;
  resolvedRemoteUrl: string | null;
}) {
  const [repoLabels, setRepoLabels] = useState<GitHubIssueLabel[]>([]);
  const [collaborators, setCollaborators] = useState<GitHubIssueUser[]>([]);

  // Fetch repo labels + collaborators once auth is available
  useEffect(() => {
    if (!resolvedRemoteUrl || !hasGitHubAuth) return;
    let cancelled = false;

    (async () => {
      const [labelsResult, collabResult] = await Promise.all([
        fetchRepoLabels(resolvedRemoteUrl),
        fetchRepoAssignees(resolvedRemoteUrl),
      ]);
      if (cancelled) return;
      if (labelsResult.data) setRepoLabels(labelsResult.data);
      if (collabResult.data) setCollaborators(collabResult.data);
    })().catch((error: unknown) => {
      logger.warn("repo labels / collaborators fetch failed", error);
    });

    return () => {
      cancelled = true;
    };
  }, [resolvedRemoteUrl, hasGitHubAuth]);

  return { collaborators, repoLabels };
}

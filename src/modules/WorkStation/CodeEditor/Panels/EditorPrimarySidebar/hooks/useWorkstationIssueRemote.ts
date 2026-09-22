/**
 * Remote URL resolution for the workstation Issues panel: takes the remote
 * from props when given, otherwise reads the repository's `origin`, and
 * derives the optimistic GitHub auth flag from it.
 */
import { useEffect, useMemo, useState } from "react";

import { getGitRemotes } from "@src/api/http/git/remotes";
import { createLogger } from "@src/hooks/logger";
import { parseGithubRepoFullName } from "@src/services/git/operations/createPullRequest";

const logger = createLogger("WorkstationIssues");

export function useWorkstationIssueRemote({
  apiRepoId,
  remoteUrlProp,
  repoPath,
}: {
  apiRepoId: string;
  remoteUrlProp: string | undefined;
  repoPath: string;
}) {
  const [resolvedRemoteUrl, setResolvedRemoteUrl] = useState<string | null>(
    null
  );
  // Optimistic auth flag: true when the remote is a GitHub URL.
  // Credentials are resolved Rust-side from connection_token_store — no
  // pre-flight token ping needed. Real auth failures from API calls will
  // flip this to false, matching the trust model used by the PR panel.
  // Track whether we're still waiting for the remote URL to resolve so the
  // panel shows a spinner instead of the empty-state placeholder.
  const [remoteUrlLoading, setRemoteUrlLoading] = useState(true);

  // Resolve origin remote URL if not provided via props
  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (remoteUrlProp) {
        logger.debug("remote URL from prop", remoteUrlProp);
        if (!cancelled) {
          setResolvedRemoteUrl(remoteUrlProp);
          setRemoteUrlLoading(false);
        }
        return;
      }
      if (!repoPath) {
        if (!cancelled) setRemoteUrlLoading(false);
        return;
      }

      logger.debug("fetching remotes", { repoPath, repoId: apiRepoId });
      try {
        const remotesData = await getGitRemotes({
          repo_id: apiRepoId,
          repo_path: repoPath,
        });
        logger.debug("getGitRemotes result", remotesData);
        const origin = remotesData?.remotes?.find((r) => r.name === "origin");
        logger.debug("origin remote", origin);
        if (!cancelled) {
          if (origin?.url) {
            setResolvedRemoteUrl(origin.url);
          }
          setRemoteUrlLoading(false);
        }
      } catch (err) {
        logger.warn("getGitRemotes failed", err);
        if (!cancelled) setRemoteUrlLoading(false);
      }
    })().catch((error: unknown) => {
      logger.warn("remote URL resolution failed", error);
    });

    return () => {
      cancelled = true;
    };
  }, [repoPath, apiRepoId, remoteUrlProp]);

  // Optimistically true when the remote resolves to a GitHub URL.
  // A valid GitHub URL means credentials should be available via
  // connection_token_store — no need for a separate /user ping.
  const hasGitHubAuth = useMemo(() => {
    if (!resolvedRemoteUrl) return false;
    const repoFullName = parseGithubRepoFullName(resolvedRemoteUrl);
    logger.debug("resolved remote URL", { resolvedRemoteUrl, repoFullName });
    return !!repoFullName;
  }, [resolvedRemoteUrl]);

  return { hasGitHubAuth, remoteUrlLoading, resolvedRemoteUrl };
}

/**
 * Git / GitHub rows of the focused-chat workstation rail: the active repo's
 * Review row, its compare link and branch pull request, plus the pull request
 * linked to the session's own branch when it differs from the local one.
 */
import type { TFunction } from "i18next";
import { useMemo } from "react";

import GitHubIcon from "@src/assets/channelIcons/github.svg";
import { isSameFocusedChatGitEnvironment } from "@src/engines/ChatPanel/focusedChatWorkstationLayout";
import { useActiveRepoRef } from "@src/hooks/git/useActiveRepoRef";
import { useBranchPullRequestStatus } from "@src/hooks/git/useBranchPullRequestStatus";
import { useRepoSelection } from "@src/hooks/git/useRepoSelection";
import { FileDiffIcon, GitPullRequestIcon } from "@src/icons";
import { WorkStationViewService } from "@src/services/workStation/WorkStationViewService";
import { openLink } from "@src/util/ui/openLink";

import type { FocusedChatRailItem, FocusedChatSessionContext } from "./types";

const GitHubRailIcon = ({
  size = 24,
  ...props
}: {
  size?: number;
  [key: string]: unknown;
}) => <GitHubIcon {...props} width={size} height={size} />;

export function useWorkstationRailGitHub({
  sessionContext,
  t,
}: {
  sessionContext: FocusedChatSessionContext | undefined;
  t: TFunction;
}) {
  const { currentBranch } = useRepoSelection({ autoLoad: false });
  const activeBranchName = currentBranch || undefined;

  const { repoId, repoPath: activeRepoPath } = useActiveRepoRef();
  const {
    ciStatus: branchCiStatus,
    compareUrl: branchCompareUrl,
    pr: branchPullRequest,
  } = useBranchPullRequestStatus({
    branchName: activeBranchName,
    repoId,
    repoPath: activeRepoPath,
  });
  const sessionSharesLocalGitEnvironment = isSameFocusedChatGitEnvironment({
    localBranchName: activeBranchName,
    localRepoPath: activeRepoPath,
    sessionBranchName:
      sessionContext?.worktreeBranchName ?? sessionContext?.branchName,
    sessionRepoPath: sessionContext?.repoPath,
  });
  const sessionGitLookupEnabled = Boolean(
    (sessionContext?.worktreeBranchName ?? sessionContext?.branchName) &&
    sessionContext.repoPath &&
    !sessionSharesLocalGitEnvironment
  );
  const { ciStatus: sessionBranchCiStatus, pr: sessionBranchPullRequest } =
    useBranchPullRequestStatus({
      branchName: sessionGitLookupEnabled
        ? (sessionContext?.worktreeBranchName ?? sessionContext?.branchName)
        : undefined,
      repoPath: sessionGitLookupEnabled ? sessionContext?.repoPath : undefined,
    });
  const resolvedSessionBranchCiStatus = sessionSharesLocalGitEnvironment
    ? branchCiStatus
    : sessionGitLookupEnabled
      ? sessionBranchCiStatus
      : null;
  const resolvedSessionBranchPullRequest = sessionSharesLocalGitEnvironment
    ? branchPullRequest
    : sessionGitLookupEnabled
      ? sessionBranchPullRequest
      : null;

  const branchPullRequestStatus = useMemo<
    FocusedChatRailItem["status"] | undefined
  >(() => {
    if (!branchPullRequest || !branchCiStatus) return undefined;
    const label =
      branchCiStatus === "success"
        ? t("common:git.pr.checks.passedShort")
        : branchCiStatus === "failure"
          ? t("common:git.pr.checks.failedShort")
          : branchCiStatus === "pending"
            ? t("common:git.pr.checks.runningShort")
            : branchCiStatus === "checking"
              ? t("common:git.pr.checks.checkingShort")
              : branchCiStatus === "none"
                ? t("common:git.pr.checks.noneShort")
                : t("common:git.pr.checks.unavailableShort");
    return {
      label,
      state: branchCiStatus,
      title: t("common:git.pr.checks.branchStatus", {
        number: branchPullRequest.number,
        status: label,
      }),
    };
  }, [branchCiStatus, branchPullRequest, t]);

  const workspaceItems = useMemo<FocusedChatRailItem[]>(
    () => [
      {
        key: "changes",
        label: t("common:git.pr.tabs.changes"),
        icon: FileDiffIcon,
        shortcutId: "open_source_control_tab",
        ...(repoId && activeRepoPath
          ? { workingTreeRepo: { repoId, repoPath: activeRepoPath } }
          : {}),
        onClick: () => void WorkStationViewService.openSourceControlTab(),
      },
      ...(branchCompareUrl
        ? [
            {
              key: "compare-branch",
              label: t("common:git.actions.compareBranch"),
              icon: GitHubRailIcon,
              external: true,
              onClick: () => openLink(branchCompareUrl),
            },
          ]
        : []),
      ...(branchPullRequest
        ? [
            {
              key: `pull-request:${branchPullRequest.number}`,
              label: `#${branchPullRequest.number}`,
              icon: GitPullRequestIcon,
              external: true,
              status: branchPullRequestStatus,
              onClick: () => openLink(branchPullRequest.url),
            },
          ]
        : []),
      // Terminal / Files / Browser rows are parked in the expanded list:
      // each of them left the focused chat for the Workstation, which is the
      // opposite of what the trail is for. The terminal now stays in the
      // pane — the header's terminal control and the trail's native
      // right-click menu open `WorkstationTrailTerminal` instead.
    ],
    [
      t,
      repoId,
      activeRepoPath,
      branchCompareUrl,
      branchPullRequest,
      branchPullRequestStatus,
    ]
  );

  const sessionPullRequestStatus = useMemo<
    FocusedChatRailItem["status"] | undefined
  >(() => {
    if (!resolvedSessionBranchPullRequest || !resolvedSessionBranchCiStatus) {
      return undefined;
    }
    const label =
      resolvedSessionBranchCiStatus === "success"
        ? t("common:git.pr.checks.passedShort")
        : resolvedSessionBranchCiStatus === "failure"
          ? t("common:git.pr.checks.failedShort")
          : resolvedSessionBranchCiStatus === "pending"
            ? t("common:git.pr.checks.runningShort")
            : resolvedSessionBranchCiStatus === "checking"
              ? t("common:git.pr.checks.checkingShort")
              : resolvedSessionBranchCiStatus === "none"
                ? t("common:git.pr.checks.noneShort")
                : t("common:git.pr.checks.unavailableShort");
    return {
      label,
      state: resolvedSessionBranchCiStatus,
      title: t("common:git.pr.checks.branchStatus", {
        number: resolvedSessionBranchPullRequest.number,
        status: label,
      }),
    };
  }, [resolvedSessionBranchCiStatus, resolvedSessionBranchPullRequest, t]);

  const sessionItems = useMemo<FocusedChatRailItem[]>(
    () =>
      resolvedSessionBranchPullRequest
        ? [
            {
              key: `session-pull-request:${resolvedSessionBranchPullRequest.number}`,
              label: t("common:git.pr.linkedBranch", {
                number: resolvedSessionBranchPullRequest.number,
              }),
              icon: GitPullRequestIcon,
              external: true,
              status: sessionPullRequestStatus,
              onClick: () => openLink(resolvedSessionBranchPullRequest.url),
            },
          ]
        : [],
    [resolvedSessionBranchPullRequest, sessionPullRequestStatus, t]
  );

  return { activeBranchName, sessionItems, workspaceItems };
}

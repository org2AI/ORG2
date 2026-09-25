/** Git workspace actions and the active conversation's associated pull request. */
import type { TFunction } from "i18next";
import { useSetAtom } from "jotai";
import { useMemo } from "react";

import GitHubIcon from "@src/assets/channelIcons/github.svg";
import { useActiveRepoRef } from "@src/hooks/git/useActiveRepoRef";
import { useBranchPullRequestStatus } from "@src/hooks/git/useBranchPullRequestStatus";
import { useRepoSelection } from "@src/hooks/git/useRepoSelection";
import {
  FileDiffIcon,
  GitMergeIcon,
  GitPullRequestClosedIcon,
  GitPullRequestDraftIcon,
  GitPullRequestIcon,
  HugeiconsIcon,
  Loading03Icon,
  Refresh04Icon,
} from "@src/icons";
import { WorkStationViewService } from "@src/services/workStation/WorkStationViewService";
import { openGitHubPrInChatPanelTabAtom } from "@src/store/chatPanel/chatPanelTabsAtom";
import {
  getPrStatusLabelKey,
  getPrStatusVariant,
} from "@src/util/git/pr/prStatus";
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
  const openPullRequest = useSetAtom(openGitHubPrInChatPanelTabAtom);
  // An unresolved conversation scope never borrows the active workspace's PR.
  const sessionBranch =
    sessionContext?.worktreeBranchName ?? sessionContext?.branchName;
  const sessionRepoPath =
    sessionContext?.worktreePath ?? sessionContext?.repoPath;
  const sessionRepoId = sessionRepoPath === activeRepoPath ? repoId : undefined;
  const sessionStatus = useBranchPullRequestStatus({
    branchName: sessionBranch,
    repoPath: sessionRepoPath,
    repoId: sessionRepoId,
    includeClosed: true,
  });

  const sharesScope = Boolean(
    sessionRepoPath &&
    sessionRepoPath === activeRepoPath &&
    sessionBranch === activeBranchName
  );
  const workspaceStatus = useBranchPullRequestStatus({
    branchName: sharesScope ? undefined : activeBranchName,
    repoId,
    repoPath: sharesScope ? undefined : activeRepoPath,
  });
  const branchCompareUrl = sharesScope
    ? sessionStatus.compareUrl
    : workspaceStatus.compareUrl;

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
    ],
    [t, repoId, activeRepoPath, branchCompareUrl]
  );

  const pullRequestItems = useMemo<FocusedChatRailItem[]>(() => {
    const { pr, ciStatus, error, loading, refresh } = sessionStatus;
    const items: FocusedChatRailItem[] = [];
    if (pr && sessionRepoPath && sessionBranch) {
      const lifecycle =
        pr.state.toLowerCase() === "open" && pr.draft
          ? "draft"
          : pr.state.toLowerCase();
      const glyph =
        lifecycle === "merged"
          ? GitMergeIcon
          : lifecycle === "closed"
            ? GitPullRequestClosedIcon
            : lifecycle === "draft"
              ? GitPullRequestDraftIcon
              : GitPullRequestIcon;
      const icon = ({
        size = 24,
      }: {
        size?: number;
        [key: string]: unknown;
      }) => (
        <HugeiconsIcon
          icon={glyph}
          size={size}
          className={getPrStatusVariant(lifecycle).textClass}
        />
      );
      const label = pr.title || `#${pr.number}`;
      const ciLabel = ciStatus
        ? t(
            `common:git.pr.checks.${ciStatus === "success" ? "passed" : ciStatus === "failure" ? "failed" : ciStatus === "pending" ? "running" : ciStatus}Short`
          )
        : undefined;
      items.push({
        key: `pull-request:${pr.url}`,
        label,
        icon,
        title: `#${pr.number} ${label} · ${t(`common:${getPrStatusLabelKey(lifecycle)}`)}`,
        ...(pr.state.toLowerCase() === "open" && ciStatus && ciLabel
          ? {
              status: {
                state: ciStatus,
                label: ciLabel,
                title: t("common:git.pr.checks.branchStatus", {
                  number: pr.number,
                  status: ciLabel,
                }),
                iconOnly: true,
              },
            }
          : {}),
        onClick: () =>
          openPullRequest({
            prNumber: pr.number,
            prTitle: label,
            prUrl: pr.url,
            prStatus: lifecycle,
            headBranch: sessionBranch,
            repoPath: sessionRepoPath,
            repoId: sessionRepoId,
          }),
      });
    }
    if (error)
      items.push({
        key: "pull-request-retry",
        title: t("common:labels.failedToLoadPullRequest"),
        label: t("common:actions.retry"),
        icon: Refresh04Icon,
        onClick: refresh,
      });
    else if (loading && !pr)
      items.push({
        key: "pull-request-loading",
        label: t("common:actions.loading"),
        icon: Loading03Icon,
      });
    return items;
  }, [
    sessionStatus,
    sessionRepoPath,
    sessionBranch,
    sessionRepoId,
    t,
    openPullRequest,
  ]);

  return {
    activeBranchName,
    sessionItems: [],
    workspaceItems,
    pullRequestItems,
  };
}

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
import {
  canonicalPullRequestUrl,
  useSessionPullRequests,
} from "./useSessionPullRequests";

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
  const attached = useSessionPullRequests(
    sessionContext?.sessionId,
    sessionContext?.updatedAt
  );
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
    const linked = attached.items.map((item) => ({ ...item, attached: true }));
    const branchUrl = pr ? canonicalPullRequestUrl(pr.url) : null;
    if (
      pr &&
      sessionRepoPath &&
      sessionBranch &&
      !linked.some((item) => item.url === branchUrl)
    ) {
      linked.push({
        ...pr,
        title: pr.title || `#${pr.number}`,
        draft: pr.draft === true,
        url: branchUrl ?? pr.url,
        repoFullName: sessionStatus.repoFullName ?? "",
        headBranch: sessionBranch,
        ciStatus,
        error: false,
        attached: false,
      });
    }
    for (const linkedPr of linked) {
      const pr = linkedPr;
      const ciStatus = linkedPr.ciStatus;
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
        title: `${label === `#${pr.number}` ? label : `#${pr.number} ${label}`} · ${t(`common:${getPrStatusLabelKey(lifecycle)}`)}`,
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
        onClick: () => {
          const nativeRepo =
            sessionRepoPath &&
            (!linkedPr.attached ||
              (sessionStatus.repoFullName &&
                linkedPr.repoFullName.toLowerCase() ===
                  sessionStatus.repoFullName.toLowerCase()));
          if (!nativeRepo) {
            openLink(pr.url);
            return;
          }
          openPullRequest({
            prNumber: pr.number,
            prTitle: label,
            prUrl: pr.url,
            prStatus: lifecycle,
            headBranch: linkedPr.headBranch,
            repoPath: sessionRepoPath!,
            repoId: sessionRepoId,
          });
        },
      });
      if (linkedPr.error)
        items.push({
          key: `pull-request-retry:${pr.url}`,
          label: `${t("common:actions.retry")} #${pr.number}`,
          title: t("common:labels.failedToLoadPullRequest"),
          icon: Refresh04Icon,
          onClick: () => attached.refresh(pr.url),
        });
    }
    if (error || attached.error)
      items.push({
        key: "pull-request-retry",
        title: t("common:labels.failedToLoadPullRequest"),
        label: t("common:actions.retry"),
        icon: Refresh04Icon,
        onClick: () => {
          refresh();
          attached.refresh();
        },
      });
    else if ((loading || attached.loading) && items.length === 0)
      items.push({
        key: "pull-request-loading",
        label: t("common:actions.loading"),
        icon: Loading03Icon,
      });
    return items;
  }, [
    sessionStatus,
    attached,
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

import type { ReactNode } from "react";

import AnyIcon from "@src/components/AnyIcon";
import Avatar from "@src/components/Avatar";
import { ListPanelItem } from "@src/components/ListPanel";
import { compactRepositoryLabel } from "@src/features/GitHubWork/githubRepositoryLabel";
import {
  GitMergeIcon,
  GitPullRequestClosedIcon,
  GitPullRequestDraftIcon,
  GitPullRequestIcon,
  type IconSvgElement,
} from "@src/icons";
import {
  type ManagedPrItem,
  getManagedPullRequestKey,
} from "@src/modules/MainApp/WorkManagement/githubManagedItemModel";
import {
  type PrStatusIconName,
  getPrStatusIconName,
  getPrStatusVariant,
  normalizePrStatus,
} from "@src/util/git/pr/prStatus";

const PULL_REQUEST_ICONS: Record<PrStatusIconName, IconSvgElement> = {
  "pull-request": GitPullRequestIcon,
  merge: GitMergeIcon,
  closed: GitPullRequestClosedIcon,
  draft: GitPullRequestDraftIcon,
};

export function TeamInboxPullRequestRows({
  pullRequests,
  selectedPullRequestKey,
  onSelectPullRequest,
}: {
  pullRequests: ManagedPrItem[];
  selectedPullRequestKey: string | null;
  onSelectPullRequest?: (pullRequest: ManagedPrItem) => void;
}): ReactNode {
  return pullRequests.map((pullRequest) => {
    const key = getManagedPullRequestKey(pullRequest);
    const status = normalizePrStatus({
      state: pullRequest.state,
      merged: pullRequest.state === "merged",
      draft: pullRequest.rawPr.draft,
    });
    const PullRequestIcon = PULL_REQUEST_ICONS[getPrStatusIconName(status)];
    const statusIconClass = getPrStatusVariant(status).textClass;
    return (
      <ListPanelItem
        key={key}
        id={key}
        selected={selectedPullRequestKey === key}
        title={pullRequest.title}
        titlePrefix={`#${pullRequest.id}`}
        time={pullRequest.timeAgo}
        metadata={
          <>
            <Avatar
              size={16}
              src={pullRequest.rawPr.author_avatar_url ?? undefined}
              hideOnError
            />
            <span className="truncate">
              {compactRepositoryLabel(pullRequest.repo)} ·{" "}
              {pullRequest.sourceBranch}
            </span>
          </>
        }
        leading={<AnyIcon icon={PullRequestIcon} size={14} strokeWidth={1.8} />}
        leadingClassName={statusIconClass}
        ariaLabel={`${pullRequest.title}, #${pullRequest.id}, ${pullRequest.author}, ${pullRequest.repo}`}
        ariaCurrent={selectedPullRequestKey === key ? "true" : undefined}
        dataAttributes={{
          "data-team-inbox-list-item": true,
          "data-testid": "team-inbox-pr-row",
          "data-pr-number": pullRequest.id,
        }}
        onClick={() => onSelectPullRequest?.(pullRequest)}
      />
    );
  });
}

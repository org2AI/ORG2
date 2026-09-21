import React from "react";
import { useTranslation } from "react-i18next";

import DetailHeaderIconAction from "@src/components/DetailHeaderIconAction";
import { HEADER_ICON_SIZE } from "@src/config/workstation/tokens";
import GitHubDetailSkeleton from "@src/features/GitHubWork/GitHubDetailSkeleton";
import GitHubPrDetailTabs from "@src/features/GitHubWork/GitHubPrDetailTabs";
import { useGitHubIssueDetailState } from "@src/features/GitHubWork/useGitHubIssueDetailState";
import { HugeiconsIcon, LinkSquare02Icon } from "@src/icons";
import {
  IssueDetailPanel,
  IssueDetailTabs,
} from "@src/modules/WorkStation/CodeEditor/Panels/EditorPrimarySidebar/content/IssuesContent/IssueDetailPanel";
import { ExternalBrowserButton } from "@src/modules/WorkStation/shared/ExternalBrowserButton";
import DetailPaneLayout, {
  DetailPaneCloseAction,
  DetailPanePlaceholder,
} from "@src/scaffold/layouts/DetailPaneLayout";
import { workstationIssueDetailScopeKey } from "@src/store/workstation/codeEditor/workstationIssueAtom";
import type { PrIdentity } from "@src/store/workstation/codeEditor/workstationSelectedPrAtom";
import { normalizePrStatus } from "@src/util/git/pr/prStatus";

import {
  GITHUB_ITEM_KIND,
  type ManagedGitHubItem,
  type ManagedIssueItem,
  type ManagedPrItem,
} from "./githubManagedItemModel";

const PullRequestDetailPanel = React.lazy(() =>
  import("@src/modules/WorkStation/CodeEditor/Panels/EditorPrimarySidebar/content/PullRequestContent/detail/PrDetailPanel").then(
    (module) => ({ default: module.PrDetailPanel })
  )
);

interface GitHubWorkItemDetailPaneProps {
  selectedItem: ManagedGitHubItem | null;
  onOpenIssueInNewTab: (issue: ManagedIssueItem) => void;
  onOpenPrInNewTab: (pullRequest: ManagedPrItem) => void;
  onClose: () => void;
}

function OpenInNewTabAction({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation("common");
  return (
    <DetailHeaderIconAction
      label={t("actions.openInNewTab")}
      icon={
        <HugeiconsIcon
          icon={LinkSquare02Icon}
          data-icon="link-square-02"
          size={HEADER_ICON_SIZE.sm}
          strokeWidth={1.75}
          aria-hidden
        />
      }
      onClick={onClick}
      testId="work-management-open-in-new-tab"
    />
  );
}

function DetailActions({
  href,
  onOpenInNewTab,
  onClose,
}: {
  href: string;
  onOpenInNewTab: () => void;
  onClose: () => void;
}) {
  return (
    <div
      className="flex shrink-0 items-center gap-px"
      data-testid="work-management-detail-actions"
    >
      <ExternalBrowserButton
        href={href}
        dataTestId="work-management-open-in-browser"
      />
      <OpenInNewTabAction onClick={onOpenInNewTab} />
      <DetailPaneCloseAction
        onClose={onClose}
        testId="work-management-close-detail"
      />
    </div>
  );
}

function IssueDetail({
  item,
  onOpenInNewTab,
  onClose,
}: {
  item: ManagedIssueItem;
  onOpenInNewTab: () => void;
  onClose: () => void;
}) {
  const stateScopeKey = workstationIssueDetailScopeKey(item.repoPath, item.id);
  const { selectedState, interaction, assigneeConfig } =
    useGitHubIssueDetailState({
      issueNumber: item.id,
      repoPath: item.repoPath,
      remoteUrl: item.remoteUrl,
      stateScopeKey,
      authScope: item.authScope ?? undefined,
      viewerLogin: item.viewerLogin,
      repoPermissions: item.repoPermissions,
    });
  const issue = selectedState.issue;
  const detailIssue = issue ?? item.rawIssue;
  const actions = (
    <DetailActions
      href={detailIssue.html_url}
      onOpenInNewTab={onOpenInNewTab}
      onClose={onClose}
    />
  );

  return (
    <DetailPaneLayout testId="work-management-github-issue-detail-pane">
      {selectedState.error && !issue ? (
        <div className="flex h-full min-h-0 flex-col overflow-hidden">
          <IssueDetailTabs
            activeTab="conversation"
            conversationCount={detailIssue.comments}
            linkedCountLoading
            trailing={actions}
          />
          <DetailPanePlaceholder
            variant="error"
            subtitle={selectedState.error}
          />
        </div>
      ) : !issue || selectedState.loading ? (
        <GitHubDetailSkeleton
          kind="issue"
          showHeader={false}
          title={detailIssue.title}
          number={detailIssue.number}
          tabs={
            <IssueDetailTabs
              activeTab="conversation"
              conversationCount={detailIssue.comments}
              linkedCountLoading
              trailing={actions}
            />
          }
        />
      ) : (
        <IssueDetailPanel
          issue={issue}
          timeline={selectedState.timeline}
          timelineLoading={selectedState.timelineLoading}
          interaction={interaction}
          tabActions={actions}
          assigneeConfig={assigneeConfig}
        />
      )}
    </DetailPaneLayout>
  );
}

function PullRequestDetail({
  item,
  onOpenInNewTab,
  onClose,
}: {
  item: ManagedPrItem;
  onOpenInNewTab: () => void;
  onClose: () => void;
}) {
  const identity: PrIdentity = {
    number: item.id,
    title: item.title,
    url: item.rawPr.url,
    status: normalizePrStatus({
      state: item.state,
      merged: item.state === "merged",
      draft: item.rawPr.draft,
    }),
    headBranch: item.sourceBranch,
    baseBranch: item.targetBranch,
  };
  const actions = (
    <DetailActions
      href={identity.url}
      onOpenInNewTab={onOpenInNewTab}
      onClose={onClose}
    />
  );

  return (
    <DetailPaneLayout testId="work-management-github-pr-detail-pane">
      <React.Suspense
        fallback={
          <GitHubDetailSkeleton
            kind="pr"
            showHeader={false}
            title={identity.title}
            number={identity.number}
            tabs={<GitHubPrDetailTabs trailing={actions} />}
          />
        }
      >
        <PullRequestDetailPanel
          identity={identity}
          repoPath={item.repoPath}
          repoId={item.repoId}
          tabActions={actions}
        />
      </React.Suspense>
    </DetailPaneLayout>
  );
}

const GitHubWorkItemDetailPane: React.FC<GitHubWorkItemDetailPaneProps> = ({
  selectedItem,
  onOpenIssueInNewTab,
  onOpenPrInNewTab,
  onClose,
}) => {
  const { t } = useTranslation("common");
  if (!selectedItem) {
    return (
      <DetailPaneLayout>
        <DetailPanePlaceholder
          variant="empty"
          title={t("teamInbox.empty.selectTitle")}
          subtitle={t("teamInbox.empty.selectSubtitle")}
        />
      </DetailPaneLayout>
    );
  }

  if (selectedItem.kind === GITHUB_ITEM_KIND.ISSUE) {
    return (
      <IssueDetail
        key={`${selectedItem.repoPath}:${selectedItem.id}`}
        item={selectedItem}
        onOpenInNewTab={() => onOpenIssueInNewTab(selectedItem)}
        onClose={onClose}
      />
    );
  }

  return (
    <PullRequestDetail
      key={`${selectedItem.repoPath}:${selectedItem.id}`}
      item={selectedItem}
      onOpenInNewTab={() => onOpenPrInNewTab(selectedItem)}
      onClose={onClose}
    />
  );
};

export default GitHubWorkItemDetailPane;

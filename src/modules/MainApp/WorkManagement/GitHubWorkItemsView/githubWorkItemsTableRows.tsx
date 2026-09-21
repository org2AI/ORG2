import type { TFunction } from "i18next";
import type { ReactNode } from "react";

import PrCiStatusIndicator from "@src/components/PrCiStatusIndicator";
import type { WorkManagementTableRow } from "@src/features/GitHubWork/WorkManagementTable";
import { compactRepositoryLabel } from "@src/features/GitHubWork/githubRepositoryLabel";
import {
  CheckmarkCircle01Icon,
  CircleDotIcon,
  CircleSlashIcon,
  Copy01Icon,
  GitMergeIcon,
  GitPullRequestDraftIcon,
  HugeiconsIcon,
} from "@src/icons";

import {
  ManagedIssueActionsCell,
  ManagedIssueAssigneeCell,
  ManagedIssueContextMeta,
  ManagedPrActionsCell,
} from "../GitHubWorkItemControls";
import {
  type ManagedGitHubItem,
  type ManagedIssueItem,
  type ManagedPrItem,
  getManagedGitHubItemKey,
} from "../githubManagedItemModel";
import {
  canManageIssueAssignees,
  canManageIssueStatus,
  canManagePrStatus,
} from "../githubWorkItemPermissions";
import { GITHUB_QUERY_STATE } from "../githubWorkItemsSearchQuery";
import type { GitHubRepoSource } from "../githubWorkItemsTypes";
import type { IssueAssigneeControlState } from "../useGitHubIssueAssigneeMutations";
import type {
  ManagedIssueStatusValue,
  ManagedPrStatusValue,
} from "../useGitHubWorkItemStatusMutations";

export function getManagedIssueStatusAccent(status: ManagedIssueStatusValue): {
  iconColor: string;
  valueClassName: string;
} {
  if (status === "open") {
    return {
      iconColor: "var(--color-success-6)",
      valueClassName: "text-success-6",
    };
  }
  if (status === "closed_completed") {
    return {
      iconColor: "var(--color-purple-6)",
      valueClassName: "text-purple-6",
    };
  }
  return {
    iconColor: "var(--color-text-3)",
    valueClassName: "text-text-2",
  };
}

export function buildManagedPrTableRow({
  item,
  source,
  updated,
  t,
  readonlyReason,
  onPrStatusChange,
  onAddPr,
  onSelectItem,
}: {
  item: ManagedPrItem;
  source: GitHubRepoSource | undefined;
  updated: ReactNode;
  t: TFunction;
  readonlyReason: string;
  onPrStatusChange: (
    pr: ManagedPrItem,
    status: ManagedPrStatusValue
  ) => Promise<void>;
  onAddPr: (pr: ManagedPrItem) => void;
  onSelectItem: (item: ManagedGitHubItem) => void;
}): WorkManagementTableRow {
  const prStatusValue: ManagedPrStatusValue =
    item.state === GITHUB_QUERY_STATE.OPEN ? "open" : "closed";
  const prStatusLabel =
    item.state === GITHUB_QUERY_STATE.MERGED
      ? t("common:labels.prStatus.merged")
      : item.rawPr.draft
        ? t("common:labels.prStatus.draft")
        : prStatusValue === "open"
          ? t("chat.panels.manageIssues.stateOpen")
          : t("chat.panels.manageIssues.stateClosed");
  const prStatusIcon =
    item.state === GITHUB_QUERY_STATE.MERGED ? (
      <HugeiconsIcon
        icon={GitMergeIcon}
        data-icon="git-merge"
        size={14}
        strokeWidth={1.8}
      />
    ) : item.rawPr.draft ? (
      <HugeiconsIcon
        icon={GitPullRequestDraftIcon}
        data-icon="git-pull-request-draft"
        size={14}
        strokeWidth={1.8}
      />
    ) : prStatusValue === "open" ? (
      <HugeiconsIcon
        icon={CircleDotIcon}
        data-icon="circle-dot"
        size={14}
        strokeWidth={1.8}
      />
    ) : (
      <HugeiconsIcon
        icon={CheckmarkCircle01Icon}
        data-icon="check-circle-2"
        size={14}
        strokeWidth={1.8}
      />
    );
  const prCiLabel =
    item.rawPr.ci_status === "success"
      ? t("common:git.pr.checks.passedShort")
      : item.rawPr.ci_status === "failure"
        ? t("common:git.pr.checks.failedShort")
        : item.rawPr.ci_status === "pending"
          ? t("common:git.pr.checks.runningShort")
          : item.rawPr.ci_status === "none"
            ? t("common:git.pr.checks.noneShort")
            : t("common:git.pr.checks.unavailableShort");
  return {
    key: getManagedGitHubItemKey(item),
    id: `#${item.id}`,
    idSortValue: item.id,
    title: item.title,
    titleLinkOnRowHover: true,
    metadata: [
      compactRepositoryLabel(item.repo),
      item.author,
      `${item.sourceBranch} → ${item.targetBranch}`,
    ],
    fillLastMetadata: true,
    statusSelect: {
      value: prStatusValue,
      label: prStatusLabel,
      icon: prStatusIcon,
      iconColor:
        item.state === GITHUB_QUERY_STATE.MERGED
          ? "var(--color-purple-6)"
          : item.rawPr.draft
            ? "var(--color-text-2)"
            : prStatusValue === "open"
              ? "var(--color-success-6)"
              : "var(--color-text-3)",
      valueClassName:
        item.state === GITHUB_QUERY_STATE.MERGED
          ? "text-purple-6"
          : item.rawPr.draft
            ? "text-text-2"
            : prStatusValue === "open"
              ? "text-success-6"
              : "text-text-2",
      options: [
        {
          value: "open",
          label: t("chat.panels.manageIssues.stateOpen"),
          icon: (
            <HugeiconsIcon
              icon={CircleDotIcon}
              data-icon="circle-dot"
              size={14}
              strokeWidth={1.8}
            />
          ),
          iconColor: "var(--color-success-6)",
        },
        {
          value: "closed",
          label: t("chat.panels.manageIssues.stateClosed"),
          icon: (
            <HugeiconsIcon
              icon={CheckmarkCircle01Icon}
              data-icon="check-circle-2"
              size={14}
              strokeWidth={1.8}
            />
          ),
          iconColor: "var(--color-text-3)",
        },
      ],
      onChange: (value) =>
        onPrStatusChange(item, value as ManagedPrStatusValue),
      readonly:
        item.state === GITHUB_QUERY_STATE.MERGED ||
        !canManagePrStatus(item, source),
      readonlyReason,
      dataTestId: `github-pr-status-${item.id}`,
    },
    ciStatus: (
      <PrCiStatusIndicator
        status={item.rawPr.ci_status}
        label={prCiLabel}
        dataTestId={`github-pr-ci-${item.id}`}
      />
    ),
    updated,
    actions: (
      <ManagedPrActionsCell
        pr={item}
        addLabel={t("chat.panels.manageIssues.addToChat")}
        onAddPr={onAddPr}
      />
    ),
    onClick: () => onSelectItem(item),
  };
}

export function buildManagedIssueTableRow({
  item,
  source,
  updated,
  t,
  readonlyReason,
  getIssueAssigneeControlState,
  onLoadIssueAssignees,
  onIssueAssigneesChange,
  onIssueStatusChange,
  onOpenIssueInBrowser,
  onAddIssue,
  onSelectItem,
}: {
  item: ManagedIssueItem;
  source: GitHubRepoSource | undefined;
  updated: ReactNode;
  t: TFunction;
  readonlyReason: string;
  getIssueAssigneeControlState: (
    issue: ManagedIssueItem
  ) => IssueAssigneeControlState;
  onLoadIssueAssignees: (issue: ManagedIssueItem) => void | Promise<void>;
  onIssueAssigneesChange: (
    issue: ManagedIssueItem,
    assignees: string[]
  ) => void | Promise<void>;
  onIssueStatusChange: (
    issue: ManagedIssueItem,
    status: ManagedIssueStatusValue
  ) => Promise<void>;
  onOpenIssueInBrowser: (issue: ManagedIssueItem) => void;
  onAddIssue: (issue: ManagedIssueItem) => void;
  onSelectItem: (item: ManagedGitHubItem) => void;
}): WorkManagementTableRow {
  const issueStatusValue: ManagedIssueStatusValue =
    item.state === "open"
      ? "open"
      : item.rawIssue.state_reason === "duplicate"
        ? "closed_duplicate"
        : item.rawIssue.state_reason === "not_planned"
          ? "closed_not_planned"
          : "closed_completed";
  const issueStatusAccent = getManagedIssueStatusAccent(issueStatusValue);
  const issueStatusOptions = [
    {
      value: "open",
      label: t("chat.panels.manageIssues.stateOpen"),
      icon: (
        <HugeiconsIcon
          icon={CircleDotIcon}
          data-icon="circle-dot"
          size={14}
          strokeWidth={1.8}
        />
      ),
      iconColor: getManagedIssueStatusAccent("open").iconColor,
    },
    {
      value: "closed_completed",
      label: t("chat.panels.manageIssues.closeAsCompleted", {
        defaultValue: "Close as completed",
      }),
      icon: (
        <HugeiconsIcon
          icon={CheckmarkCircle01Icon}
          data-icon="check-circle-2"
          size={14}
          strokeWidth={1.8}
        />
      ),
      iconColor: getManagedIssueStatusAccent("closed_completed").iconColor,
    },
    {
      value: "closed_not_planned",
      label: t("chat.panels.manageIssues.closeAsNotPlanned", {
        defaultValue: "Close as not planned",
      }),
      icon: (
        <HugeiconsIcon
          icon={CircleSlashIcon}
          data-icon="circle-slash"
          size={14}
          strokeWidth={1.8}
        />
      ),
      iconColor: "var(--color-text-3)",
    },
    ...(issueStatusValue === "closed_duplicate"
      ? [
          {
            value: "closed_duplicate" as const,
            label: t("common:git.issues.composer.closeAsDuplicate"),
            icon: (
              <HugeiconsIcon
                icon={Copy01Icon}
                data-icon="copy"
                size={14}
                strokeWidth={1.8}
              />
            ),
            iconColor: "var(--color-text-3)",
          },
        ]
      : []),
  ];
  const selectedIssueStatus = issueStatusOptions.find(
    (option) => option.value === issueStatusValue
  )!;
  const assigneeControl = getIssueAssigneeControlState(item);
  return {
    key: getManagedGitHubItemKey(item),
    id: `#${item.id}`,
    idSortValue: item.id,
    title: item.title,
    titleLinkOnRowHover: true,
    contextLeading: <ManagedIssueContextMeta issue={item} />,
    metadata: [compactRepositoryLabel(item.repo), item.author],
    tags: item.labels.map((label) => label.name),
    assignee: (
      <ManagedIssueAssigneeCell
        issue={item}
        assignableUsers={assigneeControl.users}
        canManage={canManageIssueAssignees(source)}
        loading={assigneeControl.loading}
        loadError={assigneeControl.error}
        updating={assigneeControl.updating}
        noneLabel={t("common:common.none")}
        loadingLabel={t("common:status.loading")}
        searchPlaceholder={t("common:common.searchPlaceholder")}
        readonlyReason={readonlyReason}
        onOpen={onLoadIssueAssignees}
        onChange={onIssueAssigneesChange}
      />
    ),
    statusSelect: {
      value: issueStatusValue,
      label:
        item.state === "open"
          ? t("chat.panels.manageIssues.stateOpen")
          : t("chat.panels.manageIssues.stateClosed"),
      icon: selectedIssueStatus.icon,
      iconColor: selectedIssueStatus.iconColor,
      valueClassName: issueStatusAccent.valueClassName,
      options: issueStatusOptions,
      onChange: (value) =>
        onIssueStatusChange(item, value as ManagedIssueStatusValue),
      readonly: !canManageIssueStatus(item, source),
      readonlyReason,
      dataTestId: `github-issue-status-${item.id}`,
    },
    updated,
    actions: (
      <ManagedIssueActionsCell
        issue={item}
        addLabel={t("chat.panels.manageIssues.addToChat")}
        openInBrowserLabel={t("common:previews.openInBrowser")}
        moreActionsLabel={t("common:tooltips.moreActions")}
        onOpenIssueInBrowser={onOpenIssueInBrowser}
        onAddIssue={onAddIssue}
      />
    ),
    onClick: () => onSelectItem(item),
  };
}

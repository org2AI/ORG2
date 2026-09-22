import React, { useCallback, useState } from "react";

import type { GitHubIssueUser } from "@src/api/tauri/github";
import Button from "@src/components/Button";
import Dropdown from "@src/components/Dropdown";
import { DROPDOWN_CLASSES } from "@src/components/Dropdown/tokens";
import {
  WorkManagementAssigneeCell,
  toggleWorkManagementAssigneeIds,
} from "@src/features/GitHubWork/WorkManagementAssigneeCell";
import {
  BubbleChatIcon,
  GitPullRequestIcon,
  HugeiconsIcon,
  Link02Icon,
  MoreHorizontalIcon,
} from "@src/icons";

import {
  type ManagedIssueItem,
  type ManagedPrItem,
} from "./githubManagedItemModel";

export function ManagedIssueContextMeta({
  issue,
}: {
  issue: ManagedIssueItem;
}): React.ReactNode {
  return (
    <div className="flex shrink-0 items-center gap-2 text-[11px] text-text-1">
      {issue.linkedPullRequests > 0 ? (
        <span className="flex items-center gap-1">
          <HugeiconsIcon
            icon={GitPullRequestIcon}
            data-icon="git-pull-request"
            size={12}
            strokeWidth={1.8}
          />
          {issue.linkedPullRequests}
        </span>
      ) : null}
      {issue.comments > 0 ? (
        <span className="flex items-center gap-1">
          <HugeiconsIcon
            icon={BubbleChatIcon}
            data-icon="message-circle"
            size={12}
            strokeWidth={1.8}
          />
          {issue.comments}
        </span>
      ) : null}
    </div>
  );
}

export function toggleIssueAssigneeLogins(
  assignees: GitHubIssueUser[],
  login: string
): string[] {
  return toggleWorkManagementAssigneeIds(
    assignees.map((assignee) => assignee.login),
    login
  );
}

export function ManagedIssueAssigneeCell({
  issue,
  assignableUsers,
  canManage,
  loading,
  loadError,
  updating,
  noneLabel,
  loadingLabel,
  searchPlaceholder,
  readonlyReason,
  onOpen,
  onChange,
}: {
  issue: ManagedIssueItem;
  assignableUsers: GitHubIssueUser[];
  canManage: boolean;
  loading: boolean;
  loadError: string | null;
  updating: boolean;
  noneLabel: string;
  loadingLabel: string;
  searchPlaceholder: string;
  readonlyReason: string;
  onOpen: (issue: ManagedIssueItem) => void | Promise<void>;
  onChange: (
    issue: ManagedIssueItem,
    assignees: string[]
  ) => void | Promise<void>;
}): React.ReactNode {
  const assignees = issue.rawIssue.assignees;
  return (
    <WorkManagementAssigneeCell
      currentAssigneeIds={assignees.map((assignee) => assignee.login)}
      options={[...assignees, ...assignableUsers].map((user) => ({
        id: user.login,
        label: user.login,
        avatar: user.avatar_url,
      }))}
      noneLabel={noneLabel}
      loadingLabel={loadingLabel}
      searchPlaceholder={searchPlaceholder}
      readonlyReason={readonlyReason}
      loading={loading}
      error={loadError}
      disabled={!canManage}
      interactionDisabled={updating}
      multiple
      dataTestId={`github-issue-assignee-${issue.id}`}
      onOpen={() => onOpen(issue)}
      onChangeAssigneeIds={(assigneeIds) => onChange(issue, assigneeIds)}
    />
  );
}

export function ManagedIssueActionsCell({
  issue,
  addLabel,
  openInBrowserLabel,
  moreActionsLabel,
  onOpenIssueInBrowser,
  onAddIssue,
}: {
  issue: ManagedIssueItem;
  addLabel: string;
  openInBrowserLabel: string;
  moreActionsLabel: string;
  onOpenIssueInBrowser: (issue: ManagedIssueItem) => void;
  onAddIssue: (issue: ManagedIssueItem) => void;
}): React.ReactNode {
  const [menuVisible, setMenuVisible] = useState(false);
  const closeMenu = useCallback(() => setMenuVisible(false), []);
  const droplist = (
    <div className={`${DROPDOWN_CLASSES.menuPanelBase} min-w-[180px]`}>
      <Button
        layout="custom"
        className={DROPDOWN_CLASSES.menuActionItem}
        onClick={() => {
          onOpenIssueInBrowser(issue);
          closeMenu();
        }}
      >
        <span className="min-w-0 flex-1 truncate">{openInBrowserLabel}</span>
      </Button>
    </div>
  );

  return (
    <div className="flex items-center justify-end gap-1.5">
      <Button
        variant="tertiary"
        size="mini"
        icon={<HugeiconsIcon icon={Link02Icon} data-icon="link-2" size={12} />}
        onClick={() => onAddIssue(issue)}
        aria-label={`${addLabel} #${issue.id}`}
      >
        {addLabel}
      </Button>
      <Dropdown
        droplist={droplist}
        trigger="click"
        position="bottom-end"
        popupVisible={menuVisible}
        onVisibleChange={setMenuVisible}
        getPopupContainer={() => document.body}
        avoidViewportOverflow
      >
        <Button
          variant="tertiary"
          size="mini"
          icon={
            <HugeiconsIcon
              icon={MoreHorizontalIcon}
              data-icon="ellipsis"
              size={13}
            />
          }
          iconOnly
          aria-label={moreActionsLabel}
          aria-expanded={menuVisible}
        />
      </Dropdown>
    </div>
  );
}

export function ManagedPrActionsCell({
  pr,
  addLabel,
  onAddPr,
}: {
  pr: ManagedPrItem;
  addLabel: string;
  onAddPr: (pr: ManagedPrItem) => void;
}): React.ReactNode {
  return (
    <div className="flex items-center justify-end gap-1.5">
      <Button
        variant="tertiary"
        size="mini"
        icon={<HugeiconsIcon icon={Link02Icon} data-icon="link-2" size={12} />}
        onClick={() => onAddPr(pr)}
        aria-label={`${addLabel} #${pr.id}`}
      >
        {addLabel}
      </Button>
    </div>
  );
}

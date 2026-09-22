import React from "react";
import { useTranslation } from "react-i18next";

import type {
  GitHubIssueTimelineItem,
  GitHubIssueTimelineSource,
  GitHubIssueUser,
} from "@src/api/tauri/github";
import Tag from "@src/components/Tag";
import { TYPOGRAPHY } from "@src/config/workstation/tokens";
import {
  ActivityTimestamp,
  TimelineEventCard,
} from "@src/features/GitHubWork/ActivityTimeline";
import {
  Activity01Icon,
  ArchiveArrowUpIcon,
  ArchiveIcon,
  ArrowLeftRightIcon,
  CheckmarkCircle01Icon,
  CircleDotIcon,
  Copy02Icon,
  CopyXIcon,
  Flag01Icon,
  GitCommitHorizontalIcon,
  GitCompareIcon,
  GitMergeIcon,
  GitPullRequestIcon,
  HugeiconsIcon,
  KanbanIcon,
  Link02Icon,
  LockIcon,
  Message01Icon,
  MessageMultiple01Icon,
  Notification01Icon,
  NotificationOff01Icon,
  Pen01Icon,
  PinIcon,
  PinOffIcon,
  RocketIcon,
  SecurityBlockIcon,
  SquareUnlock01Icon,
  Tag01Icon,
  Unlink02Icon,
  UserAdd01Icon,
  UserMinus01Icon,
  ViewIcon,
  WorkflowCircle05Icon,
} from "@src/icons";
import { getLabelColorStyle } from "@src/modules/WorkStation/CodeEditor/Panels/EditorPrimarySidebar/hooks/workstationIssueHelpers";
import { linkAnchorProps } from "@src/util/ui/openLink";

const EVENT_ICON_PROPS = { size: 13, strokeWidth: 1.8 } as const;

/** GitHub timeline events whose description comes from a key, not the raw id. */
const LOCALIZED_EVENT_DESCRIPTIONS: Record<string, string> = {
  comment_deleted: "commentDeleted",
  subscribed: "subscribed",
  unsubscribed: "unsubscribed",
  added_to_project: "addedToProject",
  moved_columns_in_project: "movedInProject",
  removed_from_project: "removedFromProject",
  archived: "archived",
  unarchived: "unarchived",
  merged: "merged",
  committed: "committed",
  head_ref_deleted: "headRefDeleted",
  head_ref_restored: "headRefRestored",
  head_ref_force_pushed: "headRefForcePushed",
  base_ref_changed: "baseRefChanged",
  automatic_base_change_failed: "automaticBaseChangeFailed",
  automatic_base_change_succeeded: "automaticBaseChangeSucceeded",
  deployed: "deployed",
  deployment_environment_changed: "deploymentEnvironmentChanged",
  ready_for_review: "readyForReview",
  review_requested: "reviewRequested",
  review_request_removed: "reviewRequestRemoved",
  reviewed: "reviewed",
  review_dismissed: "reviewDismissed",
  user_blocked: "userBlocked",
};

function humanizeEventName(event: string): string {
  return event.replace(/[_-]/g, " ");
}

function getSourceStateClassName(state: string): string {
  if (state === "open") return "text-success-6";
  if (state === "closed") return "text-purple-6";
  return "text-text-3";
}

function TimelineEventIcon({ event }: { event: string }): React.ReactNode {
  switch (event) {
    case "assigned":
      return (
        <HugeiconsIcon
          icon={UserAdd01Icon}
          data-icon="user-plus"
          {...EVENT_ICON_PROPS}
        />
      );
    case "unassigned":
      return (
        <HugeiconsIcon
          icon={UserMinus01Icon}
          data-icon="user-minus"
          {...EVENT_ICON_PROPS}
        />
      );
    case "labeled":
    case "unlabeled":
      return (
        <HugeiconsIcon
          icon={Tag01Icon}
          data-icon="tag-icon"
          {...EVENT_ICON_PROPS}
        />
      );
    case "milestoned":
    case "demilestoned":
      return (
        <HugeiconsIcon
          icon={Flag01Icon}
          data-icon="flag"
          {...EVENT_ICON_PROPS}
        />
      );
    case "closed":
      return (
        <HugeiconsIcon
          icon={CheckmarkCircle01Icon}
          data-icon="check-circle-2"
          {...EVENT_ICON_PROPS}
        />
      );
    case "reopened":
      return (
        <HugeiconsIcon
          icon={CircleDotIcon}
          data-icon="circle-dot"
          {...EVENT_ICON_PROPS}
        />
      );
    case "renamed":
      return (
        <HugeiconsIcon
          icon={Pen01Icon}
          data-icon="pencil"
          {...EVENT_ICON_PROPS}
        />
      );
    case "locked":
      return (
        <HugeiconsIcon icon={LockIcon} data-icon="lock" {...EVENT_ICON_PROPS} />
      );
    case "unlocked":
      return (
        <HugeiconsIcon
          icon={SquareUnlock01Icon}
          data-icon="unlock"
          {...EVENT_ICON_PROPS}
        />
      );
    case "cross-referenced":
      return (
        <HugeiconsIcon
          icon={GitPullRequestIcon}
          data-icon="git-pull-request"
          {...EVENT_ICON_PROPS}
        />
      );
    case "referenced":
      return (
        <HugeiconsIcon
          icon={GitCommitHorizontalIcon}
          data-icon="git-commit-horizontal"
          {...EVENT_ICON_PROPS}
        />
      );
    case "connected":
      return (
        <HugeiconsIcon
          icon={Link02Icon}
          data-icon="link-2"
          {...EVENT_ICON_PROPS}
        />
      );
    case "disconnected":
      return (
        <HugeiconsIcon
          icon={Unlink02Icon}
          data-icon="unlink-2"
          {...EVENT_ICON_PROPS}
        />
      );
    case "pinned":
      return (
        <HugeiconsIcon icon={PinIcon} data-icon="pin" {...EVENT_ICON_PROPS} />
      );
    case "unpinned":
      return (
        <HugeiconsIcon
          icon={PinOffIcon}
          data-icon="pin-off"
          {...EVENT_ICON_PROPS}
        />
      );
    case "mentioned":
    case "commented":
    case "comment_deleted":
      return (
        <HugeiconsIcon
          icon={Message01Icon}
          data-icon="message-square"
          {...EVENT_ICON_PROPS}
        />
      );
    case "marked_as_duplicate":
      return (
        <HugeiconsIcon
          icon={Copy02Icon}
          data-icon="copy-check"
          {...EVENT_ICON_PROPS}
        />
      );
    case "unmarked_as_duplicate":
      return (
        <HugeiconsIcon
          icon={CopyXIcon}
          data-icon="copy-x"
          {...EVENT_ICON_PROPS}
        />
      );
    case "transferred":
      return (
        <HugeiconsIcon
          icon={ArrowLeftRightIcon}
          data-icon="arrow-right-left"
          {...EVENT_ICON_PROPS}
        />
      );
    case "converted_to_discussion":
      return (
        <HugeiconsIcon
          icon={MessageMultiple01Icon}
          data-icon="messages-square"
          {...EVENT_ICON_PROPS}
        />
      );
    case "subscribed":
      return (
        <HugeiconsIcon
          icon={Notification01Icon}
          data-icon="bell"
          {...EVENT_ICON_PROPS}
        />
      );
    case "unsubscribed":
      return (
        <HugeiconsIcon
          icon={NotificationOff01Icon}
          data-icon="bell-off"
          {...EVENT_ICON_PROPS}
        />
      );
    case "added_to_project":
    case "moved_columns_in_project":
    case "removed_from_project":
      return (
        <HugeiconsIcon
          icon={KanbanIcon}
          data-icon="square-kanban"
          {...EVENT_ICON_PROPS}
        />
      );
    case "archived":
      return (
        <HugeiconsIcon
          icon={ArchiveIcon}
          data-icon="archive"
          {...EVENT_ICON_PROPS}
        />
      );
    case "unarchived":
      return (
        <HugeiconsIcon
          icon={ArchiveArrowUpIcon}
          data-icon="archive-restore"
          {...EVENT_ICON_PROPS}
        />
      );
    case "merged":
      return (
        <HugeiconsIcon
          icon={GitMergeIcon}
          data-icon="git-merge"
          {...EVENT_ICON_PROPS}
        />
      );
    case "committed":
      return (
        <HugeiconsIcon
          icon={GitCommitHorizontalIcon}
          data-icon="git-commit-horizontal"
          {...EVENT_ICON_PROPS}
        />
      );
    case "head_ref_deleted":
    case "head_ref_restored":
    case "head_ref_force_pushed":
      return (
        <HugeiconsIcon
          icon={WorkflowCircle05Icon}
          data-icon="git-branch"
          {...EVENT_ICON_PROPS}
        />
      );
    case "base_ref_changed":
    case "automatic_base_change_failed":
    case "automatic_base_change_succeeded":
      return (
        <HugeiconsIcon
          icon={GitCompareIcon}
          data-icon="git-compare-arrows"
          {...EVENT_ICON_PROPS}
        />
      );
    case "deployed":
    case "deployment_environment_changed":
      return (
        <HugeiconsIcon
          icon={RocketIcon}
          data-icon="rocket"
          {...EVENT_ICON_PROPS}
        />
      );
    case "ready_for_review":
    case "review_requested":
    case "review_request_removed":
    case "reviewed":
    case "review_dismissed":
      return (
        <HugeiconsIcon icon={ViewIcon} data-icon="eye" {...EVENT_ICON_PROPS} />
      );
    case "user_blocked":
      return (
        <HugeiconsIcon
          icon={SecurityBlockIcon}
          data-icon="shield-ban"
          {...EVENT_ICON_PROPS}
        />
      );
    default:
      return (
        <HugeiconsIcon
          icon={Activity01Icon}
          data-icon="activity"
          {...EVENT_ICON_PROPS}
        />
      );
  }
}

function TimelineUser({ login }: { login: string }): React.ReactNode {
  return (
    <span className="font-medium whitespace-nowrap text-text-1">{login}</span>
  );
}

function CrossReferenceLink({
  source,
}: {
  source: GitHubIssueTimelineSource;
}): React.ReactNode {
  return (
    <a
      {...linkAnchorProps(source.html_url)}
      className="inline-flex max-w-full min-w-0 items-center gap-1 overflow-hidden align-middle font-medium text-primary-6 hover:underline"
      title={source.title}
    >
      {source.is_pull_request ? (
        <HugeiconsIcon
          icon={GitPullRequestIcon}
          data-icon="git-pull-request"
          size={12}
          strokeWidth={1.8}
          className={`shrink-0 ${getSourceStateClassName(source.state)}`}
        />
      ) : (
        <HugeiconsIcon
          icon={CircleDotIcon}
          data-icon="circle-dot"
          size={12}
          strokeWidth={1.8}
          className={`shrink-0 ${getSourceStateClassName(source.state)}`}
        />
      )}
      <span className="shrink-0">#{source.number}</span>
      <span className="min-w-0 truncate">{source.title}</span>
    </a>
  );
}

export function IssueTimelineEventDescription({
  item,
}: {
  item: GitHubIssueTimelineItem;
}): React.ReactNode {
  const { t } = useTranslation("common");

  switch (item.event) {
    case "assigned":
      return item.assignee ? (
        <>
          {t("git.issues.activity.assigned")}{" "}
          <TimelineUser login={item.assignee.login} />
        </>
      ) : (
        <>{t("git.issues.activity.assignedIssue")}</>
      );
    case "unassigned":
      return item.assignee ? (
        <>
          {t("git.issues.activity.unassigned")}{" "}
          <TimelineUser login={item.assignee.login} />
        </>
      ) : (
        <>{t("git.issues.activity.removedAssignee")}</>
      );
    case "labeled":
    case "unlabeled":
      return (
        <>
          {item.event === "labeled"
            ? t("git.issues.activity.added")
            : t("git.issues.activity.removed")}{" "}
          {item.label ? (
            <Tag
              size="mini"
              pill
              className={`${TYPOGRAPHY.badge} px-1.5! py-px! align-middle text-[10px]! leading-3!`}
              style={getLabelColorStyle(item.label.color)}
            >
              {item.label.name}
            </Tag>
          ) : (
            t("git.issues.activity.label")
          )}
        </>
      );
    case "milestoned":
      return (
        <>
          {t("git.issues.activity.milestoned", {
            milestone: item.milestone ?? "",
          })}
        </>
      );
    case "demilestoned":
      return (
        <>
          {t("git.issues.activity.demilestoned", {
            milestone: item.milestone ?? "",
          })}
        </>
      );
    case "closed":
      return item.commit_id ? (
        <>
          {t("git.issues.activity.closedViaCommit", {
            commit: item.commit_id.slice(0, 7),
          })}
        </>
      ) : (
        <>{t("git.issues.activity.closed")}</>
      );
    case "reopened":
      return <>{t("git.issues.activity.reopened")}</>;
    case "renamed":
      return item.rename ? (
        <>
          {t("git.issues.activity.renamedTo")} <q>{item.rename.to}</q>
        </>
      ) : (
        <>{t("git.issues.activity.renamed")}</>
      );
    case "locked":
      return item.lock_reason ? (
        <>
          {t("git.issues.activity.lockedAs", {
            reason: item.lock_reason,
          })}
        </>
      ) : (
        <>{t("git.issues.activity.locked")}</>
      );
    case "unlocked":
      return <>{t("git.issues.activity.unlocked")}</>;
    case "cross-referenced":
      return item.source ? (
        <>
          {t("git.issues.activity.crossReferencedFrom")}{" "}
          <CrossReferenceLink source={item.source} />
        </>
      ) : (
        <>{t("git.issues.activity.crossReferenced")}</>
      );
    case "referenced":
      return item.commit_id ? (
        <>
          {t("git.issues.activity.referencedInCommit", {
            commit: item.commit_id.slice(0, 7),
          })}
        </>
      ) : (
        <>{t("git.issues.activity.referencedInACommit")}</>
      );
    case "connected":
      return <>{t("git.issues.activity.connected")}</>;
    case "disconnected":
      return <>{t("git.issues.activity.disconnected")}</>;
    case "marked_as_duplicate":
      return <>{t("git.issues.activity.markedAsDuplicate")}</>;
    case "unmarked_as_duplicate":
      return <>{t("git.issues.activity.unmarkedAsDuplicate")}</>;
    case "pinned":
      return <>{t("git.issues.activity.pinned")}</>;
    case "unpinned":
      return <>{t("git.issues.activity.unpinned")}</>;
    case "transferred":
      return <>{t("git.issues.activity.transferred")}</>;
    case "converted_to_discussion":
      return <>{t("git.issues.activity.convertedToDiscussion")}</>;
    case "mentioned":
      return <>{t("git.issues.activity.mentioned")}</>;
    default: {
      const localizedEvent = LOCALIZED_EVENT_DESCRIPTIONS[item.event];
      if (localizedEvent) {
        return <>{t(`git.issues.activity.${localizedEvent}`)}</>;
      }
      return <>{humanizeEventName(item.event)}</>;
    }
  }
}

export function IssueTimelineEventRow({
  item,
}: {
  item: GitHubIssueTimelineItem;
}): React.ReactNode {
  const actorName = item.actor?.login ?? "GitHub";

  return (
    <TimelineEventCard icon={<TimelineEventIcon event={item.event} />}>
      <>
        <span className="font-medium text-text-1">{actorName}</span>{" "}
        <IssueTimelineEventDescription item={item} />
        {item.created_at ? (
          <>
            <span className="mx-1">·</span>
            <ActivityTimestamp timestamp={item.created_at} />
          </>
        ) : null}
      </>
    </TimelineEventCard>
  );
}

/**
 * A run of `labeled`/`unlabeled` events from the same actor, grouped by
 * `groupIssueTimelineRows`. GitHub's timeline emits one event per label even
 * when they were all applied together, so this collapses that run into a
 * single row.
 */
export function IssueTimelineLabelGroupRow({
  event,
  actor,
  items,
}: {
  event: "labeled" | "unlabeled";
  actor: GitHubIssueUser | null;
  items: GitHubIssueTimelineItem[];
}): React.ReactNode {
  const { t } = useTranslation("common");
  const actorName = actor?.login ?? "GitHub";
  const latest = items[items.length - 1];

  return (
    <TimelineEventCard icon={<TimelineEventIcon event={event} />}>
      <>
        <span className="font-medium text-text-1">{actorName}</span>{" "}
        {event === "labeled"
          ? t("git.issues.activity.added")
          : t("git.issues.activity.removed")}{" "}
        {items.map((item, index) => (
          <React.Fragment key={item.id ?? `${item.label?.name}-${index}`}>
            {index > 0 ? " " : ""}
            {item.label ? (
              <Tag
                size="mini"
                pill
                className={`${TYPOGRAPHY.badge} px-1.5! py-px! align-middle text-[10px]! leading-3!`}
                style={getLabelColorStyle(item.label.color)}
              >
                {item.label.name}
              </Tag>
            ) : (
              t("git.issues.activity.label")
            )}
          </React.Fragment>
        ))}
        {latest.created_at ? (
          <>
            <span className="mx-1">·</span>
            <ActivityTimestamp timestamp={latest.created_at} />
          </>
        ) : null}
      </>
    </TimelineEventCard>
  );
}

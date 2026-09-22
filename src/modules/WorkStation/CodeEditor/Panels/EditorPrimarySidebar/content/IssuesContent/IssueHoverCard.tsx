/** Hover-card presentation owned by the WorkStation issues panel. */
import React, { memo } from "react";
import { useTranslation } from "react-i18next";

import type { GitHubIssue } from "@src/api/tauri/github";
import HoverCard, {
  type HoverCardTriggerProps,
} from "@src/components/HoverCard";
import {
  HoverCardPanel,
  HoverCardRow,
} from "@src/components/HoverCard/HoverCardBase";
import { HoverCardMetadataRow } from "@src/components/HoverCard/HoverCardMetadataRow";
import { HoverCardUrlRow } from "@src/components/HoverCard/HoverCardUrlRow";
import { formatHoverCardTimeAgo } from "@src/components/HoverCard/hoverCardTime";
import { HOVER_CARD } from "@src/components/HoverCard/tokens";
import Tag from "@src/components/Tag";
import { TYPOGRAPHY } from "@src/config/workstation/tokens";
import {
  CancelCircleIcon,
  CircleDotIcon,
  Clock01Icon,
  HugeiconsIcon,
  Message01Icon,
  TagsIcon,
  UserIcon,
} from "@src/icons";
import { getLabelColorStyle } from "@src/modules/WorkStation/CodeEditor/Panels/EditorPrimarySidebar/hooks/workstationIssueHelpers";

interface IssueHoverCardProps extends HoverCardTriggerProps {
  issue?: GitHubIssue | null;
}

interface IssueHoverCardContentProps {
  issue: GitHubIssue;
}

type TranslationFn = ReturnType<typeof useTranslation>["t"];

function formatIssueState(state: string, t: TranslationFn): string {
  return t(`git.issues.status.${state}`, state);
}

const IssueHoverCardContent: React.FC<IssueHoverCardContentProps> = memo(
  ({ issue }) => {
    const { i18n, t } = useTranslation("common");
    const isOpen = issue.state === "open";
    const labelsTitle = issue.labels.map((label) => label.name).join(", ");
    const assigneesTitle = issue.assignees
      .map((assignee) => assignee.login)
      .join(", ");
    const wasUpdated = issue.updated_at !== issue.created_at;

    return (
      <HoverCardPanel title={issue.title}>
        <HoverCardRow
          icon={
            isOpen ? (
              <HugeiconsIcon
                icon={CircleDotIcon}
                data-icon="circle-dot"
                size={HOVER_CARD.iconSize}
                strokeWidth={HOVER_CARD.iconStrokeWidth}
              />
            ) : (
              <HugeiconsIcon
                icon={CancelCircleIcon}
                data-icon="xcircle"
                size={HOVER_CARD.iconSize}
                strokeWidth={HOVER_CARD.iconStrokeWidth}
              />
            )
          }
          iconClassName={isOpen ? "text-success-6" : "text-text-3"}
        >
          <div className="truncate text-text-2">
            <span>{formatIssueState(issue.state, t)}</span>
            <span className="mx-1 text-text-4">·</span>
            <span>#{issue.number}</span>
          </div>
        </HoverCardRow>

        {issue.html_url && <HoverCardUrlRow url={issue.html_url} />}

        <HoverCardMetadataRow icon={UserIcon} dataIcon="user">
          <div className="truncate text-text-2">
            <span>{issue.user.login}</span>
            <span className="mx-1 text-text-4">·</span>
            <span className="text-text-3">
              {formatHoverCardTimeAgo(issue.created_at, i18n.language)}
            </span>
          </div>
        </HoverCardMetadataRow>

        <HoverCardMetadataRow icon={Clock01Icon} dataIcon="clock">
          <div className="truncate text-text-2">
            <span className="text-text-3">
              {wasUpdated
                ? t("git.issues.updated")
                : t("git.issues.notUpdated")}
            </span>
            {wasUpdated && (
              <>
                <span className="mx-1 text-text-4">·</span>
                <span>
                  {formatHoverCardTimeAgo(issue.updated_at, i18n.language)}
                </span>
              </>
            )}
          </div>
        </HoverCardMetadataRow>

        {issue.labels.length > 0 && (
          <HoverCardMetadataRow icon={TagsIcon} dataIcon="tags">
            <div className={HOVER_CARD.tags} title={labelsTitle}>
              {issue.labels.map((label) => (
                <Tag
                  key={label.id}
                  size="mini"
                  pill
                  className={`${TYPOGRAPHY.badge} px-1.5! py-px! leading-tight!`}
                  style={getLabelColorStyle(label.color)}
                >
                  {label.name}
                </Tag>
              ))}
            </div>
          </HoverCardMetadataRow>
        )}

        {issue.assignees.length > 0 && (
          <HoverCardMetadataRow icon={UserIcon} dataIcon="user">
            <div className="truncate text-text-2" title={assigneesTitle}>
              {t("git.issues.assignedTo", {
                assignees: assigneesTitle,
              })}
            </div>
          </HoverCardMetadataRow>
        )}

        {issue.comments > 0 && (
          <HoverCardMetadataRow icon={Message01Icon} dataIcon="message-square">
            <div className="truncate text-text-2">
              {t("git.issues.commentCount", {
                count: issue.comments,
                defaultValue_one: "{{count}} comment",
                defaultValue_other: "{{count}} comments",
              })}
            </div>
          </HoverCardMetadataRow>
        )}

        {issue.body && (
          <>
            <div className="my-1 h-px bg-border-2" />
            <p
              className={`${HOVER_CARD.text} line-clamp-4 whitespace-pre-wrap text-text-2`}
            >
              {issue.body}
            </p>
          </>
        )}
      </HoverCardPanel>
    );
  }
);

IssueHoverCardContent.displayName = "IssueHoverCardContent";

const IssueHoverCard: React.FC<IssueHoverCardProps> = ({
  issue,
  position = "right-start",
  ...triggerProps
}) => {
  return (
    <HoverCard
      {...triggerProps}
      cardId={issue ? `github-issue:${issue.number}` : null}
      position={position}
      content={issue ? <IssueHoverCardContent issue={issue} /> : null}
    />
  );
};

export default IssueHoverCard;

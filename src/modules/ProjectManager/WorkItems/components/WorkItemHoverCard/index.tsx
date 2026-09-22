/** Hover-card presentation owned by Project Manager work items. */
import React, { memo } from "react";
import { useTranslation } from "react-i18next";

import HoverCard, {
  type HoverCardTriggerProps,
} from "@src/components/HoverCard";
import {
  HoverCardPanel,
  HoverCardRow,
} from "@src/components/HoverCard/HoverCardBase";
import {
  HoverCardMetadataRow,
  HoverCardMetadataValue,
} from "@src/components/HoverCard/HoverCardMetadataRow";
import { HOVER_CARD } from "@src/components/HoverCard/tokens";
import {
  Building02Icon,
  Clock01Icon,
  DeliveryBox01Icon,
  Flag01Icon,
  GitCommitVerticalIcon,
  HugeiconsIcon,
  TagsIcon,
  UserIcon,
} from "@src/icons";
import {
  WORK_ITEM_PRIORITY_OPTIONS,
  WORK_ITEM_STATUS_OPTIONS,
  getWorkItemPriorityConfig,
  getWorkItemStatusConfig,
} from "@src/modules/ProjectManager/config/manage";
import type {
  WorkItemPriority,
  WorkItemStatus,
} from "@src/types/core/workItem";
import {
  formatReplayDateLabel,
  toIntlLocaleTag,
} from "@src/util/data/formatters/date";

export interface WorkItemHoverCardData {
  id: string;
  title: string;
  status: string;
  priority: string;
  projectName?: string;
  orgName?: string;
  source: "local" | "linear";
  assignee?: { name: string } | null;
  labels?: readonly { name: string }[];
  createdAt?: string;
  updatedAt?: string;
}

interface WorkItemHoverCardProps extends HoverCardTriggerProps {
  workItem?: WorkItemHoverCardData | null;
}

interface WorkItemHoverCardContentProps {
  workItem: WorkItemHoverCardData;
}

function isWorkItemStatus(value: string): value is WorkItemStatus {
  return WORK_ITEM_STATUS_OPTIONS.some((option) => option.value === value);
}

function isWorkItemPriority(value: string): value is WorkItemPriority {
  return WORK_ITEM_PRIORITY_OPTIONS.some((option) => option.value === value);
}

function WorkItemStatusRow({ status }: { status: string }) {
  const { t } = useTranslation("projects");
  if (!isWorkItemStatus(status)) return null;

  const config = getWorkItemStatusConfig(status);
  return (
    <HoverCardRow icon={config.icon} iconClassName="text-text-3">
      <div className="truncate text-text-2" style={{ color: config.color }}>
        {t(`workItems.statusLabels.${status}`)}
      </div>
    </HoverCardRow>
  );
}

function WorkItemPriorityRow({ priority }: { priority: string }) {
  const { t } = useTranslation("projects");
  if (!isWorkItemPriority(priority)) return null;

  const config = getWorkItemPriorityConfig(priority);
  return (
    <HoverCardRow
      icon={
        React.isValidElement<{ size?: number; strokeWidth?: number }>(
          config.icon
        ) ? (
          React.cloneElement(config.icon, {
            size: HOVER_CARD.iconSize,
            strokeWidth: HOVER_CARD.iconStrokeWidth,
          })
        ) : (
          <HugeiconsIcon
            icon={Flag01Icon}
            data-icon="flag"
            size={HOVER_CARD.iconSize}
            strokeWidth={HOVER_CARD.iconStrokeWidth}
          />
        )
      }
      iconClassName="text-text-3"
    >
      <div className="truncate text-text-2" style={{ color: config.color }}>
        {t(`workItems.priorityLabels.${priority}`)}
      </div>
    </HoverCardRow>
  );
}

const WorkItemHoverCardContent: React.FC<WorkItemHoverCardContentProps> = memo(
  ({ workItem }) => {
    const { t, i18n } = useTranslation(["projects", "sessions", "common"]);
    const dateTimeLabelOptions = {
      todayLabel: t("common:relativeDate.today"),
      yesterdayLabel: t("common:relativeDate.yesterday"),
      locale: toIntlLocaleTag(i18n.language),
      monthStyle: "short" as const,
      withSeconds: false,
    };

    const title = workItem.title || t("projects:workItems.untitledWorkItem");
    const createdLabel =
      workItem.source === "local"
        ? formatReplayDateLabel(workItem.createdAt, dateTimeLabelOptions)
        : "";
    const updatedLabel =
      workItem.source === "local"
        ? formatReplayDateLabel(workItem.updatedAt, dateTimeLabelOptions)
        : "";
    const labels = workItem.source === "local" ? (workItem.labels ?? []) : [];
    const labelsTitle = labels.map((label) => label.name).join(", ");

    return (
      <HoverCardPanel title={title}>
        <WorkItemStatusRow status={workItem.status} />
        <WorkItemPriorityRow priority={workItem.priority} />
        {workItem.projectName && (
          <HoverCardMetadataRow icon={DeliveryBox01Icon} dataIcon="box">
            <div className="truncate text-text-2">{workItem.projectName}</div>
          </HoverCardMetadataRow>
        )}
        {workItem.orgName && (
          <HoverCardMetadataRow icon={Building02Icon} dataIcon="building-2">
            <div className="truncate text-text-2">{workItem.orgName}</div>
          </HoverCardMetadataRow>
        )}
        {workItem.source === "local" && workItem.assignee && (
          <HoverCardMetadataRow icon={UserIcon} dataIcon="user">
            <div className="truncate text-text-2">{workItem.assignee.name}</div>
          </HoverCardMetadataRow>
        )}
        {labels.length > 0 && (
          <HoverCardMetadataRow icon={TagsIcon} dataIcon="tags">
            <div className="truncate text-text-2" title={labelsTitle}>
              {labelsTitle}
            </div>
          </HoverCardMetadataRow>
        )}
        {createdLabel && (
          <HoverCardMetadataRow icon={Clock01Icon} dataIcon="clock">
            <div className="truncate text-text-2" title={createdLabel}>
              <HoverCardMetadataValue
                label={t("sessions:history.detail.created")}
              >
                {createdLabel}
              </HoverCardMetadataValue>
            </div>
          </HoverCardMetadataRow>
        )}
        {updatedLabel && (
          <HoverCardMetadataRow
            icon={GitCommitVerticalIcon}
            dataIcon="git-commit-vertical"
          >
            <div className="truncate text-text-2" title={updatedLabel}>
              <HoverCardMetadataValue
                label={t("sessions:history.detail.lastUpdated")}
              >
                {updatedLabel}
              </HoverCardMetadataValue>
            </div>
          </HoverCardMetadataRow>
        )}
      </HoverCardPanel>
    );
  }
);

WorkItemHoverCardContent.displayName = "WorkItemHoverCardContent";

const WorkItemHoverCard: React.FC<WorkItemHoverCardProps> = ({
  workItem,
  position,
  ...triggerProps
}) => {
  return (
    <HoverCard
      {...triggerProps}
      cardId={workItem ? `${workItem.source}:${workItem.id}` : null}
      position={position}
      content={
        workItem ? <WorkItemHoverCardContent workItem={workItem} /> : null
      }
    />
  );
};

export default WorkItemHoverCard;

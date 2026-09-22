/**
 * Commit marker tooltip/dropdown UI components for DiaryPanel.
 * Extracted to keep DiaryPanel/index.tsx under the 600-line limit.
 */
import React from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import Dropdown from "@src/components/Dropdown";
import { DropdownPanel } from "@src/components/Dropdown/exports";
import {
  DROPDOWN_CLASSES,
  DROPDOWN_ITEM,
} from "@src/components/Dropdown/tokens";
import HoverCard from "@src/components/HoverCard";
import { HoverCardPanel } from "@src/components/HoverCard/HoverCardBase";
import {
  HoverCardMetadataRow,
  HoverCardMetadataValue,
} from "@src/components/HoverCard/HoverCardMetadataRow";
import type { GanttMarker } from "@src/features/GanttChart";
import {
  Clock01Icon,
  GitCommitHorizontalIcon,
  HashtagIcon,
  HugeiconsIcon,
  UserCircleIcon,
} from "@src/icons";

import type { DiaryCommitMarker } from "../../utils/diaryUtils";
import { formatDateTime, formatTime } from "./diaryPanelUtils";

// ============================================================================
// DiaryCommitHoverCardContent
// ============================================================================

interface DiaryCommitHoverCardContentProps {
  marker: DiaryCommitMarker;
  t: (key: string) => string;
}

export const DiaryCommitHoverCardContent: React.FC<
  DiaryCommitHoverCardContentProps
> = ({ marker, t }) => {
  const commit = marker.commit;
  const title = commit.summary || commit.short_sha;

  return (
    <HoverCardPanel title={title}>
      <HoverCardMetadataRow
        icon={GitCommitHorizontalIcon}
        dataIcon="git-commit-horizontal"
      >
        <div className="truncate text-text-2" title={commit.sha}>
          <HoverCardMetadataValue label={t("gitDashboard.commits")}>
            {commit.short_sha}
          </HoverCardMetadataValue>
        </div>
      </HoverCardMetadataRow>
      <HoverCardMetadataRow icon={Clock01Icon} dataIcon="clock">
        <div
          className="truncate text-text-2"
          title={marker.timestamp.toISOString()}
        >
          <HoverCardMetadataValue label={t("common.time")}>
            {formatDateTime(marker.timestamp)}
          </HoverCardMetadataValue>
        </div>
      </HoverCardMetadataRow>
      <HoverCardMetadataRow icon={UserCircleIcon} dataIcon="user-round">
        <div className="truncate text-text-2" title={commit.author.email}>
          <HoverCardMetadataValue label={t("gitDashboard.author")}>
            {commit.author.name}
          </HoverCardMetadataValue>
        </div>
      </HoverCardMetadataRow>
      {marker.task && (
        <HoverCardMetadataRow icon={HashtagIcon} dataIcon="hash">
          <div className="truncate text-text-2" title={marker.task.title}>
            <HoverCardMetadataValue label={t("terminology.session")}>
              {marker.task.title}
            </HoverCardMetadataValue>
          </div>
        </HoverCardMetadataRow>
      )}
    </HoverCardPanel>
  );
};

// ============================================================================
// DiaryCommitDetailsDropdown
// ============================================================================

interface DiaryCommitDetailsDropdownProps {
  marker: DiaryCommitMarker;
  children: React.ReactElement;
}

export const DiaryCommitDetailsDropdown: React.FC<
  DiaryCommitDetailsDropdownProps
> = ({ marker, children }) => {
  const { t } = useTranslation("common");

  return (
    <HoverCard
      cardId={`diary-commit:${marker.commit.sha}`}
      mouseLeaveDelay={0}
      position="right-start"
      content={<DiaryCommitHoverCardContent marker={marker} t={t} />}
    >
      {children}
    </HoverCard>
  );
};

// ============================================================================
// DiaryCommitBucketDropdown
// ============================================================================

interface DiaryCommitBucketDropdownProps {
  bucketCommits: DiaryCommitMarker[];
  marker: GanttMarker;
  children: React.ReactElement;
}

export const DiaryCommitBucketDropdown: React.FC<
  DiaryCommitBucketDropdownProps
> = ({ bucketCommits, marker, children }) => {
  const rangeLabel = marker.title;
  const countLabel = `${bucketCommits.length} ${
    bucketCommits.length === 1 ? "commit" : "commits"
  }`;

  return (
    <Dropdown
      trigger="hover"
      hoverCloseDelayMs={0}
      position="bottom-start"
      droplist={
        <DropdownPanel
          className="w-[320px] p-1"
          animated={false}
          maxHeight="none"
        >
          <div className="flex items-center justify-between gap-3 px-2 py-1.5 text-[12px]">
            <span className="truncate text-text-2">{rangeLabel}</span>
            <span className="shrink-0 rounded bg-fill-1 px-1.5 py-0.5 text-[10px] text-text-2">
              {countLabel}
            </span>
          </div>
          <div className={DROPDOWN_CLASSES.itemsColumn}>
            {bucketCommits.map((commitMarker) => {
              const commit = commitMarker.commit;
              const title = commit.summary || commit.short_sha;
              return (
                <DiaryCommitDetailsDropdown
                  key={commitMarker.id}
                  marker={commitMarker}
                >
                  <Button
                    layout="custom"
                    className={`${DROPDOWN_CLASSES.item} ${DROPDOWN_CLASSES.itemHover} w-full min-w-0 justify-start text-left`}
                  >
                    <HugeiconsIcon
                      icon={GitCommitHorizontalIcon}
                      data-icon="git-commit-horizontal"
                      size={DROPDOWN_ITEM.iconSize}
                      strokeWidth={1.75}
                      className="shrink-0 text-text-3"
                    />
                    <span className="min-w-0 flex-1 truncate" title={title}>
                      {title}
                    </span>
                    <span className="shrink-0 text-[11px] text-text-3">
                      {commit.short_sha}
                    </span>
                    <span className="shrink-0 text-[11px] text-text-2">
                      {formatTime(commitMarker.timestamp)}
                    </span>
                  </Button>
                </DiaryCommitDetailsDropdown>
              );
            })}
          </div>
        </DropdownPanel>
      }
      getPopupContainer={() => document.body}
      avoidViewportOverflow
    >
      {children}
    </Dropdown>
  );
};

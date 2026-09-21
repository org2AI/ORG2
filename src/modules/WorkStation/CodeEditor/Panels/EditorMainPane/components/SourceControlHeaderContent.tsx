/**
 * SourceControlHeaderContent
 *
 * Header strip published into the global workstation tab-header slot while the
 * Source Control tab is active. Extracted verbatim from `EditorMainPane`'s
 * `sourceControlHeaderContent` memo — the host still wraps the rendered element
 * in a `useMemo` so `usePublishWorkstationTabHeader` keeps a stable `content`
 * identity and does not re-publish on every render.
 */
import type { TFunction } from "i18next";
import React from "react";
import type { ReactNode } from "react";

import type { GitHubIssue } from "@src/api/tauri/github";
import Button from "@src/components/Button";
import { DiffViewModeToggle } from "@src/components/DiffViewModeToggle";
import { ToolbarTooltip } from "@src/components/KeyboardShortcut/ToolbarTooltip";
import TabPill from "@src/components/TabPill";
import { HEADER_ICON_SIZE } from "@src/config/workstation/tokens";
import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  CircleDotIcon,
  HugeiconsIcon,
  ListChevronsDownUpIcon,
  Refresh04Icon,
} from "@src/icons";
import { ExternalBrowserButton } from "@src/modules/WorkStation/shared/ExternalBrowserButton";
import type { SourceControlFilterMode } from "@src/modules/WorkStation/shared/SidebarModules";
import type {
  SourceControlHistorySelection,
  WorkStationTab,
} from "@src/store/workstation/tabs";
import type { DiffViewMode } from "@src/types/git/types";

import { SourceControlDiffSettingsMenu } from "./SourceControlDiffSettingsMenu";

export interface SourceControlHeaderContentProps {
  /** The active `source-control` tab (host guarantees the type). */
  activeTab: WorkStationTab;
  sourceControlFilterMode: SourceControlFilterMode;
  showSourceControlModePill: boolean;
  /** `gitReviewNavigation.total` — number of files in the review sequence. */
  gitReviewNavigationTotal: number;
  selectedIssue: GitHubIssue | null;
  sourceControlHeaderLeadingSlot?: ReactNode;
  sourceControlHeaderTrailingSlot?: ReactNode;
  sourceControlRefreshSpinClass: string | undefined;
  focusToolbarRef?: React.Ref<HTMLSpanElement>;
  diffViewMode: DiffViewMode;
  t: TFunction;
  onDiffViewModeChange: (mode: DiffViewMode) => void;
  onModeChange: (mode: "focus" | "all-changes") => void;
  onReviewPrevFile: () => void;
  onReviewNextFile: () => void;
  onCollapseAll: () => void;
  onRefresh: () => void;
}

export const SourceControlHeaderContent: React.FC<
  SourceControlHeaderContentProps
> = ({
  activeTab,
  sourceControlFilterMode,
  showSourceControlModePill,
  gitReviewNavigationTotal,
  selectedIssue,
  sourceControlHeaderLeadingSlot,
  sourceControlHeaderTrailingSlot,
  sourceControlRefreshSpinClass,
  focusToolbarRef,
  diffViewMode,
  t,
  onDiffViewModeChange,
  onModeChange,
  onReviewPrevFile,
  onReviewNextFile,
  onCollapseAll,
  onRefresh,
}) => {
  const hasFocusPath = Boolean(activeTab.data.focusPath);
  const mode = activeTab.data.mode === "all-changes" ? "all-changes" : "focus";
  const historySelection = activeTab.data.historySelection as
    | SourceControlHistorySelection
    | null
    | undefined;
  const isIssuesMode = sourceControlFilterMode === "issues";
  const showHistoryDiff =
    historySelection?.type === "commit" || historySelection?.type === "stash";
  const showModePill =
    showSourceControlModePill && !isIssuesMode && !historySelection;
  const sourceControlModeTabs = [
    { key: "focus", label: t("sourceControl.pill.focus") },
    {
      key: "all-changes",
      label: t("sourceControl.pill.allChanges"),
    },
  ];
  const showCollapseAll =
    showModePill && mode === "all-changes" && !historySelection;
  const showReviewNavigation = showModePill && mode === "focus";
  const showDetailToolbar =
    showHistoryDiff || (showModePill && mode === "focus" && hasFocusPath);
  const reviewNavigationDisabled =
    !hasFocusPath || gitReviewNavigationTotal === 0;
  const showIssueHeader = isIssuesMode && selectedIssue;
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1.5">
      {(sourceControlHeaderLeadingSlot || sourceControlHeaderTrailingSlot) && (
        <div className="flex min-w-0 shrink-0 items-center gap-px">
          {sourceControlHeaderLeadingSlot}
          {sourceControlHeaderTrailingSlot}
        </div>
      )}
      {showIssueHeader && (
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span
            className={`shrink-0 ${selectedIssue.state === "open" ? "text-success-6" : "text-text-3"}`}
          >
            <HugeiconsIcon
              icon={CircleDotIcon}
              data-icon="circle-dot"
              size={HEADER_ICON_SIZE.sm}
              strokeWidth={2}
            />
          </span>
          <span className="shrink-0 font-mono text-[11px] text-text-3">
            #{selectedIssue.number}
          </span>
          <span
            className="min-w-0 flex-1 truncate text-[13px] font-medium text-text-1"
            title={selectedIssue.title}
          >
            {selectedIssue.title}
          </span>
        </div>
      )}
      {showModePill && (
        <TabPill
          activeTab={mode}
          tabs={sourceControlModeTabs}
          onChange={(key) => onModeChange(key as "focus" | "all-changes")}
          variant="pill"
          color="fill"
          fillWidth={false}
          size="small"
        />
      )}

      <span className="ml-auto flex h-7 shrink-0 items-center gap-px">
        {showIssueHeader && (
          <ExternalBrowserButton
            href={selectedIssue.html_url}
            label={t(
              "common:previews.openInExternalBrowser",
              "Open in external browser"
            )}
            className="shrink-0"
            onClick={(e) => e.stopPropagation()}
          />
        )}
        {showReviewNavigation && (
          <>
            <ToolbarTooltip
              label={t("common:actions.reviewPreviousFile")}
              noShortcut
            >
              <Button
                variant="tertiary"
                size="small"
                iconOnly
                disabled={reviewNavigationDisabled}
                onClick={onReviewPrevFile}
                className="shrink-0"
                icon={
                  <HugeiconsIcon
                    icon={ArrowUp01Icon}
                    data-icon="chevron-up"
                    size={HEADER_ICON_SIZE.sm}
                    strokeWidth={1.75}
                  />
                }
              />
            </ToolbarTooltip>
            <ToolbarTooltip
              label={t("common:actions.reviewNextFile")}
              noShortcut
            >
              <Button
                variant="tertiary"
                size="small"
                iconOnly
                disabled={reviewNavigationDisabled}
                onClick={onReviewNextFile}
                className="shrink-0"
                icon={
                  <HugeiconsIcon
                    icon={ArrowDown01Icon}
                    data-icon="chevron-down"
                    size={HEADER_ICON_SIZE.sm}
                    strokeWidth={1.75}
                  />
                }
              />
            </ToolbarTooltip>
          </>
        )}

        {showCollapseAll && (
          <ToolbarTooltip label={t("actions.collapseAll")} noShortcut>
            <Button
              variant="tertiary"
              size="small"
              iconOnly
              className="shrink-0"
              onClick={onCollapseAll}
              icon={
                <HugeiconsIcon
                  icon={ListChevronsDownUpIcon}
                  data-icon="list-chevrons-down-up"
                  size={HEADER_ICON_SIZE.md}
                />
              }
            />
          </ToolbarTooltip>
        )}
        {(showReviewNavigation || showCollapseAll) && (
          <span
            className="mx-1.5 h-4 w-px shrink-0 bg-border-2"
            role="separator"
            aria-hidden
          />
        )}
        <DiffViewModeToggle
          viewMode={diffViewMode}
          onChange={onDiffViewModeChange}
          t={t}
        />
        <ToolbarTooltip label={t("common:actions.refresh")} noShortcut>
          <Button
            variant="tertiary"
            size="small"
            iconOnly
            className="shrink-0"
            onClick={onRefresh}
            icon={
              <HugeiconsIcon
                icon={Refresh04Icon}
                data-icon="refresh-cw"
                size={HEADER_ICON_SIZE.sm}
                strokeWidth={2}
                className={sourceControlRefreshSpinClass}
              />
            }
          />
        </ToolbarTooltip>
        {showDetailToolbar ? (
          <span
            ref={focusToolbarRef}
            className="flex shrink-0 items-center gap-px"
          />
        ) : (
          <SourceControlDiffSettingsMenu
            onRefresh={onRefresh}
            refreshSpinClass={sourceControlRefreshSpinClass}
          />
        )}
      </span>
    </div>
  );
};

export default SourceControlHeaderContent;

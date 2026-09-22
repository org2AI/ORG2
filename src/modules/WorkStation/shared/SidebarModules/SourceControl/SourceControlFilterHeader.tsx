/**
 * SourceControlFilterHeader
 *
 * Filter-mode select (Uncommitted / Unstaged / Staged / Branch) + optional
 * refresh button, designed for the Source Control 36px workstation header.
 * Shared Source Control filter header for Diff and Source Control tabs so their
 * tab-specific sidebar gets the same filter UX across every host.
 *
 * Repo-agnostic: all state is owned by the caller (`useSourceControlSidebarModule`).
 */
import React, { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import Dropdown from "@src/components/Dropdown";
import { DROPDOWN_CLASSES } from "@src/components/Dropdown/tokens";
import type { DropdownOption } from "@src/components/Dropdown/types";
import { ToolbarTooltip } from "@src/components/KeyboardShortcut/ToolbarTooltip";
import { useRefreshSpin } from "@src/components/RefreshIcon/useRefreshSpin";
import Select from "@src/components/Select";
import { HEADER_ICON_SIZE } from "@src/config/workstation/tokens";
import {
  Archive03Icon,
  CircleDotIcon,
  EllipsisIcon,
  FileDiffIcon,
  GitCommitIcon,
  GitPullRequestIcon,
  HugeiconsIcon,
  MinusSignIcon,
  Refresh04Icon,
  Tick01Icon,
} from "@src/icons";
import type { SourceControlFilterMode } from "@src/store/workstation/codeEditor/sourceControlTypes";

export type { SourceControlFilterMode } from "@src/store/workstation/codeEditor/sourceControlTypes";

export interface SourceControlFilterCounts {
  uncommitted: number;
  unstaged: number;
  staged: number;
  stashed: number;
}

const FILTER_ICONS = {
  uncommitted: FileDiffIcon,
  unstaged: MinusSignIcon,
  staged: Tick01Icon,
  stashed: Archive03Icon,
  history: GitCommitIcon,
  pr: GitPullRequestIcon,
  issues: CircleDotIcon,
} as const;

function filterIcon(mode: SourceControlFilterMode) {
  return <HugeiconsIcon icon={FILTER_ICONS[mode]} size={HEADER_ICON_SIZE.sm} />;
}

interface FilterRowEntry {
  id: SourceControlFilterMode;
  labelKey: string;
}

const FILE_FILTER_ROWS: FilterRowEntry[] = [
  {
    id: "uncommitted",
    labelKey: "controlTower.git.filterUncommitted",
  },
  {
    id: "unstaged",
    labelKey: "controlTower.git.filterUnstaged",
  },
  { id: "staged", labelKey: "controlTower.git.filterStaged" },
  {
    id: "stashed",
    labelKey: "controlTower.git.filterStashed",
  },
];

export interface SourceControlFilterHeaderProps {
  /** Active filter mode. */
  mode: SourceControlFilterMode;
  /** Pick a new filter mode. */
  onChangeMode: (mode: SourceControlFilterMode) => void;
  /** Refresh git status. */
  onRefresh: () => void;
  /** Whether refresh is in progress (drives spin animation). */
  refreshLoading?: boolean;
  /** Stable id used to scope the refresh-spin animation. */
  spinScope?: string;
  /** Whether to show the refresh action next to the filter select. */
  showRefresh?: boolean;
  /** Counts shown only in dropdown options. */
  counts?: SourceControlFilterCounts;
}

const SourceControlFilterHeader: React.FC<SourceControlFilterHeaderProps> =
  memo(
    ({
      mode,
      onChangeMode,
      onRefresh,
      refreshLoading = false,
      spinScope,
      showRefresh = true,
      counts,
    }) => {
      const { t } = useTranslation("sessions");

      const getModeCount = useCallback(
        (modeId: SourceControlFilterMode) => {
          if (
            !counts ||
            modeId === "history" ||
            modeId === "pr" ||
            modeId === "issues"
          )
            return undefined;
          return counts[modeId];
        },
        [counts]
      );

      const getCountLabel = useCallback(
        (count: number, label: string) =>
          t("controlTower.git.filterCountLabel", {
            count,
            label: label.toLowerCase(),
          }),
        [t]
      );

      const hideStageFilters = counts?.staged === 0;
      const stageModeHidden =
        hideStageFilters && (mode === "staged" || mode === "unstaged");
      useEffect(() => {
        if (stageModeHidden) onChangeMode("uncommitted");
      }, [stageModeHidden, onChangeMode]);

      const options = useMemo<DropdownOption[]>(() => {
        const fileOptions = FILE_FILTER_ROWS.filter(
          (row) =>
            !hideStageFilters || (row.id !== "staged" && row.id !== "unstaged")
        ).map((row) => {
          const label = t(row.labelKey);
          const count = getModeCount(row.id);
          const optionLabel =
            typeof count === "number" ? getCountLabel(count, label) : label;
          return {
            value: row.id,
            icon: filterIcon(row.id),
            label: <span className="whitespace-nowrap">{optionLabel}</span>,
            triggerLabel: label,
          };
        });

        return [
          ...fileOptions,
          {
            value: "history",
            icon: filterIcon("history"),
            label: (
              <span className="whitespace-nowrap">
                {t("common:labels.gitHistory")}
              </span>
            ),
            triggerLabel: t("common:labels.gitHistory"),
          },
          {
            value: "pr",
            icon: filterIcon("pr"),
            label: (
              <span className="whitespace-nowrap">
                {t("common:labels.pullRequest")}
              </span>
            ),
            triggerLabel: t("common:labels.pullRequest"),
          },
          {
            value: "issues",
            icon: filterIcon("issues"),
            label: (
              <span className="whitespace-nowrap">
                {t("common:labels.issues")}
              </span>
            ),
            triggerLabel: t("common:labels.issues"),
          },
        ];
      }, [getCountLabel, getModeCount, hideStageFilters, t]);

      const [moreMenuVisible, setMoreMenuVisible] = useState(false);

      const handleSelect = useCallback(
        (nextMode: string | number | (string | number)[]) => {
          if (Array.isArray(nextMode)) return;
          onChangeMode(nextMode as SourceControlFilterMode);
        },
        [onChangeMode]
      );

      const { spinClass: refreshSpinClass, handleClick: handleRefreshClick } =
        useRefreshSpin(onRefresh, refreshLoading, spinScope);
      const handleRefreshMenuClick = useCallback(() => {
        handleRefreshClick();
        setMoreMenuVisible(false);
      }, [handleRefreshClick]);

      return (
        <div className="flex flex-none items-center gap-1 overflow-visible">
          <Select
            value={stageModeHidden ? "uncommitted" : mode}
            onChange={handleSelect}
            options={options}
            showTriggerIcon={false}
            size="small"
            appearance="ghost"
            radius="lg"
            dropdownWidthMode="auto"
            className="w-auto"
          />

          {showRefresh && (
            <Dropdown
              droplist={
                <div className={DROPDOWN_CLASSES.menuPanel}>
                  <Button
                    layout="custom"
                    onClick={handleRefreshMenuClick}
                    className={DROPDOWN_CLASSES.menuActionItem}
                  >
                    <HugeiconsIcon
                      icon={Refresh04Icon}
                      data-icon="refresh-cw"
                      size={HEADER_ICON_SIZE.sm}
                      className={refreshSpinClass}
                    />
                    <span>{t("controlTower.diff.refresh")}</span>
                  </Button>
                </div>
              }
              position="bottom-end"
              trigger="click"
              popupVisible={moreMenuVisible}
              onVisibleChange={setMoreMenuVisible}
            >
              <ToolbarTooltip
                label={t("common:actions.more")}
                disabled={moreMenuVisible}
              >
                <Button
                  variant="tertiary"
                  size="small"
                  iconOnly
                  className={
                    moreMenuVisible ? "bg-fill-2! text-primary-6!" : ""
                  }
                  icon={
                    <HugeiconsIcon
                      icon={EllipsisIcon}
                      data-icon="ellipsis"
                      size={HEADER_ICON_SIZE.sm}
                      strokeWidth={1.75}
                    />
                  }
                />
              </ToolbarTooltip>
            </Dropdown>
          )}
        </div>
      );
    }
  );
SourceControlFilterHeader.displayName = "SourceControlFilterHeader";

export default SourceControlFilterHeader;

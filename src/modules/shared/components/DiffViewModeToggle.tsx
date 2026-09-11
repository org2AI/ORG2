import type { TFunction } from "i18next";
import React from "react";

import Button from "@src/components/Button";
import { ToolbarTooltip } from "@src/components/KeyboardShortcut/ToolbarTooltip";
import { DIFF_STATS, HEADER_ICON_SIZE } from "@src/config/workstation/tokens";
import { HugeiconsIcon, LayoutTwoColumnIcon } from "@src/icons";
import type { DiffViewMode } from "@src/types/git/types";

// Keep the outline in the inherited toolbar color and tint the diff panels.
const splitDiffIcon: typeof LayoutTwoColumnIcon = [
  ...LayoutTwoColumnIcon,
  [
    "rect",
    {
      x: 5.5,
      y: 6,
      width: 4,
      height: 12,
      rx: 1,
      fill: "currentColor",
      stroke: "none",
      className: DIFF_STATS.deletions,
      opacity: 0.55,
      key: "deleted",
    },
  ],
  [
    "rect",
    {
      x: 14.5,
      y: 6,
      width: 4,
      height: 12,
      rx: 1,
      fill: "currentColor",
      stroke: "none",
      className: DIFF_STATS.additions,
      opacity: 0.55,
      key: "added",
    },
  ],
];

const unifiedDiffIcon: typeof LayoutTwoColumnIcon = [
  LayoutTwoColumnIcon[0],
  [
    "rect",
    {
      x: 6,
      y: 6,
      width: 12,
      height: 5,
      rx: 1,
      fill: "currentColor",
      stroke: "none",
      className: DIFF_STATS.deletions,
      opacity: 0.55,
      key: "deleted",
    },
  ],
  [
    "rect",
    {
      x: 6,
      y: 13,
      width: 12,
      height: 5,
      rx: 1,
      fill: "currentColor",
      stroke: "none",
      className: DIFF_STATS.additions,
      opacity: 0.55,
      key: "added",
    },
  ],
];

interface DiffViewModeToggleProps {
  viewMode: DiffViewMode;
  onChange: (mode: DiffViewMode) => void;
  t: TFunction;
}

export function DiffViewModeToggle({
  viewMode,
  onChange,
  t,
}: DiffViewModeToggleProps) {
  const nextMode = viewMode === "split" ? "unified" : "split";
  const label =
    nextMode === "unified"
      ? t("workstation.switchToUnifiedDiff", "Switch to unified diff")
      : t("workstation.switchToSplitDiff", "Switch to split diff");

  return (
    <ToolbarTooltip label={label}>
      <Button
        htmlType="button"
        variant="tertiary"
        size="small"
        iconOnly
        className="shrink-0"
        aria-label={label}
        onClick={() => onChange(nextMode)}
        icon={
          <HugeiconsIcon
            icon={viewMode === "split" ? splitDiffIcon : unifiedDiffIcon}
            size={HEADER_ICON_SIZE.md}
            strokeWidth={1.5}
            aria-hidden="true"
          />
        }
      />
    </ToolbarTooltip>
  );
}

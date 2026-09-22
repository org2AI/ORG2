import cn from "classnames";
import React from "react";

import Switch from "@src/components/Switch";
import Tooltip from "@src/components/Tooltip";

/** Shared 44px header row, indented like the rows it heads. Padding sits
 * inside the border box, so the separator still spans the full card width. */
const INLINE_SPLIT_HEADER_ROW_CLASS =
  "flex h-11 min-h-11 items-center justify-between gap-3 rounded-md pl-2 text-xs";

/** Header row used at the top of an inline card list. */
interface InlineSplitHeaderRowProps {
  label: React.ReactNode;
  trailing?: React.ReactNode;
  /** Draw a bottom border to visually separate the header from the list below. */
  withSeparator?: boolean;
}

export function InlineSplitHeaderRow({
  label,
  trailing,
  withSeparator = false,
}: InlineSplitHeaderRowProps) {
  return (
    <div
      className={cn(
        INLINE_SPLIT_HEADER_ROW_CLASS,
        withSeparator && "mb-1 rounded-none border-0 border-b border-border-2"
      )}
    >
      <span className="min-w-0 flex-1 truncate leading-none font-medium text-text-1">
        {label}
      </span>
      {trailing ? (
        <div className="flex shrink-0 items-center gap-2">{trailing}</div>
      ) : null}
    </div>
  );
}

/** Consolidated key row: source breadcrumb, its variant controls, and the
 * enable switch on one line. Uses the same any-enabled switch semantics as
 * {@link InlineSplitSelectableRow}; the per-variant breakdown lives in the
 * row's own options dropdown rather than a second pane. */
interface InlineSplitKeyRowProps {
  label: React.ReactNode;
  /** Variant controls, right-aligned ahead of the switch. */
  controls?: React.ReactNode;
  switchChecked: boolean;
  /** Optional tooltip shown when hovering the switch. */
  switchTooltip?: React.ReactNode;
  onToggle: (checked: boolean) => void;
}

export function InlineSplitKeyRow({
  label,
  controls,
  switchChecked,
  switchTooltip,
  onToggle,
}: InlineSplitKeyRowProps) {
  const switchElement = (
    <Switch size="small" checked={switchChecked} onCheckedChange={onToggle} />
  );
  return (
    <div className="flex h-11 min-h-11 items-center justify-between gap-3 rounded-md pl-2 text-xs">
      <div className="flex min-w-0 flex-1 items-center gap-2">{label}</div>
      {controls ? (
        <div className="flex shrink-0 items-center gap-2">{controls}</div>
      ) : null}
      <div className="flex shrink-0 items-center gap-2">
        {switchTooltip ? (
          <Tooltip kind="button" content={switchTooltip} position="top">
            <span className="inline-flex">{switchElement}</span>
          </Tooltip>
        ) : (
          switchElement
        )}
      </div>
    </div>
  );
}

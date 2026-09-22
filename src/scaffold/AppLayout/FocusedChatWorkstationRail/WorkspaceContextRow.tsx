/**
 * WorkspaceContextRow — a read-only (or click-through) scope row in the rail:
 * repo, branch, worktree, or the linked work item.
 */
import AnyIcon from "@src/components/AnyIcon";
import Button from "@src/components/Button";
import { KeyboardShortcutTooltipContent } from "@src/components/KeyboardShortcut";
import Tooltip from "@src/components/Tooltip";
import {
  WORKSTATION_TRAIL_ROW,
  WORKSTATION_TRAIL_ROW_HOVER_CLASS,
} from "@src/components/layout/tokens/workstationTrailTokens";
import { ArrowDown01Icon, ArrowUp01Icon, HugeiconsIcon } from "@src/icons";

import type { FocusedChatRailIcon } from "./types";

export function WorkspaceContextRow({
  active = false,
  ariaLabel,
  chevron = false,
  compact = false,
  icon,
  label,
  onClick,
  onRequestClose,
  testId,
  title,
}: {
  /** Switcher popup currently open: chevron flips up, hover highlight sticks. */
  active?: boolean;
  ariaLabel?: string;
  /** Trailing chevron affordance for switcher rows. */
  chevron?: boolean;
  compact?: boolean;
  icon: FocusedChatRailIcon;
  label: string;
  onClick?: () => void;
  onRequestClose?: () => void;
  testId?: string;
  title?: string;
}) {
  const rowClass = `${WORKSTATION_TRAIL_ROW.shell} ${compact ? WORKSTATION_TRAIL_ROW.compact : WORKSTATION_TRAIL_ROW.wide} ${WORKSTATION_TRAIL_ROW_HOVER_CLASS}`;
  const contentClass = `${WORKSTATION_TRAIL_ROW.content} ${compact ? WORKSTATION_TRAIL_ROW.compactContent : WORKSTATION_TRAIL_ROW.wideContent}`;
  const content = (
    <>
      <span className={WORKSTATION_TRAIL_ROW.icon}>
        <AnyIcon
          icon={icon}
          size={WORKSTATION_TRAIL_ROW.iconSize}
          strokeWidth={1.75}
        />
      </span>
      <span className={WORKSTATION_TRAIL_ROW.label}>{label}</span>
      {chevron && (
        <HugeiconsIcon
          icon={active ? ArrowUp01Icon : ArrowDown01Icon}
          data-icon={active ? "chevron-up" : "chevron-down"}
          aria-hidden
          className="shrink-0 text-text-1"
          size={14}
          strokeWidth={1.75}
        />
      )}
    </>
  );

  if (onClick) {
    // Switcher rows with an explicit action title get the rail's styled
    // tooltip; other clickable rows keep the native title.
    const styledTooltip = chevron && title ? title : undefined;
    const button = (
      <Button
        variant="tertiary"
        size="sidebar"
        className={`${rowClass} ${WORKSTATION_TRAIL_ROW.button} ${compact ? "h-8!" : "h-7!"} w-full text-left ${
          active ? "bg-fill-2" : ""
        }`}
        title={styledTooltip ? undefined : (title ?? label)}
        aria-label={ariaLabel}
        aria-expanded={chevron ? active : undefined}
        data-testid={testId}
        role={compact ? "menuitem" : undefined}
        onClick={() => {
          onRequestClose?.();
          onClick();
        }}
      >
        <span className={contentClass}>{content}</span>
      </Button>
    );

    if (styledTooltip) {
      return (
        <Tooltip
          content={<KeyboardShortcutTooltipContent label={styledTooltip} />}
          position="left"
          framedPanel
          kind="button"
          smartPlacement
        >
          {button}
        </Tooltip>
      );
    }
    return button;
  }

  return (
    <div
      className={`${rowClass} ${contentClass}`}
      title={title ?? label}
      data-testid={testId}
    >
      {content}
    </div>
  );
}

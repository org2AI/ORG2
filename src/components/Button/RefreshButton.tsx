import type { ReactNode } from "react";

import { ToolbarTooltip } from "@src/components/KeyboardShortcut/ToolbarTooltip";
import { useRefreshSpin } from "@src/components/RefreshIcon/useRefreshSpin";
import { HugeiconsIcon, Refresh04Icon } from "@src/icons";

import Button from ".";

interface RefreshButtonProps {
  label: string;
  variant?: "secondary" | "tertiary";
  /**
   * Override the height the variant implies (secondary 32px, tertiary 28px),
   * for toolbars and inline row actions that sit on a 28px rhythm.
   */
  size?: "small" | "default";
  iconOnly?: boolean;
  /**
   * Async refreshes are fine: `useRefreshSpin` attaches a rejection handler,
   * so callers pass their fetcher directly instead of wrapping it.
   */
  onRefresh: () => void | Promise<void>;
  refreshing: boolean;
  disabled?: boolean;
  dataTestId?: string;
}

/**
 * Standard page and table-toolbar refresh action: a compact text button by
 * default, or a bordered icon-only toolbar button with `variant="secondary"`.
 * The icon keeps spinning for at least one full turn per click.
 */
export default function RefreshButton({
  label,
  iconOnly = false,
  variant = "tertiary",
  size,
  onRefresh,
  refreshing,
  disabled = false,
  dataTestId,
}: RefreshButtonProps): ReactNode {
  const { spinClass, handleClick } = useRefreshSpin(onRefresh, refreshing);

  const button = (
    <Button
      htmlType="button"
      variant={variant}
      iconOnly={iconOnly}
      size={size ?? (variant === "secondary" ? "default" : "small")}
      disabled={disabled || refreshing}
      aria-label={label}
      onClick={handleClick}
      icon={
        <HugeiconsIcon
          icon={Refresh04Icon}
          data-icon="refresh-cw"
          size={14}
          className={spinClass}
        />
      }
      data-testid={dataTestId}
    >
      {iconOnly ? null : label}
    </Button>
  );

  // Icon-only has no visible text, so the label moves to the shared tooltip.
  return iconOnly ? (
    <ToolbarTooltip label={label}>{button}</ToolbarTooltip>
  ) : (
    button
  );
}

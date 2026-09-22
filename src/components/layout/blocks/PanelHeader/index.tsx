/**
 * PanelHeader Component
 *
 * Reusable 40px header for panels with multiple variants:
 * - Simple title with optional icon
 * - Back button + breadcrumb (for subpages)
 * - Title + right-side actions
 *
 * Font size matches PageBreadcrumb (13px)
 *
 * ## Button Standardization
 *
 * ALL icon-only buttons in 40px headers use 24×24 circles:
 *
 * ```tsx
 * // Normal action button (hover: fill-2)
 * <Button {...PANEL_HEADER_TOKENS.actionButton}
 *   icon={<Icon size={PANEL_HEADER_TOKENS.buttonIconSize} strokeWidth={PANEL_HEADER_TOKENS.iconStrokeWidth} />} />
 *
 * // Danger button (hover: danger-1, for destructive actions like delete/uninstall only)
 * <Button {...PANEL_HEADER_TOKENS.dangerButton}
 *   icon={<Icon size={PANEL_HEADER_TOKENS.buttonIconSize} strokeWidth={PANEL_HEADER_TOKENS.iconStrokeWidth} />} />
 *
 * // Close/cancel buttons: use actionButton, NOT dangerButton
 * <Button {...PANEL_HEADER_TOKENS.actionButton}
 *   icon={<X size={PANEL_HEADER_TOKENS.buttonIconSize} strokeWidth={PANEL_HEADER_TOKENS.iconStrokeWidth} />} />
 *
 * // Active toggle (override className for active state)
 * <Button {...PANEL_HEADER_TOKENS.actionButton}
 *   className={isActive ? "bg-fill-2! text-text-1!" : PANEL_HEADER_TOKENS.actionButton.className}
 * />
 * ```
 */
import React, { memo } from "react";

import Button from "@src/components/Button";
import { useRefreshSpin } from "@src/components/RefreshIcon/useRefreshSpin";
import { DETAIL_PANEL_TOKENS } from "@src/config/detailPanelTokens";
import {
  ArrowLeft02Icon,
  ArrowRight01Icon,
  HugeiconsIcon,
  type IconSvgElement,
  Refresh04Icon,
} from "@src/icons";

import { PANEL_HEADER_TOKENS } from "./tokens";

export { PANEL_HEADER_TOKENS } from "./tokens";

// ============================================
// PanelRefreshButton — guaranteed min-spin refresh for panel headers
// ============================================

interface PanelRefreshButtonProps {
  onRefresh: () => void;
  loading: boolean;
  title?: string;
  disabled?: boolean;
  dataTestId?: string;
}

/**
 * Standardized refresh button for PanelHeader actions.
 * Uses useRefreshSpin to guarantee a visible 2-round spin even when
 * the refresh resolves instantly, and stays disabled until the spin ends.
 */
export const PanelRefreshButton: React.FC<PanelRefreshButtonProps> = ({
  onRefresh,
  loading,
  title,
  disabled = false,
  dataTestId,
}) => {
  const { spinClass, handleClick } = useRefreshSpin(onRefresh, loading);
  return (
    <Button
      {...PANEL_HEADER_TOKENS.actionButton}
      onClick={handleClick}
      disabled={disabled || !!spinClass}
      icon={
        <HugeiconsIcon
          icon={Refresh04Icon}
          data-icon="refresh-cw"
          size={PANEL_HEADER_TOKENS.buttonIconSize}
          strokeWidth={PANEL_HEADER_TOKENS.iconStrokeWidth}
          className={spinClass}
        />
      }
      title={title}
      aria-label={title ?? "Refresh"}
      data-testid={dataTestId}
    />
  );
};

// ============================================
// Types
// ============================================

export interface PanelHeaderBreadcrumb {
  /** Parent label (e.g., "General") */
  parent: string;
  /** Current page label (e.g., "Background") */
  current: string;
  /** Optional icon rendered before current (e.g., provider icon for CLI agent) */
  currentIcon?: React.ReactNode;
}

export interface PanelHeaderProps {
  /** Simple title text */
  title?: string;

  /** Icon glyph (size=14 applied automatically) */
  icon?: IconSvgElement;

  /** Custom icon element for non-glyph icons (use when icon prop doesn't work) */
  iconElement?: React.ReactNode;

  /** Subtitle or secondary content after title */
  subtitle?: React.ReactNode;

  /** Back button click handler - shows back arrow when provided */
  onBack?: () => void;
  /** Accessible label and tooltip for the back button. */
  backLabel?: string;

  /** Breadcrumb navigation (used with onBack) */
  breadcrumb?: PanelHeaderBreadcrumb;

  /** Right-side actions (buttons, etc.) */
  actions?: React.ReactNode;

  /** Custom children content (overrides title/breadcrumb) */
  children?: React.ReactNode;

  /** Optional typography adaptation; the default remains Desktop panel chrome. */
  fontSize?: React.CSSProperties["fontSize"];

  /** Additional className */
  className?: string;

  /** When true, draws a bottom border under the header row (separator against content below). */
  borderBottom?: boolean;

  /** Height contract. Detail panes use the same 36px chrome as PR headers. */
  height?: "standard" | "detail";
}

// ============================================
// Component
// ============================================

const PanelHeader: React.FC<PanelHeaderProps> = memo(
  ({
    title,
    icon,
    iconElement,
    subtitle,
    onBack,
    backLabel,
    breadcrumb,
    actions,
    children,
    className = "",
    fontSize = PANEL_HEADER_TOKENS.fontSize,
    borderBottom = false,
    height = "standard",
  }) => {
    const heightClass =
      height === "detail" ? DETAIL_PANEL_TOKENS.headerHeight : "h-10";
    const baseClasses = `relative z-30 flex ${heightClass} shrink-0 items-center gap-2 px-[var(--modal-chrome-padding,1rem)]`;
    const borderClasses = borderBottom ? "border-b border-border-2" : "";

    // Render custom content or default title/breadcrumb
    const renderContent = () => {
      // Children override everything
      if (children) {
        return children;
      }

      // Breadcrumb mode
      if (breadcrumb) {
        return (
          <>
            {iconElement && (
              <span className="shrink-0 text-text-2">{iconElement}</span>
            )}
            <span className="text-text-2" style={{ fontSize }}>
              {breadcrumb.parent}
            </span>
            <HugeiconsIcon
              icon={ArrowRight01Icon}
              data-icon="chevron-right"
              size={PANEL_HEADER_TOKENS.iconSize}
              className="shrink-0 text-text-4"
            />
            {breadcrumb.currentIcon && (
              <span className="shrink-0 text-text-2">
                {breadcrumb.currentIcon}
              </span>
            )}
            <span
              className="truncate font-medium text-text-1"
              style={{ fontSize }}
            >
              {breadcrumb.current}
            </span>
          </>
        );
      }

      // Title mode
      return (
        <>
          {iconElement && (
            <span className="shrink-0 text-text-2">{iconElement}</span>
          )}
          {!iconElement && icon && (
            <HugeiconsIcon
              icon={icon}
              size={PANEL_HEADER_TOKENS.iconSize}
              className="shrink-0 text-text-2"
            />
          )}
          {title && (
            <span
              className="truncate font-medium text-text-1"
              style={{ fontSize }}
            >
              {title}
            </span>
          )}
          {subtitle && (
            <>
              <span className="text-text-4">/</span>
              <span className="truncate text-text-2" style={{ fontSize }}>
                {subtitle}
              </span>
            </>
          )}
        </>
      );
    };

    return (
      <div className={`${baseClasses} ${borderClasses} bg-bg-2 ${className}`}>
        {/* Back button */}
        {onBack && (
          <Button
            {...PANEL_HEADER_TOKENS.actionButton}
            icon={
              <HugeiconsIcon
                icon={ArrowLeft02Icon}
                data-icon="arrow-left"
                size={PANEL_HEADER_TOKENS.buttonIconSize}
                strokeWidth={PANEL_HEADER_TOKENS.iconStrokeWidth}
              />
            }
            onClick={onBack}
            title={backLabel ?? "Back"}
            aria-label={backLabel ?? "Back"}
          />
        )}

        {/* Content - flex-1 to push actions to right */}
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          {renderContent()}
        </div>

        {/* Right-side actions */}
        {actions && (
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        )}
      </div>
    );
  }
);

PanelHeader.displayName = "PanelHeader";

export default PanelHeader;

/**
 * SectionHeader Component
 *
 * Reusable collapsible section header for source control sections
 * (Merge Changes, Staged Changes, Changes)
 */
import React, { memo } from "react";

import { SidebarSectionHeader } from "@src/components/SidebarSectionHeader";
import {
  COUNT_BADGE,
  getCountBadgeSizeClass,
} from "@src/config/workstation/tokens";

export interface SectionHeaderProps {
  title: string;
  /** Omit when the count is already part of the title. */
  count?: number;
  /** Optional display text when the numeric count is a lower bound. */
  countLabel?: string;
  isCollapsed: boolean;
  onToggle: () => void;
  /** Icon to show before the title */
  icon?: React.ReactNode;
  /** Additional action buttons (shown on hover) */
  actions?: React.ReactNode;
  /** Badge color variant */
  variant?: "default" | "warning";
  /** Header height class. Defaults to compact source-control section height. */
  heightClassName?: string;
  /** Keep warning style only on count badge */
  warningCountOnly?: boolean;
}

export const SectionHeader: React.FC<SectionHeaderProps> = memo(
  ({
    title,
    count,
    countLabel,
    isCollapsed,
    onToggle,
    icon,
    actions,
    variant = "default",
    heightClassName = "h-[28px]",
    warningCountOnly = false,
  }) => {
    const isWarning = variant === "warning";
    const useWarningText = isWarning && !warningCountOnly;
    const countBadgeVariant = isWarning
      ? COUNT_BADGE.danger
      : count === 0
        ? COUNT_BADGE.muted
        : COUNT_BADGE.primary;

    return (
      <SidebarSectionHeader
        title={title}
        expanded={!isCollapsed}
        onToggle={onToggle}
        icon={icon}
        heightClassName={heightClassName}
        warning={useWarningText}
        actions={actions}
        badge={
          count !== undefined && (
            <span
              className={`${COUNT_BADGE.base} ${getCountBadgeSizeClass(count)} ${countBadgeVariant}`}
            >
              {countLabel ?? count}
            </span>
          )
        }
      />
    );
  }
);

SectionHeader.displayName = "SectionHeader";

export default SectionHeader;

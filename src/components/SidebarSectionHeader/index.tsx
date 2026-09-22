import React, { type ReactNode } from "react";

import Button from "@src/components/Button";
import DisclosureChevron from "@src/components/DisclosureChevron";
import { TreeRowActionGroup } from "@src/components/TreeRow/TreeRowActionGroup";
import {
  SIDEBAR_ROW_GAP_CLASS,
  TREE_ROW_INSET_CLASS,
  getSidebarRowSurface,
  getTreeRowPadding,
} from "@src/components/TreeRow/config";
import { HEADER_CLASSES } from "@src/config/workstation/tokens";

interface SidebarSectionHeaderProps {
  title: ReactNode;
  depth?: number;
  dataPath?: string;
  /** Panel titles remain plain; group rows use the navigation surface. */
  surface?: "panel" | "group";
  titleStyle?: "section" | "name";
  expanded?: boolean;
  onToggle?: () => void;
  icon?: ReactNode;
  titleSuffix?: ReactNode;
  badge?: ReactNode;
  actions?: ReactNode;
  actionsAlwaysVisible?: boolean;
  warning?: boolean;
  loading?: boolean;
  className?: string;
  heightClassName?: string;
  onContextMenu?: React.MouseEventHandler<HTMLDivElement>;
  toggleTestId?: string;
}

/** Shared chrome only. Collapse, resize, data and refresh lifecycles stay with
 * callers. Custom Button layout preserves the full-width compound disclosure. */
export function SidebarSectionHeader({
  title,
  depth = 0,
  dataPath,
  surface = "group",
  titleStyle = "section",
  expanded,
  onToggle,
  icon,
  titleSuffix,
  badge,
  actions,
  actionsAlwaysVisible = false,
  warning = false,
  loading = false,
  className = "",
  heightClassName = "h-7",
  onContextMenu,
  toggleTestId,
}: SidebarSectionHeaderProps) {
  const text = (
    <>
      {onToggle && (
        <span className="flex w-3.5 shrink-0 items-center justify-center">
          <DisclosureChevron
            expanded={Boolean(expanded)}
            size={14}
            className={warning ? "text-warning-6" : "text-text-3"}
          />
        </span>
      )}
      {icon}
      <span
        className={`relative min-w-0 truncate font-medium ${titleStyle === "name" ? "text-[12px] text-text-1" : `${surface === "panel" ? "text-[12px]" : "text-[11px]"} uppercase ${warning ? "text-warning-6" : "text-text-2"}`}`}
      >
        {title}
        {loading && (
          <span className="absolute -bottom-0.5 left-0 h-0.5 w-full overflow-hidden rounded-full bg-fill-3">
            <span className="absolute h-full w-1/3 animate-progress-slide rounded-full bg-primary-6" />
          </span>
        )}
      </span>
      {titleSuffix}
    </>
  );
  return (
    <div className={`shrink-0 ${SIDEBAR_ROW_GAP_CLASS}`}>
      <div
        onContextMenu={onContextMenu}
        data-tree-path={dataPath}
        className={`group/header ${surface === "panel" ? HEADER_CLASSES.sectionHeader : `${TREE_ROW_INSET_CLASS} ${heightClassName} flex min-w-0 shrink-0 items-center gap-1.5 ${getSidebarRowSurface({ interactive: !warning })} ${warning ? "hover:bg-warning-1" : ""}`} ${className}`}
        style={surface === "group" ? getTreeRowPadding(depth) : undefined}
      >
        {onToggle ? (
          <Button
            layout="custom"
            className="flex h-full min-w-0 flex-1 items-center gap-1.5 text-left"
            aria-expanded={expanded}
            data-testid={toggleTestId}
            data-collapsed={expanded ? "false" : "true"}
            onClick={onToggle}
          >
            {text}
          </Button>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-1.5">{text}</div>
        )}
        {actions && (
          <TreeRowActionGroup
            hoverGroup="header"
            alwaysVisible={actionsAlwaysVisible}
          >
            {actions}
          </TreeRowActionGroup>
        )}
        {badge}
      </div>
    </div>
  );
}

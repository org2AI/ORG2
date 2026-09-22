import React from "react";

import { SidebarSectionHeader } from "@src/components/SidebarSectionHeader";
import {
  COUNT_BADGE,
  getCountBadgeSizeClass,
} from "@src/config/workstation/tokens";

interface TreeSectionHeaderProps {
  id: string;
  title: string;
  collapsed: boolean;
  count?: number | null;
  onToggle: () => void;
}

export const TreeSectionHeader: React.FC<TreeSectionHeaderProps> = ({
  id,
  title,
  collapsed,
  count,
  onToggle,
}) => {
  const countBadgeVariant =
    count === 0 ? COUNT_BADGE.muted : COUNT_BADGE.primary;

  return (
    <SidebarSectionHeader
      title={title}
      expanded={!collapsed}
      onToggle={onToggle}
      dataPath={id}
      badge={
        count != null && (
          <span
            className={`${COUNT_BADGE.base} ${getCountBadgeSizeClass(count)} ${countBadgeVariant}`}
          >
            {count}
          </span>
        )
      }
    />
  );
};

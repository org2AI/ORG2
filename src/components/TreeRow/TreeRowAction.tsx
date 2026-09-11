/**
 * Tree Row Action Button
 *
 * Shared action button for tree rows. Follows the same pattern across:
 * - Source Control (discard, stage/unstage, resolve)
 * - Context Signals (send, dismiss)
 *
 * Button hover drives icon color change (via group/action),
 * NOT the icon's own hover state.
 *
 * Uses the shared Button sidebar size and neutral hover fill.
 * Destructive and success actions retain their semantic colors.
 */
import React, { memo } from "react";

import Button from "@src/components/Button";
import { HEADER_ICON_SIZE } from "@src/config/workstation/tokens";
import { HugeiconsIcon, type IconSvgElement } from "@src/icons";

// ============================================
// Types
// ============================================

export interface TreeRowActionProps {
  /** Hugeicons glyph data to render */
  icon: IconSvgElement;
  /** Click handler */
  onClick: (event: React.MouseEvent) => void;
  /** Tooltip text */
  title: string;
  /** Color variant (default: "default") */
  variant?: "default" | "danger" | "primary" | "success";
  /** Only show when parent row is hovered (default: true) */
  showOnRowHover?: boolean;
}

// ============================================
// Component
// ============================================

export const TreeRowAction: React.FC<TreeRowActionProps> = memo(
  ({ icon, onClick, title, variant = "default", showOnRowHover = true }) => {
    const visibilityClass = showOnRowHover
      ? "hidden! group-hover/item:flex! group-focus-within/item:flex!"
      : "flex";

    return (
      <Button
        htmlType="button"
        size="sidebar"
        variant={variant === "default" ? "tertiary" : variant}
        appearance="soft"
        iconOnly
        aria-label={title}
        className={`action-btn group/action ${visibilityClass}`}
        onClick={onClick}
        title={title}
        icon={
          <HugeiconsIcon
            icon={icon}
            size={HEADER_ICON_SIZE.sm}
            strokeWidth={1.75}
          />
        }
      />
    );
  }
);

TreeRowAction.displayName = "TreeRowAction";

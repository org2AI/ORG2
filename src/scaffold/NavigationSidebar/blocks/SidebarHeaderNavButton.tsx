import React from "react";

import AnyIcon from "@src/components/AnyIcon";
import Button from "@src/components/Button";
import { KeyboardShortcut } from "@src/components/KeyboardShortcut";
import type { IconSvgElement } from "@src/icons";

interface SidebarHeaderNavButtonProps {
  icon: IconSvgElement;
  label: string;
  onClick: () => void;
  ariaLabel?: string;
  className?: string;
  bold?: boolean;
  /** Shortcut id whose keys render as a hover-revealed pill, matching other sidebar rows. */
  shortcutId?: string;
}

const SidebarHeaderNavButton: React.FC<SidebarHeaderNavButtonProps> = ({
  icon,
  label,
  onClick,
  ariaLabel,
  className = "",
  bold = true,
  shortcutId,
}) => {
  return (
    // `text-left` overrides the native <button> UA `text-align: center`, which
    // the flex-1 label column would otherwise inherit and center.
    <Button
      layout="custom"
      className={`group mt-1 flex h-7 w-full cursor-pointer items-center justify-between overflow-hidden rounded-lg px-2 text-left text-text-1 transition-colors duration-150 hover:bg-sidebar-selected ${className}`}
      onClick={onClick}
      tabIndex={0}
      aria-label={ariaLabel ?? label}
    >
      <span className="flex min-w-0 flex-1 items-center gap-3">
        <AnyIcon
          icon={icon}
          size={14}
          strokeWidth={2}
          className="shrink-0 text-text-1"
        />
        <span className="flex min-w-0 flex-1 flex-col gap-0">
          <span
            className={`min-w-0 truncate text-[13px] text-text-1 ${bold ? "font-bold" : ""}`}
          >
            {label}
          </span>
        </span>
      </span>
      {shortcutId && (
        <span className="shrink-0 opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100">
          <KeyboardShortcut
            shortcutId={shortcutId}
            size="sm"
            rendering="icons"
          />
        </span>
      )}
    </Button>
  );
};

export default SidebarHeaderNavButton;

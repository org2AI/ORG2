import React, { type ReactNode, forwardRef } from "react";

import Button from "@src/components/Button";
import {
  SIDEBAR_ROW_GAP_CLASS,
  TREE_ROW_INSET_CLASS,
  getSidebarRowSurface,
  getTreeRowPadding,
} from "@src/components/TreeRow/config";

import { SidebarRowContent } from "./SidebarRowContent";

interface SidebarRowProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  metadata?: ReactNode;
  icon?: ReactNode;
  /** Full-height decoration, such as connected commit graph lanes. */
  leading?: ReactNode;
  compact?: boolean;
  selected?: boolean;
  indented?: boolean;
}

/** This primitive owns the inset. Custom Button layout preserves multiline
 * content, graph geometry, and icons aligned to the first text line. */
export const SidebarRow = forwardRef<HTMLButtonElement, SidebarRowProps>(
  (
    {
      label,
      metadata,
      icon,
      leading,
      compact = false,
      selected,
      indented = false,
      disabled,
      children,
      className = "",
      style,
      ...props
    },
    ref
  ) => (
    <div className={`${TREE_ROW_INSET_CLASS} ${SIDEBAR_ROW_GAP_CLASS}`}>
      <Button
        {...props}
        ref={ref}
        layout="custom"
        disabled={disabled}
        aria-pressed={selected}
        className={`flex w-full gap-1.5 text-left transition-colors ${compact ? "h-9 items-center" : "items-start py-1.5"} ${getSidebarRowSurface({ selected, interactive: !disabled })} ${disabled ? "cursor-default" : "cursor-pointer"} ${className}`}
        style={{ ...getTreeRowPadding(indented ? 1 : 0), ...style }}
      >
        <SidebarRowContent
          leading={
            <>
              {leading}
              {icon && (
                <span className="flex h-5 w-3 shrink-0 items-center justify-center">
                  {icon}
                </span>
              )}
            </>
          }
          label={<span className="min-w-0 flex-1 truncate">{label}</span>}
          title={label}
          metadata={metadata}
          detail={children}
          compact={compact}
          labelClassName={`text-[13px] ${selected ? "font-medium text-text-1" : "font-normal text-text-2"}`}
        />
      </Button>
    </div>
  )
);
SidebarRow.displayName = "SidebarRow";

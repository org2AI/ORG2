import React, { type ReactNode } from "react";

import Button from "@src/components/Button";
import DisclosureChevron from "@src/components/DisclosureChevron";
import { SidebarRowContent } from "@src/components/SidebarRow/SidebarRowContent";
import {
  SIDEBAR_ROW_GAP_CLASS,
  getSidebarRowSurface,
} from "@src/components/TreeRow/config";

import { CHEVRON_SIZE, STICKY_ROW, stickyRowPadding } from "./tokens";

interface StickyTreeRowProps {
  depth: number;
  expanded: boolean;
  name: string;
  onClick: () => void;
  title?: string;
  stickyBgClass?: string;
  icon?: ReactNode;
  nameClassName?: string;
  children?: ReactNode;
}

/** Opaque full-width backing masks scrolling rows; only the inset button
 * highlights. Custom Button layout preserves the tree's indentation and slots. */
export function StickyTreeRow({
  depth,
  expanded,
  name,
  onClick,
  title,
  stickyBgClass = "bg-workstation-bg",
  icon,
  nameClassName = STICKY_ROW.name,
  children,
}: StickyTreeRowProps) {
  return (
    <div className={`h-full px-1 ${SIDEBAR_ROW_GAP_CLASS} ${stickyBgClass}`}>
      <Button
        layout="custom"
        className={`${STICKY_ROW.rowBase} w-full text-left ${getSidebarRowSurface()}`}
        style={stickyRowPadding(depth)}
        onClick={onClick}
        title={title}
      >
        <SidebarRowContent
          leading={
            <>
              <span className={STICKY_ROW.chevronBox}>
                <DisclosureChevron
                  expanded={expanded}
                  size={CHEVRON_SIZE}
                  className={STICKY_ROW.chevronIcon}
                />
              </span>
              {icon}
            </>
          }
          label={<span className="min-w-0 flex-1 truncate">{name}</span>}
          labelClassName={nameClassName}
          trailing={children}
        />
      </Button>
    </div>
  );
}

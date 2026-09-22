import cn from "classnames";
import React, { memo } from "react";

import Button from "@src/components/Button";

export interface SectionSidebarSplitProps {
  sidebar: React.ReactNode;
  children: React.ReactNode;
}

export const SectionSidebarSplit: React.FC<SectionSidebarSplitProps> = memo(
  ({ sidebar, children }) => (
    <div className="grid min-h-[360px] grid-cols-1 @[720px]:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="border-b border-border-1 p-2 @[720px]:border-r @[720px]:border-b-0">
        {sidebar}
      </aside>
      <div className="min-w-0 px-4 py-2">{children}</div>
    </div>
  )
);

SectionSidebarSplit.displayName = "SectionSidebarSplit";

export interface SectionSidebarListProps {
  children: React.ReactNode;
}

export const SectionSidebarList: React.FC<SectionSidebarListProps> = memo(
  ({ children }) => <div className="flex flex-col gap-1">{children}</div>
);

SectionSidebarList.displayName = "SectionSidebarList";

export interface SectionSidebarItemProps extends Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "children"
> {
  children: React.ReactNode;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  selected?: boolean;
}

export const SectionSidebarItem: React.FC<SectionSidebarItemProps> = memo(
  ({
    children,
    leading,
    trailing,
    selected,
    className,
    type = "button",
    ...buttonProps
  }) => (
    <Button
      layout="custom"
      {...buttonProps}
      htmlType={type}
      aria-pressed={selected}
      className={cn(
        "flex min-h-9 w-full min-w-0 items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors",
        selected
          ? "bg-bg-2 text-text-1"
          : "text-text-2 hover:bg-fill-2 hover:text-text-1",
        "disabled:pointer-events-none disabled:opacity-50",
        className
      )}
    >
      {leading ? (
        <span className="flex shrink-0 items-center justify-center">
          {leading}
        </span>
      ) : null}
      <span className="min-w-0 flex-1">{children}</span>
      {trailing ? (
        <span className="flex shrink-0 items-center justify-center">
          {trailing}
        </span>
      ) : null}
    </Button>
  )
);

SectionSidebarItem.displayName = "SectionSidebarItem";

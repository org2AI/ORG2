/**
 * SplitViewLayout Component
 *
 * A reusable resizable, collapsible List (left) + Content (right) layout.
 */
import PageBreadcrumb from "@/src/components/layout/blocks/PageBreadcrumb";
import { useAtomValue } from "jotai";
import React, { memo } from "react";

import { ResizableSplitPanel } from "@src/scaffold/Resize";
import { sidebarCollapsedAtom } from "@src/store/ui/sidebarAtom";

export interface SplitViewLayoutProps {
  /** List panel content */
  listContent: React.ReactNode;
  /** Surface-owned rows pinned above the scrolling list content. */
  listHeader?: React.ReactNode;
  /** Main content area */
  mainContent: React.ReactNode;
  /** List panel width in pixels */
  listWidth?: number;
  /** Minimum list panel width */
  minListWidth?: number;
  /** Maximum list panel width */
  maxListWidth?: number;
  /** Custom className */
  className?: string;
  /** Custom className for main content area */
  mainContentClassName?: string;
  /** Background class for the list (left) panel — default matches app split views */
  listPanelBackgroundClassName?: string;
  /** Hide breadcrumb header when sidebar is collapsed */
  hideBreadcrumbWhenSidebarCollapsed?: boolean;
  /** Whether the resizable split draws a resting divider line. */
  showDivider?: boolean;
}

/** Shared style for CSS containment */
const containStyle = { contain: "layout style" } as const;

const SplitViewLayout: React.FC<SplitViewLayoutProps> = ({
  listContent,
  listHeader,
  mainContent,
  listWidth = 200,
  minListWidth = 160,
  maxListWidth = 320,
  className = "",
  mainContentClassName = "bg-bg-2",
  listPanelBackgroundClassName = "bg-bg-2",
  hideBreadcrumbWhenSidebarCollapsed = false,
  showDivider = true,
}) => {
  const isSidebarCollapsed = useAtomValue(sidebarCollapsedAtom);

  const listPanel = (
    <div
      className={`flex h-full min-w-0 flex-col ${listPanelBackgroundClassName}`}
      style={containStyle}
    >
      {isSidebarCollapsed && !hideBreadcrumbWhenSidebarCollapsed && (
        <div className="flex h-[40px] shrink-0 items-center px-3">
          <PageBreadcrumb />
        </div>
      )}
      {listHeader}
      <div className="scrollbar-overlay min-h-0 flex-1 overflow-y-auto">
        {listContent}
      </div>
    </div>
  );

  return (
    <div
      className={`flex h-full min-h-0 w-full min-w-0 flex-col ${className}`}
      style={containStyle}
    >
      <ResizableSplitPanel
        defaultLeftWidth={listWidth}
        minLeftWidth={minListWidth}
        maxLeftWidth={maxListWidth}
        leftPanel={listPanel}
        rightPanel={
          <div
            className={`h-full min-w-0 overflow-hidden ${mainContentClassName}`}
            style={containStyle}
          >
            {mainContent}
          </div>
        }
        className="flex-1"
        showDivider={showDivider}
      />
    </div>
  );
};

// Memoize to prevent unnecessary re-renders during page transitions
export default memo(SplitViewLayout);

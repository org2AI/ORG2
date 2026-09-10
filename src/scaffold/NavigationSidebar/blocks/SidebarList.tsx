/**
 * SidebarList
 *
 * Scrollable list container for sidebar content.
 * Keeps consistent spacing between sections.
 */
import React, { useEffect, useRef } from "react";

import { Placeholder } from "@src/components/Placeholder";
import { SCROLL_FADE_TOKENS } from "@src/modules/shared/layouts/tokens/scrollFadeTokens";

import { SIDEBAR_PADDING } from "../config";
import type { SidebarListProps } from "../types";
import "./SidebarList.scss";

// Static style — stable reference, never re-created
const SECTION_GAP_STYLE = { gap: `${SIDEBAR_PADDING.sectionGap}px` } as const;

// ============================================
// SidebarList Component
// ============================================

const SidebarList: React.FC<SidebarListProps> = React.memo(
  ({
    children,
    scrollContainerRef,
    isLoading = false,
    loadingContent,
    className = "",
    topPadding = false,
  }) => {
    const viewportRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
      const viewport = viewportRef.current;
      const scroller = viewport?.firstElementChild;
      const content = scroller?.firstElementChild;
      if (!viewport || !(scroller instanceof HTMLElement) || !content) return;

      const updateEdges = () => {
        const maxScroll = scroller.scrollHeight - scroller.clientHeight;
        const top = String(maxScroll > 1 && scroller.scrollTop > 1);
        const bottom = String(maxScroll - scroller.scrollTop > 1);
        // Only edge transitions touch the DOM; scrolling never rerenders rows.
        if (viewport.dataset.scrollTop !== top)
          viewport.dataset.scrollTop = top;
        if (viewport.dataset.scrollBottom !== bottom)
          viewport.dataset.scrollBottom = bottom;
      };

      updateEdges();
      scroller.addEventListener("scroll", updateEdges, { passive: true });
      const observer = new ResizeObserver(updateEdges);
      observer.observe(scroller);
      observer.observe(content);
      return () => {
        scroller.removeEventListener("scroll", updateEdges);
        observer.disconnect();
      };
    }, [isLoading]);

    if (isLoading) {
      if (loadingContent) {
        return (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {loadingContent}
          </div>
        );
      }

      return (
        <div
          className={`flex flex-1 flex-col items-center justify-center ${className}`}
        >
          <Placeholder variant="loading" />
        </div>
      );
    }

    return (
      <div
        ref={viewportRef}
        className="sidebar-list-viewport relative flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        <div
          ref={scrollContainerRef}
          className={`sidebar-list min-h-0 flex-1 overflow-y-auto px-3 ${topPadding === "row" ? "pt-1" : topPadding ? "pt-2" : ""} scrollbar-hide ${SCROLL_FADE_TOKENS.containerSmall} ${className}`}
        >
          <div className="flex flex-col" style={SECTION_GAP_STYLE}>
            {children}
          </div>
        </div>
        <div
          aria-hidden="true"
          className="sidebar-list-divider pointer-events-none absolute inset-x-0 border-t border-border-2"
        />
      </div>
    );
  }
);

SidebarList.displayName = "SidebarList";

export default SidebarList;

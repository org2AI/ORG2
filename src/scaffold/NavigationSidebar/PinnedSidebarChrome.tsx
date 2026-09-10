/**
 * PinnedSidebarChrome
 *
 * macOS only. The Back / Forward pair and the sidebar toggle, pinned in
 * window coordinates right after the traffic lights. Neither the sidebar
 * (which animates its width and clips its header) nor the content pane
 * (which slides as the sidebar resizes) owns the group, so it holds still
 * while everything around it moves — the sidebar header and every
 * collapsed-sidebar host merely reserve the space underneath it.
 *
 * Other hosts draw the same group in flow: `SidebarBase` leads its chrome
 * row with it, and `CollapsedSidebarButton` takes over once it collapses.
 */
import React, { memo } from "react";

import SessionHistoryNav from "@src/components/SessionHistoryNav";
import { hasMacWindowChrome } from "@src/config/windowChromeRadius";
import {
  COLLAPSED_SIDEBAR_CHROME_CENTER_TOP,
  useCollapsedSidebarButtonLeft,
} from "@src/hooks/ui/sidebar/useCollapsedSidebarChromeOffset";
import { SIDEBAR_TOOLTIP_HOVER_DELAY } from "@src/scaffold/NavigationSidebar/config";

import {
  SidebarChromeToggle,
  useSidebarChromeVariant,
} from "./SidebarChromeToggle";

const PinnedSidebarChromeComponent: React.FC = () => {
  const variant = useSidebarChromeVariant();
  // Native full screen hides the traffic lights; the group slides to the edge.
  const left = useCollapsedSidebarButtonLeft();

  if (!hasMacWindowChrome()) return null;

  return (
    <div
      className="fixed z-[10000] flex -translate-y-1/2 items-center gap-px"
      data-testid="pinned-sidebar-chrome"
      data-variant={variant}
      style={
        {
          left,
          top: COLLAPSED_SIDEBAR_CHROME_CENTER_TOP,
          WebkitAppRegion: "no-drag",
        } as React.CSSProperties
      }
    >
      <SidebarChromeToggle variant={variant} />
      <SessionHistoryNav
        variant={variant}
        tooltipMouseEnterDelay={SIDEBAR_TOOLTIP_HOVER_DELAY}
      />
    </div>
  );
};

export const PinnedSidebarChrome = memo(PinnedSidebarChromeComponent);
PinnedSidebarChrome.displayName = "PinnedSidebarChrome";

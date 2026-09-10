/**
 * Sidebar Selector Component
 *
 * The active Workbench route owns exactly one sidebar. Settings and
 * session sidebars unmount when their route branch is inactive.
 */
import React from "react";

import { GENERAL_LAYOUT_TOUR_TARGETS } from "@src/scaffold/Tutorials/generalLayoutTourConfig";
import { GUIDE_TARGETS } from "@src/scaffold/Tutorials/guideTargets";

import { useRouteLayoutType } from "../../hooks";
import { RouteSidebarBody } from "./RouteSidebarBody";

export const SidebarSelector: React.FC = React.memo(() => {
  const layoutType = useRouteLayoutType();

  if (layoutType === "standard") return null;

  return (
    <div
      style={{ flexShrink: 0 }}
      data-guide-target={GUIDE_TARGETS.SIDEBAR}
      data-tour-target={
        layoutType === "session"
          ? GENERAL_LAYOUT_TOUR_TARGETS.sessionSidebar
          : undefined
      }
    >
      <RouteSidebarBody layoutType={layoutType} />
    </div>
  );
});

SidebarSelector.displayName = "SidebarSelector";

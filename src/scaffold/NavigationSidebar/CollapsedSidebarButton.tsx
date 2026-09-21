import { useAtomValue } from "jotai";
import React, { memo } from "react";

import SessionHistoryNav from "@src/components/SessionHistoryNav";
import { hasMacWindowChrome } from "@src/config/windowChromeRadius";
import {
  COLLAPSED_SIDEBAR_CHROME_CENTER_TOP,
  useCollapsedSidebarButtonLeft,
} from "@src/hooks/ui/sidebar/useCollapsedSidebarChromeOffset";
import { sidebarCollapsedAtom } from "@src/store/ui/sidebarAtom";
import { isStationWindow } from "@src/util/platform/tauri/windowIdentity";

import { SidebarChromeToggle } from "./SidebarChromeToggle";

/**
 * Windows / Linux / web: the sidebar toggle plus Back / Forward, drawn in the
 * leading host's chrome row while the sidebar is collapsed. It is the same
 * `SidebarChromeToggle` the open sidebar and the macOS pinned group use, so
 * hover-to-peek and expand-from-peek behave identically on every host.
 */
const CollapsedSidebarButtonComponent: React.FC = () => {
  const collapsed = useAtomValue(sidebarCollapsedAtom);
  const left = useCollapsedSidebarButtonLeft();

  // On macOS the group is drawn once, pinned in window space by
  // `PinnedSidebarChrome`; hosts only reserve the space under it. A detached
  // station window has no sidebar to expand: its top-bar offset exists only
  // to clear the traffic lights (`useShouldOffsetWorkStationTopBar`).
  if (!collapsed || hasMacWindowChrome() || isStationWindow()) return null;

  // Back / Forward ride along so they hold the spot they had in the sidebar
  // header; `getCollapsedSidebarChromeOffset` reserves room for both.
  return (
    <div
      className="absolute z-20 flex -translate-y-1/2 items-center gap-px"
      data-collapsed-sidebar-button
      style={
        {
          left,
          top: COLLAPSED_SIDEBAR_CHROME_CENTER_TOP,
          WebkitAppRegion: "no-drag",
        } as React.CSSProperties & { WebkitAppRegion: string }
      }
    >
      <SidebarChromeToggle variant="chat" />
      <SessionHistoryNav variant="chat" />
    </div>
  );
};

export const CollapsedSidebarButton = memo(CollapsedSidebarButtonComponent);
CollapsedSidebarButton.displayName = "CollapsedSidebarButton";

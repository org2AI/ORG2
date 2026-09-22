/**
 * StationDockChrome
 *
 * Bottom chrome for Agent Station (simulator): a centered, fixed-height dock
 * row with the divider line above it.
 */
import React, { memo } from "react";

import { GENERAL_LAYOUT_TOUR_TARGETS } from "@src/scaffold/Tutorials/generalLayoutTourConfig";

export interface StationDockChromeProps {
  /** Dock body, currently supplied by DockReplayControl. */
  children: React.ReactNode;
}

export const StationDockChrome: React.FC<StationDockChromeProps> = memo(
  ({ children }) => (
    // Chrome owns the divider line above the dock so status bars and replay
    // controls share one border rhythm.
    <div className="flex w-full min-w-0 shrink-0 flex-col items-center overflow-visible border-t border-border-2 px-3 py-0.5">
      <div
        className="mx-auto flex w-full flex-col items-center"
        data-tour-target={GENERAL_LAYOUT_TOUR_TARGETS.dock}
      >
        {/* One 48px row keeps the dock height stable as subagent, overflow,
            or agent-working trailers change. */}
        <div className="flex h-12 w-full items-center justify-center">
          {children}
        </div>
      </div>
    </div>
  )
);

StationDockChrome.displayName = "StationDockChrome";

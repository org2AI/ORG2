import { DROPDOWN_PANEL } from "@src/components/Dropdown/tokens";
import {
  BUTTON_SIZE,
  EDITOR_TAB_CANVAS_BG_CLASS,
} from "@src/config/workstation/tokens";

export const WORKSTATION_TRAIL_SURFACE_CLASS = `max-h-full w-full flex-col overflow-hidden rounded-xl border border-border-1 p-1 ${DROPDOWN_PANEL.shadowSoftClass} ${EDITOR_TAB_CANVAS_BG_CLASS}`;
export const WORKSTATION_TRAIL_WIDTH = {
  expandedPx: 256,
  /**
   * Expanded focused-chat column. Its width comes from the
   * `--workstation-trail-track-width` custom property the trail sets inline
   * (see `FocusedChatWorkstationRail/trailWidth.ts`) — the column has to
   * contain both the trail surface and the wider docked terminal. The
   * container query keeps it at zero below 1100px, where the compact
   * dropdown takes over.
   */
  resizableResponsiveClass:
    "@[1100px]/focusedchat:w-(--workstation-trail-track-width)",
  /** Trail surface's own width inside that column. */
  surfaceResponsiveClass: "@[1100px]/focusedchat:w-(--workstation-trail-width)",
  collapsedResponsiveClass: "@[1100px]/focusedchat:w-11",
} as const;
export const WORKSTATION_TRAIL_RAIL_PADDING_CLASS = "px-1 pb-1 pt-2";
export const FOCUSED_CHAT_WORKSTATION_TRAIL_RAIL_PADDING_CLASS =
  "@[1100px]/focusedchat:px-1 @[1100px]/focusedchat:pb-1 @[1100px]/focusedchat:pt-2";
export const WORKSTATION_TRAIL_ICON_BUTTON_CLASS = `flex ${BUTTON_SIZE.sm} shrink-0 items-center justify-center rounded-lg text-text-1 transition-colors hover:bg-fill-2`;

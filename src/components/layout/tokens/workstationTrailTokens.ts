import { DROPDOWN_PANEL } from "@src/components/Dropdown/tokens";
import { EDITOR_TAB_CANVAS_BG_CLASS } from "@src/config/workstation/tokens";

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
  "@[1100px]/focusedchat:px-1 @[1100px]/focusedchat:pb-1";

/** Composite trail buttons keep row content aligned inside the shared Button label. */
export const WORKSTATION_TRAIL_COMPOSITE_BUTTON_CLASS =
  "justify-start rounded-lg! font-normal! [&>span]:flex [&>span]:w-full [&>span]:items-center [&>span]:gap-1.5 [&>span]:leading-[inherit]";
export const WORKSTATION_TRAIL_ROW_HOVER_CLASS =
  "transition-colors hover:bg-fill-2 focus-within:bg-fill-2";

/** Section titles fold content without drawing a button backdrop. */
export const WORKSTATION_TRAIL_TITLE_BUTTON_CLASS =
  "bg-transparent! enabled:hover:bg-transparent! focus-visible:bg-transparent! [&>span]:gap-0!";

/** One row geometry for harness, repository, identity and actionable entries. */
export const WORKSTATION_TRAIL_ROW = {
  iconSize: 14,
  icon: "flex size-3.5 shrink-0 items-center justify-center",
  label: "min-w-0 flex-1 truncate text-left",
  shell:
    "flex min-w-0 items-center rounded-lg font-normal text-text-1 leading-normal",
  wide: "h-7 text-[12px]!",
  compact: "h-8 text-[13px]!",
  content: "flex min-w-0 w-full items-center",
  wideContent: "gap-1.5 pl-2 pr-1.5",
  compactContent: "gap-2 px-2",
  button:
    "min-w-0 flex-1 p-0! rounded-lg! font-normal! text-text-1! leading-normal! [&>span]:flex [&>span]:w-full [&>span]:leading-[inherit]",
} as const;

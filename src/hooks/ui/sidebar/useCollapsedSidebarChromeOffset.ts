import { useAtomValue } from "jotai";

import {
  SESSION_HISTORY_NAV_GAP,
  SESSION_HISTORY_NAV_WIDTH,
} from "@src/components/SessionHistoryNav";
import { hasMacWindowChrome } from "@src/config/windowChromeRadius";
import { WINDOW_CHROME_TOKENS } from "@src/config/windowChromeTokens";
import { useWorkbenchTouchesLeadingEdge } from "@src/hooks/ui/workbench/workbenchLeadingEdgeContext";
import { sidebarCollapsedAtom } from "@src/store/ui/sidebarAtom";
import { windowFullscreenAtom } from "@src/store/ui/uiAtom";
import type { ChatPanelPosition } from "@src/store/ui/workStationLayout/chatPositionAtoms";
import { isStationWindow } from "@src/util/platform/tauri/windowIdentity";

const COLLAPSED_SIDEBAR_BUTTON_LEFT_INSET = 8;
const COLLAPSED_SIDEBAR_BUTTON_RESERVED_WIDTH = 30;
/** Back / Forward pair plus the 1px gap to the toggle. */
const COLLAPSED_SIDEBAR_HISTORY_NAV_RESERVED_WIDTH =
  SESSION_HISTORY_NAV_WIDTH + SESSION_HISTORY_NAV_GAP;
const MACOS_TRAFFIC_LIGHTS_RESERVED_WIDTH = 80;
/**
 * A detached station window has no sidebar and no collapsed-sidebar group:
 * its top bar only clears the overlay traffic lights, like the detached
 * session window.
 */
const STATION_WINDOW_MACOS_LEADING_INSET =
  WINDOW_CHROME_TOKENS.macTrafficLightsLeadingInset;
const STATION_WINDOW_MACOS_FULLSCREEN_LEADING_INSET = 12;
/**
 * Native full screen hides the traffic lights, but the group reads better a
 * touch further in from the bare screen edge than the 8px inset alone gives.
 */
const MACOS_FULLSCREEN_EXTRA_LEFT_INSET = 8;
/**
 * The pinned macOS group and each host's own collapsed toggle share the
 * title-bar center so nothing shifts between states.
 */
export const COLLAPSED_SIDEBAR_CHROME_CENTER_TOP =
  WINDOW_CHROME_TOKENS.titleBarCenterTop;

export interface CollapsedSidebarChromeOptions {
  /**
   * Native macOS full screen hides the traffic lights, so their reserve gives
   * way to a small extra edge inset. Components read this from
   * `windowFullscreenAtom` via the hook variants below; the plain functions
   * default to the windowed layout.
   */
  fullscreen?: boolean;
}

function getMacLeadingReservedWidth(fullscreen: boolean): number {
  if (!hasMacWindowChrome()) return 0;
  return fullscreen
    ? MACOS_FULLSCREEN_EXTRA_LEFT_INSET
    : MACOS_TRAFFIC_LIGHTS_RESERVED_WIDTH;
}

export function getCollapsedSidebarChromeOffset(
  options?: CollapsedSidebarChromeOptions
): number {
  return (
    getMacLeadingReservedWidth(options?.fullscreen ?? false) +
    COLLAPSED_SIDEBAR_BUTTON_LEFT_INSET +
    COLLAPSED_SIDEBAR_HISTORY_NAV_RESERVED_WIDTH +
    COLLAPSED_SIDEBAR_BUTTON_RESERVED_WIDTH
  );
}

export function getCollapsedSidebarButtonLeft(
  options?: CollapsedSidebarChromeOptions
): number {
  return (
    getMacLeadingReservedWidth(options?.fullscreen ?? false) +
    COLLAPSED_SIDEBAR_BUTTON_LEFT_INSET
  );
}

/**
 * Leading inset a detached station window's top bar keeps clear of the
 * macOS traffic lights; 0 where there is nothing to clear (Windows / Linux
 * keep a native title bar, and the main window is not a station window).
 */
export function getStationWindowLeadingInset(
  options?: CollapsedSidebarChromeOptions
): number {
  if (!isStationWindow() || !hasMacWindowChrome()) return 0;
  return options?.fullscreen
    ? STATION_WINDOW_MACOS_FULLSCREEN_LEADING_INSET
    : STATION_WINDOW_MACOS_LEADING_INSET;
}

/**
 * `getCollapsedSidebarChromeOffset` tracking the live full-screen state.
 * In a detached station window this is the traffic-light inset instead:
 * the workstation top bars apply whichever offset
 * `useShouldOffsetWorkStationTopBar` asks for, and there the ask comes from
 * the window chrome, not from a collapsed sidebar.
 */
export function useCollapsedSidebarChromeOffset(): number {
  const fullscreen = useAtomValue(windowFullscreenAtom);
  if (isStationWindow()) return getStationWindowLeadingInset({ fullscreen });
  return getCollapsedSidebarChromeOffset({ fullscreen });
}

/** `getCollapsedSidebarButtonLeft` tracking the live full-screen state. */
export function useCollapsedSidebarButtonLeft(): number {
  const fullscreen = useAtomValue(windowFullscreenAtom);
  return getCollapsedSidebarButtonLeft({ fullscreen });
}

/**
 * Whether a workstation top bar must pad its leading edge. In the main
 * window: the sidebar is collapsed and the workstation touches the window's
 * left edge, as `AppLayout` resolves it (`WorkbenchLeadingEdgeContext`). In a
 * detached station window: whenever the macOS traffic lights overlay the bar
 * (the sidebar / chat atoms describe the main window's layout and are
 * meaningless there). `CollapsedSidebarButton` renders nothing in a station
 * window, so the offset only ever clears chrome.
 */
export function useShouldOffsetWorkStationTopBar(): boolean {
  const sidebarCollapsed = useAtomValue(sidebarCollapsedAtom);
  const touchesLeadingEdge = useWorkbenchTouchesLeadingEdge();
  const fullscreen = useAtomValue(windowFullscreenAtom);
  if (isStationWindow())
    return getStationWindowLeadingInset({ fullscreen }) > 0;
  return sidebarCollapsed && touchesLeadingEdge;
}

export function useShouldOffsetChatPanelHeader(options: {
  position: ChatPanelPosition;
  useExternalWidth: boolean;
}): boolean {
  const sidebarCollapsed = useAtomValue(sidebarCollapsedAtom);

  if (!sidebarCollapsed) return false;
  if (options.useExternalWidth) return true;

  return options.position === "left";
}

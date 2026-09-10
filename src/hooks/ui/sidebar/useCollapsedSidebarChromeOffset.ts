import { useAtomValue } from "jotai";

import {
  SESSION_HISTORY_NAV_GAP,
  SESSION_HISTORY_NAV_WIDTH,
} from "@src/components/SessionHistoryNav";
import { hasMacWindowChrome } from "@src/config/windowChromeRadius";
import { chatPanelMaximizedAtom } from "@src/store/ui/chatPanel/surfaceAtoms";
import { chatWidthAtom } from "@src/store/ui/chatPanel/widthAtoms";
import { sidebarCollapsedAtom } from "@src/store/ui/sidebarAtom";
import { windowFullscreenAtom } from "@src/store/ui/uiAtom";
import {
  type ChatPanelPosition,
  chatPanelPositionAtom,
} from "@src/store/ui/workStationLayout/chatPositionAtoms";

const COLLAPSED_SIDEBAR_BUTTON_LEFT_INSET = 8;
const COLLAPSED_SIDEBAR_BUTTON_RESERVED_WIDTH = 30;
/** Back / Forward pair plus the 1px gap to the toggle. */
const COLLAPSED_SIDEBAR_HISTORY_NAV_RESERVED_WIDTH =
  SESSION_HISTORY_NAV_WIDTH + SESSION_HISTORY_NAV_GAP;
const MACOS_TRAFFIC_LIGHTS_RESERVED_WIDTH = 80;
/**
 * Native full screen hides the traffic lights, but the group reads better a
 * touch further in from the bare screen edge than the 8px inset alone gives.
 */
const MACOS_FULLSCREEN_EXTRA_LEFT_INSET = 8;
/**
 * Vertical center of the 36px title-bar row every host places its chrome in
 * (8px top breathing room + half the row). The pinned macOS group and each
 * host's own collapsed toggle share it so nothing shifts between states.
 */
export const COLLAPSED_SIDEBAR_CHROME_CENTER_TOP = 26;

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

/** `getCollapsedSidebarChromeOffset` tracking the live full-screen state. */
export function useCollapsedSidebarChromeOffset(): number {
  const fullscreen = useAtomValue(windowFullscreenAtom);
  return getCollapsedSidebarChromeOffset({ fullscreen });
}

/** `getCollapsedSidebarButtonLeft` tracking the live full-screen state. */
export function useCollapsedSidebarButtonLeft(): number {
  const fullscreen = useAtomValue(windowFullscreenAtom);
  return getCollapsedSidebarButtonLeft({ fullscreen });
}

export function useShouldOffsetWorkStationTopBar(): boolean {
  const sidebarCollapsed = useAtomValue(sidebarCollapsedAtom);
  const chatPanelMaximized = useAtomValue(chatPanelMaximizedAtom);
  const chatWidth = useAtomValue(chatWidthAtom);
  const chatPanelPosition = useAtomValue(chatPanelPositionAtom);
  const chatOccupiesLeftEdge = chatWidth > 0 && chatPanelPosition === "left";

  return sidebarCollapsed && !chatPanelMaximized && !chatOccupiesLeftEdge;
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

export function useShouldOffsetMainAppHeader(): boolean {
  return useAtomValue(sidebarCollapsedAtom);
}

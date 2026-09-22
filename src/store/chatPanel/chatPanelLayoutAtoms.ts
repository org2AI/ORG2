import { atom } from "jotai";

import {
  chatPanelMaximizedAtom,
  toggleChatPanelMaximizedAtom,
} from "@src/store/ui/chatPanel/surfaceAtoms";
import { STATION_MODE, stationModeAtom } from "@src/store/ui/simulatorAtom";
import { workstationLayoutAtom } from "@src/store/workstation/tabs";
import { isStationWindow } from "@src/util/platform/tauri/windowIdentity";

import {
  isChatPanelTabStationAvailable,
  resolveChatPanelMaximizedForLayout,
} from "./chatPanelTabsModel";
import {
  activeChatPanelTabAtom,
  chatPanelTabsAtom,
} from "./chatPanelTabsState";

/** Whether the active chat tab may share the workbench with a Station. */
export const activeChatPanelTabStationAvailableAtom = atom((get) =>
  isChatPanelTabStationAvailable(get(activeChatPanelTabAtom))
);
activeChatPanelTabStationAvailableAtom.debugLabel =
  "activeChatPanelTabStationAvailable";

/** Effective layout only; writes continue to target the saved preference. */
export const effectiveChatPanelMaximizedAtom = atom((get) =>
  resolveChatPanelMaximizedForLayout(
    get(chatPanelMaximizedAtom),
    get(activeChatPanelTabAtom)
  )
);
effectiveChatPanelMaximizedAtom.debugLabel = "effectiveChatPanelMaximized";

/** User toggle guarded by the active tab's Station-access policy. */
export const toggleActiveChatPanelMaximizedAtom = atom(null, (get, set) => {
  if (!get(activeChatPanelTabStationAvailableAtom)) return false;
  set(toggleChatPanelMaximizedAtom);
  return true;
});
toggleActiveChatPanelMaximizedAtom.debugLabel =
  "toggleActiveChatPanelMaximized";

export const CLOSE_TAB_CHORD_FALLBACK = {
  CLOSE_STATION: "close-station",
  CLOSE_WINDOW: "close-window",
} as const;
export type CloseTabChordFallback =
  (typeof CLOSE_TAB_CHORD_FALLBACK)[keyof typeof CLOSE_TAB_CHORD_FALLBACK];

/**
 * What the close-tab chord (⌘W / Ctrl+W) does once the chat pane holds only
 * its Launchpad — closing that only re-creates it — or null while the chat
 * pane still has a tab of its own to close.
 *
 * The visible Station closes first: while My Station shows nothing but its
 * Launchpad, the chord closes that Launchpad, which closes My Station. The
 * Agent Station owns no tabs at all, so it is always in that state — the
 * chord closes it straight away rather than reaching past it for a My Station
 * tab nobody can see. Only once the Station is closed (the chat pane fills the
 * slot) does the chord close the window. A detached Station window cannot
 * close its Station without closing itself, so it closes the window directly.
 * A real WorkStation tab leaves the chord as it was.
 */
export const closeTabChordFallbackAtom = atom<CloseTabChordFallback | null>(
  (get) => {
    const workstationTabs = get(workstationLayoutAtom).mainPane.tabs;
    const agentStation = get(stationModeAtom) === STATION_MODE.AGENT_STATION;
    const stationHoldsNothingToClose =
      agentStation ||
      (workstationTabs.length > 0 &&
        workstationTabs.every((tab) => tab.type === "start"));
    if (isStationWindow()) {
      return stationHoldsNothingToClose
        ? CLOSE_TAB_CHORD_FALLBACK.CLOSE_WINDOW
        : null;
    }

    const chatHoldsOnlyLaunchpad = get(chatPanelTabsAtom).tabs.every(
      (tab) => tab.type === "start-page"
    );
    if (!chatHoldsOnlyLaunchpad) return null;
    if (get(chatPanelMaximizedAtom)) {
      return CLOSE_TAB_CHORD_FALLBACK.CLOSE_WINDOW;
    }
    return stationHoldsNothingToClose
      ? CLOSE_TAB_CHORD_FALLBACK.CLOSE_STATION
      : null;
  }
);
closeTabChordFallbackAtom.debugLabel = "closeTabChordFallback";

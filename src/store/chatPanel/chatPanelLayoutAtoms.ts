import { atom } from "jotai";

import {
  chatPanelMaximizedAtom,
  toggleChatPanelMaximizedAtom,
} from "@src/store/ui/chatPanel/surfaceAtoms";
import { stationModeAtom } from "@src/store/ui/simulatorAtom";
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
  CLOSE_MY_STATION: "close-my-station",
  CLOSE_WINDOW: "close-window",
} as const;
export type CloseTabChordFallback =
  (typeof CLOSE_TAB_CHORD_FALLBACK)[keyof typeof CLOSE_TAB_CHORD_FALLBACK];

/**
 * What the close-tab chord (⌘W / Ctrl+W) does once the chat pane holds only
 * its Launchpad — closing that only re-creates it — or null while the chat
 * pane still has a tab of its own to close.
 *
 * My Station closes first: while it shows nothing but its Launchpad, the
 * chord closes that Launchpad, which closes My Station. Only once the
 * WorkStation is closed (the chat pane fills the slot) does the chord close
 * the window. A detached My Station window cannot close My Station without
 * closing itself, so its lone Launchpad closes the window directly. A visible
 * Agent Station or real WorkStation tab leaves the chord as it was.
 */
export const closeTabChordFallbackAtom = atom<CloseTabChordFallback | null>(
  (get) => {
    const workstationTabs = get(workstationLayoutAtom).mainPane.tabs;
    const myStationHoldsOnlyLaunchpad =
      get(stationModeAtom) === "my-station" &&
      workstationTabs.length > 0 &&
      workstationTabs.every((tab) => tab.type === "start");
    if (isStationWindow()) {
      return myStationHoldsOnlyLaunchpad
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
    return myStationHoldsOnlyLaunchpad
      ? CLOSE_TAB_CHORD_FALLBACK.CLOSE_MY_STATION
      : null;
  }
);
closeTabChordFallbackAtom.debugLabel = "closeTabChordFallback";

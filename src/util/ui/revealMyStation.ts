/**
 * revealMyStation — the one way anything brings My Station on screen before
 * showing something in it.
 *
 * Three independent things can keep My Station off screen, and a caller that
 * clears only some of them opens a tab the user never sees:
 *
 *   1. the chat-panel slot is maximized over the Station pane;
 *   2. the active chat-panel tab is one the Station may not share the
 *      workbench with (Runtime, Work Management, a detail tab — see
 *      `CHAT_PANEL_TAB_TYPE_POLICY`), which maximizes the slot whatever the
 *      user's own preference says;
 *   3. the window is on a route that renders no Station at all.
 *
 * This helper clears all three, and is deliberately store-based rather than a
 * hook so event listeners, services and plain utilities share one
 * implementation instead of each re-deriving part of it.
 *
 * Settings is a workbench route: un-maximizing exposes the Station beside the
 * Settings slot, so revealing from there never navigates and never discards
 * an open wizard's form state.
 */
import { ROUTES, isWorkbenchPath } from "@src/config/routes";
import { navigateApp } from "@src/router/navigateApp";
import { openOrFocusChatPanelStartPageTabAtom } from "@src/store/chatPanel/chatPanelTabOpen/startPage";
import { activateChatPanelTabAtom } from "@src/store/chatPanel/chatPanelTabPresentationAtoms";
import { isChatPanelTabStationAvailable } from "@src/store/chatPanel/chatPanelTabsModel";
import { chatPanelTabsAtom } from "@src/store/chatPanel/chatPanelTabsState";
import { chatPanelMaximizedAtom } from "@src/store/ui/chatPanel/surfaceAtoms";
import { STATION_MODE, stationModeAtom } from "@src/store/ui/simulatorAtom";
import {
  getInstrumentedStore,
  isStoreInitialized,
} from "@src/util/core/state/instrumentedStore";
import { isStationWindow } from "@src/util/platform/tauri/windowIdentity";

type AppStore = ReturnType<typeof getInstrumentedStore>;

export interface RevealMyStationOptions {
  /** Route to land on when the current one renders no Station. */
  path?: string;
}

/**
 * Move off a chat-panel tab that forbids Station access, so the Station can
 * take its half of the workbench. Prefers an already-open tab that allows it
 * and falls back to the Launchpad, which always does.
 */
function revealStationCapableChatTab(store: AppStore): void {
  const { tabs, activeTabId } = store.get(chatPanelTabsAtom);
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;
  if (isChatPanelTabStationAvailable(activeTab)) return;

  const shareableTab = tabs.find(isChatPanelTabStationAvailable);
  if (shareableTab) {
    store.set(activateChatPanelTabAtom, shareableTab.id);
    return;
  }
  store.set(openOrFocusChatPanelStartPageTabAtom, {});
}

/** Bring My Station on screen in this window. */
export function revealMyStation({
  path = ROUTES.workStation.base.path,
}: RevealMyStationOptions = {}): void {
  // Utilities can be reached from a harness that never built the app store.
  if (!isStoreInitialized()) return;
  const store = getInstrumentedStore();

  store.set(stationModeAtom, STATION_MODE.MY_STATION);

  // A detached Station window *is* its own Station: its mode selection above
  // is window-local, and there is no chat-panel slot or route to change.
  if (isStationWindow()) return;

  if (store.get(chatPanelMaximizedAtom)) {
    store.set(chatPanelMaximizedAtom, false);
  }
  revealStationCapableChatTab(store);

  if (!isWorkbenchPath(window.location.pathname)) navigateApp(path);
}

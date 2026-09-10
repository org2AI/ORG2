import { atom } from "jotai";

import { ROUTES } from "@src/config/routes";
import { chatPanelMaximizedAtom } from "@src/store/ui/chatPanel/surfaceAtoms";
import { stationChatVisibilityAtom } from "@src/store/ui/chatPanel/visibilityAtoms";
import { restoreChatWidthAtom } from "@src/store/ui/chatPanel/widthAtoms";
import { STATION_MODE, stationModeAtom } from "@src/store/ui/simulatorAtom";

import { tabToHost } from "./tabHost";
import {
  createExplorerTab,
  createProjectDashboardTab,
  openTab,
  switchTab,
  workstationLayoutAtom,
} from "./tabs";
import {
  requestNewBrowserSessionAtom,
  workstationNewBrowserSessionConsumedTickAtom,
  workstationNewBrowserSessionRequestAtom,
} from "./workstationTabBarAtoms";

/** Translate supported Workstation URLs into tab/station entry intents. */
export const enterWorkstationRouteAtom = atom(
  null,
  (get, set, path: string) => {
    const routes = ROUTES.workStation;
    if (!Object.values(routes).some((route) => route.path === path)) return;

    if (path === routes.base.path) {
      // Explicit callers may already have selected Agent Station before navigating.
      const mode = get(stationModeAtom);
      set(stationChatVisibilityAtom, (prev) => ({ ...prev, [mode]: true }));
      set(restoreChatWidthAtom);
      return;
    }

    set(chatPanelMaximizedAtom, false);
    const mode =
      path === routes.chat.path
        ? STATION_MODE.AGENT_STATION
        : STATION_MODE.MY_STATION;
    set(stationModeAtom, mode);
    if (path === routes.chat.path) {
      set(stationChatVisibilityAtom, (prev) => ({ ...prev, [mode]: true }));
      return;
    }

    const host =
      path === routes.browser.path
        ? "browser"
        : path === routes.project.path
          ? "project"
          : "code";
    const layout = get(workstationLayoutAtom);
    const pane = layout.mainPane;
    const active = pane.tabs.find((tab) => tab.id === pane.activeTabId);
    if (active && tabToHost(active) === host) return;
    const existing = pane.tabs.find((tab) => tabToHost(tab) === host);
    if (existing) {
      set(workstationLayoutAtom, {
        ...layout,
        mainPane: switchTab(pane, existing.id),
      });
    } else if (host === "browser") {
      if (
        get(workstationNewBrowserSessionRequestAtom).tick <=
        get(workstationNewBrowserSessionConsumedTickAtom)
      ) {
        set(requestNewBrowserSessionAtom, {});
      }
    } else {
      const tab =
        host === "project" ? createProjectDashboardTab() : createExplorerTab();
      set(workstationLayoutAtom, { ...layout, mainPane: openTab(pane, tab) });
    }
  }
);

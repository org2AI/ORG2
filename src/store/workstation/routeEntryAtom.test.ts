import { createStore } from "jotai";
import { beforeEach, describe, expect, it } from "vitest";

import { ROUTES } from "@src/config/routes";
import { stationModeAtom } from "@src/store/ui/simulatorAtom";

import { enterWorkstationRouteAtom } from "./routeEntryAtom";
import { activeHostAtom } from "./tabHost";
import {
  createBrowserSessionTab,
  createExplorerTab,
  createProjectDashboardTab,
  openTab,
  workstationLayoutAtom,
} from "./tabs";
import { workstationNewBrowserSessionRequestAtom } from "./workstationTabBarAtoms";

describe("Workstation URL entry", () => {
  let store: ReturnType<typeof createStore>;
  beforeEach(() => {
    localStorage.clear();
    store = createStore();
    const layout = store.get(workstationLayoutAtom);
    store.set(workstationLayoutAtom, {
      ...layout,
      mainPane: { ...layout.mainPane, tabs: [], activeTabId: null },
    });
  });

  it("selects an existing browser tab from an editor without duplicating sessions", () => {
    const browser = createBrowserSessionTab("existing", "https://example.com");
    const layout = store.get(workstationLayoutAtom);
    const pane = openTab(
      openTab(layout.mainPane, browser),
      createExplorerTab()
    );
    store.set(workstationLayoutAtom, { ...layout, mainPane: pane });
    store.set(enterWorkstationRouteAtom, ROUTES.workStation.browser.path);
    expect(store.get(activeHostAtom)).toBe("browser");
    expect(store.get(workstationLayoutAtom).mainPane.activeTabId).toBe(
      browser.id
    );
    expect(store.get(workstationNewBrowserSessionRequestAtom).tick).toBe(0);
  });

  it("requests only one browser session while creation is pending", () => {
    store.set(enterWorkstationRouteAtom, ROUTES.workStation.browser.path);
    store.set(enterWorkstationRouteAtom, ROUTES.workStation.browser.path);
    expect(store.get(workstationNewBrowserSessionRequestAtom).tick).toBe(1);
  });

  it("opens the requested project and editor hosts without destroying tabs", () => {
    store.set(enterWorkstationRouteAtom, ROUTES.workStation.project.path);
    expect(store.get(activeHostAtom)).toBe("project");
    store.set(enterWorkstationRouteAtom, ROUTES.workStation.code.path);
    expect(store.get(activeHostAtom)).toBe("code");
    expect(store.get(workstationLayoutAtom).mainPane.tabs).toHaveLength(2);
  });

  it("preserves an explicitly selected Agent Station on base-route entry", () => {
    store.set(stationModeAtom, "agent-station");
    store.set(enterWorkstationRouteAtom, ROUTES.workStation.base.path);
    expect(store.get(stationModeAtom)).toBe("agent-station");
  });

  it("leaves Settings navigation and the current tab alone", () => {
    const layout = store.get(workstationLayoutAtom);
    store.set(workstationLayoutAtom, {
      ...layout,
      mainPane: openTab(layout.mainPane, createProjectDashboardTab()),
    });
    const before = store.get(workstationLayoutAtom);
    store.set(enterWorkstationRouteAtom, ROUTES.app.settings.path);
    expect(store.get(workstationLayoutAtom)).toBe(before);
  });
});

// @vitest-environment jsdom
import { Provider } from "jotai";
import { act, createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { ROUTES } from "@src/config/routes";
import { chatPanelTabsAtom } from "@src/store/chatPanel/chatPanelTabsState";
import { chatPanelMaximizedAtom } from "@src/store/ui/chatPanel/surfaceAtoms";
import { settingsReturnPathAtom } from "@src/store/ui/settingsNavigationAtom";
import { stationModeAtom } from "@src/store/ui/simulatorAtom";
import {
  createProjectSettingsTab,
  createStartTab,
  workstationLayoutAtom,
} from "@src/store/workstation/tabs";
import {
  createInstrumentedStore,
  getInstrumentedStore,
  resetInstrumentedStore,
} from "@src/util/core/state/instrumentedStore";
import {
  DETAIL_PANE_CLOSE_ATTRIBUTE,
  DETAIL_PANE_SHORTCUT_CLOSE_EVENT,
} from "@src/util/dom/detailPaneClose";

import { closeCurrentWindow } from "../closeCurrentWindow";
import { useTabShortcuts } from "../useTabShortcuts";

vi.mock("../closeCurrentWindow", () => ({
  closeCurrentWindow: vi.fn(),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const navigationEvents: Array<{ path: string; replace?: boolean }> = [];
const handleNavigate = (event: Event) => {
  navigationEvents.push(
    (event as CustomEvent<{ path: string; replace?: boolean }>).detail
  );
};

beforeEach(() => {
  resetInstrumentedStore();
  const store = createInstrumentedStore();
  store.set(chatPanelMaximizedAtom, false);
  store.set(stationModeAtom, "my-station");
  vi.mocked(closeCurrentWindow).mockClear();
  navigationEvents.length = 0;
  window.addEventListener("action-system-navigate", handleNavigate);
});

afterEach(() => {
  window.removeEventListener("action-system-navigate", handleNavigate);
  resetInstrumentedStore();
});

type TabShortcutsApi = ReturnType<typeof useTabShortcuts>;

function Harness({ onReady }: { onReady: (api: TabShortcutsApi) => void }) {
  const api = useTabShortcuts();
  useEffect(() => {
    onReady(api);
  }, [api, onReady]);
  return null;
}

/** Mount the hook against the app's singleton store and hand back its API. */
async function mountTabShortcuts() {
  const store = getInstrumentedStore();
  let mounted: TabShortcutsApi | null = null;
  const onReady = (api: TabShortcutsApi) => {
    mounted = api;
  };
  const node = document.createElement("div");
  document.body.append(node);
  const root = createRoot(node);
  await act(async () => {
    root.render(
      createElement(Provider, { store }, createElement(Harness, { onReady }))
    );
  });
  return {
    get handleCloseCurrentTab() {
      if (!mounted) throw new Error("harness did not render");
      return mounted.handleCloseCurrentTab;
    },
    async unmount() {
      await act(async () => root.unmount());
      node.remove();
    },
  };
}

it("closes Settings instead of the WorkStation tab hidden behind it", async () => {
  const store = getInstrumentedStore();
  const launchpad = createStartTab();
  store.set(workstationLayoutAtom, {
    mainPane: { tabs: [launchpad], activeTabId: launchpad.id },
  });
  store.set(settingsReturnPathAtom, ROUTES.workStation.code.path);
  window.history.replaceState({}, "", `${ROUTES.app.settings.path}/appearance`);

  const harness = await mountTabShortcuts();
  let closed = false;
  await act(async () => {
    closed = harness.handleCloseCurrentTab();
  });

  expect(closed).toBe(true);
  expect(navigationEvents).toEqual([{ path: ROUTES.workStation.code.path }]);
  expect(store.get(workstationLayoutAtom).mainPane.tabs).toHaveLength(1);

  await harness.unmount();
});

it("still closes the active tab on a WorkStation URL", async () => {
  const store = getInstrumentedStore();
  const settingsTab = createProjectSettingsTab();
  store.set(workstationLayoutAtom, {
    mainPane: { tabs: [settingsTab], activeTabId: settingsTab.id },
  });
  window.history.replaceState({}, "", ROUTES.workStation.base.path);

  const harness = await mountTabShortcuts();
  let closed = false;
  await act(async () => {
    closed = harness.handleCloseCurrentTab();
  });

  expect(closed).toBe(true);
  expect(navigationEvents).toEqual([]);
  expect(store.get(workstationLayoutAtom).mainPane.tabs).toEqual([]);
  expect(closeCurrentWindow).not.toHaveBeenCalled();

  await harness.unmount();
});

it("closes a list/detail tab's open detail first, then the tab", async () => {
  const store = getInstrumentedStore();
  const listDetailTab = createProjectSettingsTab();
  store.set(workstationLayoutAtom, {
    mainPane: { tabs: [listDetailTab], activeTabId: listDetailTab.id },
  });
  window.history.replaceState({}, "", ROUTES.workStation.base.path);

  // The detail header's "x", as `DetailPaneCloseAction` renders it; closing
  // the detail swaps it for a placeholder, which carries no close action.
  const marker = document.createElement("span");
  marker.setAttribute(DETAIL_PANE_CLOSE_ATTRIBUTE, "");
  const closeButton = document.createElement("button");
  closeButton.checkVisibility = () => true;
  const onCloseDetail = vi.fn(() => marker.remove());
  marker.addEventListener(DETAIL_PANE_SHORTCUT_CLOSE_EVENT, onCloseDetail);
  marker.append(closeButton);
  document.body.append(marker);

  const harness = await mountTabShortcuts();
  let closed = false;
  await act(async () => {
    closed = harness.handleCloseCurrentTab();
  });

  expect(closed).toBe(true);
  expect(onCloseDetail).toHaveBeenCalledTimes(1);
  expect(store.get(workstationLayoutAtom).mainPane.tabs).toHaveLength(1);

  await act(async () => {
    closed = harness.handleCloseCurrentTab();
  });

  expect(closed).toBe(true);
  expect(onCloseDetail).toHaveBeenCalledTimes(1);
  expect(store.get(workstationLayoutAtom).mainPane.tabs).toEqual([]);

  await harness.unmount();
});

it("closes My Station's Launchpad first, then the window", async () => {
  const store = getInstrumentedStore();
  const launchpad = createStartTab();
  store.set(workstationLayoutAtom, {
    mainPane: { tabs: [launchpad], activeTabId: launchpad.id },
  });
  const chatTabs = store.get(chatPanelTabsAtom);
  expect(chatTabs.tabs.map((tab) => tab.type)).toEqual(["start-page"]);
  window.history.replaceState({}, "", ROUTES.workStation.base.path);

  const harness = await mountTabShortcuts();
  let closed = false;
  await act(async () => {
    closed = harness.handleCloseCurrentTab();
  });

  expect(closed).toBe(true);
  expect(closeCurrentWindow).not.toHaveBeenCalled();
  expect(store.get(workstationLayoutAtom).mainPane.tabs).toEqual([]);
  expect(store.get(chatPanelMaximizedAtom)).toBe(true);

  closed = false;
  await act(async () => {
    closed = harness.handleCloseCurrentTab();
  });

  expect(closed).toBe(true);
  expect(closeCurrentWindow).toHaveBeenCalledTimes(1);
  expect(store.get(chatPanelTabsAtom)).toBe(chatTabs);

  await harness.unmount();
});

it("closes Settings before considering the window", async () => {
  const store = getInstrumentedStore();
  store.set(settingsReturnPathAtom, ROUTES.workStation.code.path);
  window.history.replaceState({}, "", `${ROUTES.app.settings.path}/appearance`);

  const harness = await mountTabShortcuts();
  await act(async () => {
    harness.handleCloseCurrentTab();
  });

  expect(navigationEvents).toEqual([{ path: ROUTES.workStation.code.path }]);
  expect(closeCurrentWindow).not.toHaveBeenCalled();

  await harness.unmount();
});
